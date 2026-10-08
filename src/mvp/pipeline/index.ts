import { mvpEnv } from "@/mvp/config/env";
import { getClientProfile } from "@/mvp/config/profile";
import { getCatalogueItem } from "@/mvp/config/buyers-config";
import { getDb, type Db } from "@/mvp/db";
import { buildSignalsAndScore } from "@/mvp/scoring";
import type { RunCounters, RunInput, RunStage,RunRow } from "@/mvp/types";
import { activeRuns, failStaleRuns } from "./active-runs";
import type { RawDoc, Source, SourceContext } from "./contracts";
import { ensureMockExtractor, extractDocument, triage } from "./extract";
import { detectMarkets, filterDocument, findScope, hasTerm, queryTerms, scopeTermsFor } from "./filter";
import { fetchPageText, storeDocument, type StoredDoc } from "./read";
import { resolveDocument } from "./resolve";
import { bingNewsSource } from "./sources/bing-news";
import { fixturesSource } from "./sources/fixtures";
import { gdeltSource } from "./sources/gdelt";
import { rssSource } from "./sources/rss";
import { tedSource } from "./sources/ted";
import { tavilySource } from "./sources/tavily";
import { publisherKeyFor } from "./text";
import { captureOpportunities } from "@/mvp/opportunities";
import { buyerPageCandidate,buyerResearchPriority } from "@/mvp/discovery/plan";
import { discoverBuyers, saveBuyer,DISCOVERY_VERSION } from "@/mvp/discovery";
import { requirePersistentWorker } from "@/mvp/runtime";
import { createResearchRun,sessionFor,resumeResearchRun } from "@/mvp/research/store";
import { startResearchWorker,waitForResearchRun } from "@/mvp/research/worker";
import { resolveMaterial } from "@/mvp/discovery/material";

export { fixtureDocs } from "./sources/fixtures";
export { failStaleRuns } from "./active-runs";

/** Documents read per run at most (keeps a "Search now" run to a few minutes on free quotas). */
export const MAX_DOCS_PER_RUN = 60;
const READ_CONCURRENCY = 3;
type BuyerPage={stored:StoredDoc;raw:RawDoc};

/** Live sources for a run. Fixtures are available only through explicit sample/offline mode. */
export function liveSources(): Source[] {
  return [...(process.env.TAVILY_API_KEY?.trim() ? [tavilySource] : []), tedSource, bingNewsSource, gdeltSource, rssSource];
}

/**
 * Start a "Search now" run (docs/mvp/12 §1 F1, 05, 06).
 *
 * Inserts a `runs` row (status 'queued' → 'running'), returns its id immediately, and continues in the
 * background: collect (TED, Bing News, GDELT, RSS; fixtures only in explicit offline mode) → read → filter →
 * extract (getLLM('extract_a'/'extract_b'), mock in demo mode) → quote check → agreement → resolve →
 * graph, then calls `buildSignalsAndScore(runId)`. Progress is appended to `run_events` with
 * `RunCounters`; `runs.status` ends as 'done' or 'failed' (a scoring failure also ends as 'failed').
 * A failing source never stops the run. Runs left 'queued'/'running' by a stopped process are marked
 * failed later by `failStaleRuns` (called here and on every run read). Callers inside a request should
 * keep the background work alive with next/server `after(() => waitForRun(runId))`.
 *
 * @param input query text, market codes (e.g. ["IN","SA"]) and lead kinds.
 * @returns the new run id (uuid).
 */
export async function startRun(input: RunInput): Promise<string> {
  requirePersistentWorker();
  const db = getDb();
  await failStaleRuns(db);
  const clean: RunInput = {
    query: String(input.query ?? "").trim().slice(0, 300),
    markets: [...new Set((input.markets ?? []).map((m) => String(m).trim().toUpperCase()).filter(Boolean))],
    leadKinds: (input.leadKinds ?? []).filter((k) => k === "bid" || k === "supply_subcontract"),
  };
  if (input.offline === true) clean.offline = true;
  if (input.productId) clean.productId = input.productId;
  if (input.contactRole) clean.contactRole = input.contactRole;
  if (input.researchMode) clean.researchMode = input.researchMode;
  if (input.targetCompanies) clean.targetCompanies = input.targetCompanies;
  if (!clean.leadKinds.length) clean.leadKinds = ["bid", "supply_subcontract"];
  if (!clean.markets.length) clean.markets = [...getClientProfile().markets];
  if(clean.productId&&!clean.offline&&!mvpEnv.offline()){
    const material=resolveMaterial(clean.query,clean.productId);if(material.status!=='resolved')throw new Error(material.question??'Clarify the material before research.');
  }
  if(clean.productId&&!clean.offline&&!mvpEnv.offline()&&process.env.MVP_DURABLE_RESEARCH!=='off'&&!process.env.VITEST){
    const id=await createResearchRun(clean,db);startResearchWorker();return id;
  }
  const { rows } = await db.query<{ id: string }>(
    "insert into runs (adhoc_query, status, counters) values ($1::jsonb, 'queued', '{}'::jsonb) returning id",
    [JSON.stringify(clean)],
  );
  const runId = rows[0].id;
  const pending = executeRun(runId, clean, db);
  activeRuns().set(runId, pending);
  void pending.finally(() => activeRuns().delete(runId));
  return runId;
}

/** Resolves when the run started in this process finishes (immediately if unknown). */
export async function waitForRun(runId: string): Promise<void> {
  if(await sessionFor(getDb(),runId)){await waitForResearchRun(runId);return;}
  await activeRuns().get(runId);
}

/** Reuse original pages and cached extraction; never collect sources again. Atomic run claim prevents duplicates. */
export async function continueBuyerRun(runId:string):Promise<string> {
  requirePersistentWorker();const db=getDb();
  if(await sessionFor(db,runId)){await resumeResearchRun(runId,db);startResearchWorker();return runId;}
  const run=await db.tx(async tx=>{
    await tx.query("select pg_advisory_xact_lock(78240324)");
    const row=(await tx.query<RunRow>("select * from runs where id=$1 for update",[runId])).rows[0];
    if(!row||!row.adhoc_query?.productId||row.adhoc_query.offline)throw new Error("Only a real product search with original pages can continue.");
    if(!["done","failed"].includes(row.status))throw new Error("This search is already processing or cannot continue.");
    if((await tx.query("select id from runs where status in ('queued','running') limit 1")).rows.length)throw new Error("Wait for the current research to finish before continuing saved pages.");
    if(!(await tx.query("select d.id from source_documents d join run_documents rd on rd.document_id=d.id where rd.run_id=$1 and not d.is_sample and d.text is not null limit 1",[runId])).rows.length)throw new Error("No original live pages are available for this search.");
    await tx.query("update runs set status='running',finished_at=null,error=null where id=$1",[runId]);return row;
  });
  const pending=(async()=>{
    const progress=new Progress(db,runId);Object.assign(progress.counters,run.counters);
    try{
      await progress.emit("read","Continuing saved original pages. No new web-search requests. Cached analyses are rechecked; fresh AI analysis remains budget-limited.");
      const docs=(await db.query<{id:string;text:string;source_key:string;source_name:string;tier:RawDoc['tier'];url:string;title:string|null;published_at:string|null}>(`select d.* from source_documents d join run_documents rd on rd.document_id=d.id where rd.run_id=$1 and not d.is_sample and d.text is not null`,[runId])).rows;
      await analyseBuyerPages(runId,run.adhoc_query!,docs.map(d=>({stored:{id:d.id,text:d.text,state:"known",status:"extracted"},raw:{sourceKey:d.source_key,sourceName:d.source_name,tier:d.tier,url:d.url,title:d.title,publishedAt:d.published_at,text:d.text,isSample:false}})),db,progress);
    }catch(error){await db.query("update runs set status='failed',finished_at=now(),error=$2 where id=$1",[runId,safeBuyerAnalysisError(error)]);await progress.emit("error",safeBuyerAnalysisError(error));}
  })();
  activeRuns().set(runId,pending);void pending.finally(()=>activeRuns().delete(runId));return runId;
}

// ───────────────────────── progress ─────────────────────────

class Progress {
  readonly counters: Required<Pick<RunCounters, "sourcesTotal" | "sourcesDone" | "sourcesFailed" | "itemsRead" | "relevant" | "factsKept" | "factsDropped" | "newLeads" | "updatedLeads">> & Pick<RunCounters, "scopedProspects" | "buyerPagesChecked" | "deferredPages" | "buyerAnalysisFailed"> = {
    sourcesTotal: 0, sourcesDone: 0, sourcesFailed: 0, itemsRead: 0, relevant: 0, factsKept: 0, factsDropped: 0, newLeads: 0, updatedLeads: 0,
  };
  /** Sources that failed in this run, with the reason ("Bing News (HTTP 429)"): named in the progress line. */
  readonly failedSources: string[] = [];
  constructor(
    private readonly db: Db,
    private readonly runId: string,
  ) {}

  async emit(stage: RunStage, message: string): Promise<void> {
    const counters = { ...this.counters };
    try {
      await this.db.query("insert into run_events (run_id, stage, message, counters) values ($1, $2, $3, $4::jsonb)", [
        this.runId, stage, message.slice(0, 1000), JSON.stringify(counters),
      ]);
      await this.db.query("update runs set counters = $2::jsonb where id = $1", [this.runId, JSON.stringify(counters)]);
    } catch (error) {
      console.error("[pipeline] could not write run event", error);
    }
  }

  /** "Searched 3 of 5 sources · read 24 items · 6 relevant · 3 new leads" */
  summary(): string {
    const c = this.counters;
    const failed = this.failedSources.length ? [`${this.failedSources.length === 1 ? "1 source" : `${this.failedSources.length} sources`} failed: ${this.failedSources.join("; ")}`] : [];
    return [`Searched ${c.sourcesDone + c.sourcesFailed} of ${c.sourcesTotal} sources`, `read ${c.itemsRead} items`, `${c.relevant} relevant`, `${c.newLeads} new raw lead records`,
      ...(c.scopedProspects === undefined ? [] : [`${c.scopedProspects} buyer prospects saved`]), ...failed].join(" · ");
  }
}

async function isCancelled(db: Db, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ status: string }>("select status from runs where id = $1", [runId]);
  return rows[0]?.status === "cancelled";
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A short, user-facing reason for a failed source, shown on the Find screen. Never contains URLs,
 * response bodies or stack detail (those stay in the server log). Exported for tests.
 */
export function sourceFailureReason(error: unknown): string {
  const text = errorText(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || /timeout|timed out|aborted/i.test(text)) return "didn't answer in time";
  if (/rate limit|HTTP 429/i.test(text)) return "rate limited, try again in a minute";
  const http = text.match(/HTTP (\d{3})/);
  if (http) return `server error ${http[1]}`;
  if (/non-JSON|too large|unexpected|parse/i.test(text)) return "sent an unreadable answer";
  if (/all .* failed/i.test(text)) return "every request failed";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(text)) return "couldn't be reached";
  return "didn't work this time";
}

/**
 * Documents sent to AI extraction per run (MVP_MAX_AI_DOCS, default 20). Structured notices need no AI.
 * One news item costs ~3.5k Groq tokens (P1+P2+P3), so 20 items ≈ 70k of the 180k daily budget.
 */
export function maxAiDocsPerRun(): number {
  const n = Number(process.env.MVP_MAX_AI_DOCS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}

const TITLE_ACTION = /\b(?:award|awarded|awards|wins|won|secures?|secured|bags?|order|orders|contract|tender|bid|rfq|prequalification)\b/i;

/** Rank a news document for AI reading: buying action and scope in the headline, product words, freshness. */
export function aiPriority(item: { raw: RawDoc; stored: { text: string } }, profile: ReturnType<typeof getClientProfile>, productId?: string): number {
  const title = item.raw.title ?? "";
  const text = item.stored.text;
  const products = profile.products.filter((p) => p.active).flatMap((p) => p.keywords.map((k) => k.toLowerCase()));
  let score = 0;
  if (TITLE_ACTION.test(title)) score += 3;
  if (findScope(title, scopeTermsFor(profile, []))) score += 2;
  if (products.some((k) => hasTerm(text, k))) score += 2;
  if (/\b(?:EPC|engineering, procurement and construction)\b/i.test(text)) score += 1;
  if(productId) {
    // Only reading priority, never proof of buyer fit. Scarce AI slots should favour
    // construction/procurement buyers of the searched product over sellers' order news.
    const product=getCatalogueItem(productId);
    if(product?.keywords.some(k=>hasTerm(title,k)))score+=4;
    if(product?.keywords.some(k=>hasTerm(text,k)))score+=2;
    const buyingWork=/\b(?:EPC|contractor|subcontractor|construction|installation|procurement)\b/i.test(title);
    if(buyingWork)score+=5;
    if(!buyingWork && /\b(?:manufacturer|pipe mill|stockist)\b|\b(?:steel )?pipes?\s+(?:supply )?(?:orders?|supply contracts?)\b/i.test(title))score-=6;
    if(/\b(?:invites? bids?|open tender|tender invitation)\b/i.test(title))score-=8;
  }
  if (item.raw.publishedAt) {
    const ageDays = (Date.now() - new Date(item.raw.publishedAt).getTime()) / 86_400_000;
    score += ageDays <= 30 ? 2 : ageDays <= 120 ? 1 : 0;
  }
  return score;
}

/** Never expose provider bodies/credentials through the progress API. */
function safeBuyerAnalysisError(error:unknown):string {
  if(error instanceof Error && /Invalid buyer response field:/.test(error.message))return error.message.slice(0,300);
  if(error instanceof Error && /Buyer analysis failed/.test(error.message))return error.message;
  if(error instanceof SyntaxError)return "Buyer analysis returned malformed JSON. No invented result was saved.";
  if(error instanceof Error && error.name==="ZodError")return "Buyer analysis returned an invalid response structure. No invented result was saved.";
  if(error instanceof Error && /quota|rate.?limit|429/i.test(error.message))return "AI quota/rate limit prevented buyer analysis.";
  return "Buyer analysis could not complete; no unsupported result was saved. Check the provider/database setup.";
}
async function analyseBuyerPages(runId:string,input:RunInput,readable:BuyerPage[],db:Db,progress:Progress) {
  const candidates=readable.filter(item=>buyerPageCandidate(item.stored.text,input.productId!));
  progress.counters.relevant=candidates.length;
  const cachedIds=new Set((await db.query<{document_id:string}>(`select distinct cache.document_id from buyer_discovery_cache cache join source_documents d on d.id=cache.document_id and d.content_hash=cache.content_hash
    where cache.document_id=any($1::uuid[]) and cache.product_id=$2 and cache.version=$3`,[candidates.map(c=>c.stored.id),input.productId,DISCOVERY_VERSION])).rows.map(row=>row.document_id));
  const ranked=[...candidates].sort((a,b)=>buyerResearchPriority(b.raw,b.stored.text,input)-buyerResearchPriority(a.raw,a.stored.text,input));
  const selected=[...ranked.filter(item=>cachedIds.has(item.stored.id)),...ranked.filter(item=>!cachedIds.has(item.stored.id)).slice(0,maxAiDocsPerRun())];
  progress.counters.buyerPagesChecked=selected.length;progress.counters.deferredPages=candidates.length-selected.length;
  await progress.emit("extract",`Checking ${selected.length} buying-work pages; ${candidates.length-selected.length} deferred by the AI budget. Scores rank results only; original product and company evidence is required.`);
  let failed=0;
  for(const item of selected){
    if(await isCancelled(db,runId))return;
    try{
      const result=await discoverBuyers(db,runId,input,item.stored,item.raw);
      progress.counters.factsDropped+=result.invalid;
      for(const buyer of result.buyers){if(await saveBuyer(db,runId,input,item.stored.id,item.raw,buyer))progress.counters.factsKept++;}
      await progress.emit("check",`${result.buyers.length} evidence-supported potential buyers in ${item.raw.title??'page'}${result.cached?' (cached; no extra AI call)':''}`);
      for(const reason of result.rejections.slice(0,5))await progress.emit("info",`Not saved: ${reason}`);
    }catch(error){failed++;await progress.emit("error",safeBuyerAnalysisError(error));}
  }
  progress.counters.buyerAnalysisFailed=failed;
  progress.counters.scopedProspects=(await db.query<{count:number}>("select count(*)::int as count from search_opportunities where run_id=$1",[runId])).rows[0].count;
  if(selected.length&&failed===selected.length)throw new Error("Buyer analysis failed for every selected page. This is not a completed zero-buyer search.");
  await progress.emit("score","Reference scores assigned for sorting only. Email eligibility uses evidence and contact validation, not a minimum score.");
  await progress.emit("done",`${progress.counters.scopedProspects} buyer prospects saved. ${failed?'Some analysis failed; coverage is incomplete.':progress.counters.scopedProspects?'Open results to see evidence and demo outreach.':'No companies met the evidence checks within this research budget; continue saved pages to check more.'}`);
  await db.query("update runs set status='done',finished_at=now(),counters=$2::jsonb where id=$1 and status<>'cancelled'",[runId,JSON.stringify(progress.counters)]);
}

// ───────────────────────── the run ─────────────────────────

interface Relevant {
  stored: StoredDoc;
  raw: RawDoc;
  market: string | null;
}

/**
 * Execute a run to completion. Never throws: any error ends the run as 'failed' with the message.
 * Exported for tests (startRun calls it in the background).
 */
export async function executeRun(runId: string, input: RunInput, db: Db = getDb()): Promise<void> {
  const progress = new Progress(db, runId);
  try {
    await db.query("update runs set status = 'running', started_at = now() where id = $1 and status = 'queued'", [runId]);
    ensureMockExtractor();
    const profile = getClientProfile();
    const terms = queryTerms(input.query);
    // Fixtures only when MVP_OFFLINE=1 or when this run asks for sample data (RunInput.offline).
    const offline = input.offline === true || mvpEnv.offline();
    const ctx: SourceContext = { db,runId, input, profile, terms, log: (message) => progress.emit("info", message) };

    // ── collect ──
    const sources = offline ? [fixturesSource] : liveSources();
    progress.counters.sourcesTotal = sources.length;
    await progress.emit("collect", offline ? `Offline mode: searching sample data for ${input.markets.join(", ")}` : `Searching ${sources.length} sources for "${input.query || "client products"}"`);
    let raws: RawDoc[] = [];
    await Promise.all(
      sources.map(async (source) => {
        try {
          const docs = await source.collect(ctx);
          raws.push(...docs);
          progress.counters.sourcesDone++;
          await progress.emit("collect", `${source.name}: ${docs.length} items · Searched ${progress.counters.sourcesDone + progress.counters.sourcesFailed} of ${progress.counters.sourcesTotal} sources`);
        } catch (error) {
          // sourcesDone counts sources that answered; the UI shows done + failed as "searched".
          progress.counters.sourcesFailed++;
          // Full detail (URLs, bodies) goes to the server log only; the run line gets a plain reason.
          console.warn(`[pipeline] source ${source.name} failed:`, errorText(error));
          const reason = sourceFailureReason(error);
          progress.failedSources.push(`${source.name} (${reason})`);
          await progress.emit("collect", `${source.name} failed: ${reason} · Searched ${progress.counters.sourcesDone + progress.counters.sourcesFailed} of ${progress.counters.sourcesTotal} sources`);
        }
      }),
    );
    if (!offline && raws.length === 0) {
      if (progress.counters.sourcesFailed === sources.length)
        throw new Error("All live sources failed. No sample data was substituted. Retry when the sources are available.");
      await progress.emit("collect", "Live sources returned no documents. No sample data was substituted.");
    }
    if (raws.length > MAX_DOCS_PER_RUN) {
      // Keep structured and fixture documents first, then the newest.
      raws.sort((a, b) => Number(Boolean(b.text)) - Number(Boolean(a.text)) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
      raws = raws.slice(0, MAX_DOCS_PER_RUN);
    }
    if (await isCancelled(db, runId)) return;

    // ── read ──
    await progress.emit("read", `Reading ${raws.length} items`);
    let known = 0;
    let unreadable = 0;
    const stored = await mapLimit(raws, READ_CONCURRENCY, async (raw) => {
      let text = raw.text;
      let title = raw.title;
      // The article's own date wins over the feed's (a feed may re-surface an old story).
      let publishedAt = raw.publishedAt;
      if (!text) {
        const fetched = await fetchPageText(raw.url);
        if (fetched.ok) {
          // Keep the original page's own headline: Readability can otherwise remove its company identity.
          text = fetched.title && !fetched.text.includes(fetched.title) ? `${fetched.title}\n${fetched.text}` : fetched.text;
          title = fetched.title ?? title;
          publishedAt = fetched.publishedAt ?? publishedAt;
        } else if (raw.fallbackText) {
          text = raw.fallbackText;
        } else {
          unreadable++;
          return null;
        }
      }
      try {
        const doc = await storeDocument(db, runId, { ...raw, title, text, publishedAt, publisherKey: raw.publisherKey ?? publisherKeyFor(raw.url) });
        await db.query("insert into run_documents (run_id, document_id) values ($1,$2) on conflict do nothing", [runId, doc.id]);
        // Hash/URL dedup can select a previously stored original. Keep THAT source's provenance,
        // instead of attaching its quotes to a different discovered mirror URL.
        const original=(await db.query<{url:string;title:string|null;source_key:string;source_name:string;tier:RawDoc['tier'];publisher_key:string;published_at:string|null;is_sample:boolean}>("select url,title,source_key,source_name,tier,publisher_key,published_at,is_sample from source_documents where id=$1",[doc.id])).rows[0];
        progress.counters.itemsRead++;
        if (doc.state === "known") known++;
        if (progress.counters.itemsRead % 5 === 0) await progress.emit("read", `Read ${progress.counters.itemsRead} items`);
        return { stored: doc, raw: { ...raw,url:original.url,title:original.title,text:doc.text,publishedAt:original.published_at,sourceKey:original.source_key,sourceName:original.source_name,tier:original.tier,publisherKey:original.publisher_key,isSample:original.is_sample } };
      } catch (error) {
        unreadable++;
        console.error("[pipeline] store failed", raw.url, error);
        return null;
      }
    });
    const readable = stored.filter((d) => d !== null);
    await progress.emit(
      "read",
      `Read ${progress.counters.itemsRead} items${known ? ` (${known} already known)` : ""}${unreadable ? ` · ${unreadable} could not be read` : ""}`,
    );
    if (await isCancelled(db, runId)) return;

    // Product-scoped live research is company-first, not the legacy award/news lead builder.
    // One extraction per selected page; known documents use a product/version/content-aware cache.
    if(!offline && input.productId && readable.length) {
      await analyseBuyerPages(runId,input,readable,db,progress);
      return;
    }

    // ── filter ──
    const relevant: Relevant[] = [];
    for (const { stored: doc, raw } of readable) {
      // Known documents are skipped, except those deferred earlier by the AI cap (status still 'new').
      if (doc.state === "known" && doc.status !== "new") {
        if (doc.status === "extracted") progress.counters.relevant++;
        continue;
      }
      // Structured notices (TED) go through the same rules; their market is the buyer country.
      let verdict = filterDocument({ title: raw.title, text: doc.text, publishedAt: raw.publishedAt, markets: input.markets, queryTerms: terms, profile, sourceMarket: raw.market });
      if (raw.structured && verdict.verdict !== "drop") verdict = { ...verdict, verdict: "relevant", reason: `structured notice; ${verdict.reason}` };
      if (verdict.verdict === "uncertain") {
        const t = offline ? { relevant: null, reason: "no AI triage for sample data" } : await triage(doc.text, raw.url, db, runId);
        verdict =
          t.relevant === true
            ? { verdict: "relevant", reason: `${verdict.reason}; ${t.reason}`, markets: verdict.markets }
            : { verdict: "drop", reason: `${verdict.reason}; ${t.reason}`, markets: [] };
      }
      const status = verdict.verdict === "relevant" ? "queued" : "filtered_out";
      await db.query("update source_documents set status = $2, filter_reason = $3 where id = $1", [doc.id, status, verdict.reason.slice(0, 500)]);
      if (verdict.verdict === "relevant") {
        progress.counters.relevant++;
        relevant.push({ stored: doc, raw, market: raw.market ?? verdict.markets[0] ?? detectMarkets(doc.text)[0] ?? null });
      }
    }
    await progress.emit("filter", `${progress.counters.relevant} relevant of ${progress.counters.itemsRead} items read`);
    if (await isCancelled(db, runId)) return;

    // ── AI cap ── free AI tiers allow a few documents a minute: read the most promising first.
    const cap = maxAiDocsPerRun();
    const needsAi = relevant.filter((r) => !r.raw.structured && !r.raw.isSample);
    if (!offline && needsAi.length > cap) {
      const ranked = [...needsAi].sort((a, b) => aiPriority(b, profile,input.productId) - aiPriority(a, profile,input.productId));
      const deferred = new Set(ranked.slice(cap));
      for (const item of deferred) {
        await db.query("update source_documents set status = 'new', filter_reason = $2 where id = $1", [item.stored.id, "deferred: per-run AI limit (read in a later run)"]);
      }
      relevant.splice(0, relevant.length, ...relevant.filter((r) => !deferred.has(r)));
      await progress.emit("info", `AI reads the ${cap} most promising of ${needsAi.length} news items this run (free AI limit); the other ${deferred.size} wait for the next run`);
    }

    // ── extract → check → resolve ──
    if (relevant.length) await progress.emit("extract", `Extracting facts from ${relevant.length} documents`);
    let docsDone = 0;
    for (const item of relevant) {
      try {
        const extracted = await extractDocument(
          { text: item.stored.text, url: item.raw.url, structured: item.raw.structured, publishedAt: item.raw.publishedAt },
          { db, runId, onNote: (message) => progress.emit("info", message), rulesOnly: offline },
        );
        progress.counters.factsKept += extracted.stats.kept;
        progress.counters.factsDropped += extracted.stats.dropped;
        await db.tx((tx) =>
          resolveDocument(
            tx,
            {
              documentId: item.stored.id,
              url: item.raw.url,
              tier: item.raw.tier,
              publisherKey: item.raw.publisherKey ?? publisherKeyFor(item.raw.url),
              market: item.market,
              publishedAt: item.raw.publishedAt,
              text: item.stored.text,
            },
            extracted,
          ),
        );
        await db.query("update source_documents set status = 'extracted' where id = $1", [item.stored.id]);
      } catch (error) {
        console.error("[pipeline] extract/resolve failed", item.raw.url, error);
        await db.query("update source_documents set status = 'failed', filter_reason = $2 where id = $1", [item.stored.id, `extract failed: ${errorText(error)}`.slice(0, 500)]);
        await progress.emit("error", `Could not process ${item.raw.title ?? item.raw.url}: ${errorText(error)}`);
      }
      docsDone++;
      if (docsDone % 3 === 0 || docsDone === relevant.length) {
        await progress.emit("check", `Checked quotes: ${progress.counters.factsKept} facts kept, ${progress.counters.factsDropped} dropped (${docsDone} of ${relevant.length} documents)`);
      }
      if (await isCancelled(db, runId)) return;
    }
    if (relevant.length) await progress.emit("resolve", `Linked companies, projects and people from ${relevant.length} documents`);

    // ── signals + score ── (a scoring failure fails the run: 0 leads must not look like a clean finish)
    await progress.emit("score", "Scoring…");
    try {
      const result = await buildSignalsAndScore(runId);
      progress.counters.newLeads = result.created;
      progress.counters.updatedLeads = result.updated;
    } catch (error) {
      console.error("[pipeline] scoring failed", error);
      throw new Error(`Scoring failed: ${errorText(error)}`);
    }

    const scoped = await captureOpportunities(runId, input, db);
    if (input.productId) progress.counters.scopedProspects = scoped;
    if (input.productId) await progress.emit("info", `${scoped} product-matched buyer prospects saved to this search. Contact validation is a separate step.`);
    // ── done ──
    await progress.emit("done", `Done: ${progress.summary()}${progress.counters.updatedLeads ? ` · ${progress.counters.updatedLeads} updated` : ""}`);
    await db.query("update runs set status = 'done', finished_at = now(), counters = $2::jsonb where id = $1 and status <> 'cancelled'", [runId, JSON.stringify(progress.counters)]);
  } catch (error) {
    console.error("[pipeline] run failed", error);
    await progress.emit("error", `Run failed: ${errorText(error)}`).catch(() => undefined);
    await db
      .query("update runs set status = 'failed', finished_at = now(), error = $2, counters = $3::jsonb where id = $1 and status <> 'cancelled'", [runId, errorText(error).slice(0, 1000), JSON.stringify(progress.counters)])
      .catch(() => undefined);
  }
}
