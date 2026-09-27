import { mvpEnv } from "@/mvp/config/env";
import { getClientProfile } from "@/mvp/config/profile";
import { getDb, type Db } from "@/mvp/db";
import { buildSignalsAndScore } from "@/mvp/scoring";
import type { RunCounters, RunInput, RunStage } from "@/mvp/types";
import type { RawDoc, Source, SourceContext } from "./contracts";
import { ensureMockExtractor, extractDocument, triage } from "./extract";
import { detectMarkets, filterDocument, queryTerms } from "./filter";
import { fetchPageText, storeDocument, type StoredDoc } from "./read";
import { resolveDocument } from "./resolve";
import { fixturesSource } from "./sources/fixtures";
import { gdeltSource } from "./sources/gdelt";
import { rssSource } from "./sources/rss";
import { tedSource } from "./sources/ted";
import { publisherKeyFor } from "./text";

export { fixtureDocs } from "./sources/fixtures";

/** Documents read per run at most (keeps a "Search now" run to a few minutes on free quotas). */
export const MAX_DOCS_PER_RUN = 40;
const READ_CONCURRENCY = 3;

/** Live sources for a run (fixtures are the fallback). */
export function liveSources(): Source[] {
  return [tedSource, gdeltSource, rssSource];
}

/**
 * Start a "Search now" run (docs/mvp/12 §1 F1, 05, 06).
 *
 * Inserts a `runs` row (status 'queued' → 'running'), returns its id immediately, and continues in the
 * background: collect (TED, GDELT, RSS; fixtures when MVP_OFFLINE=1 or a source fails) → read → filter →
 * extract (getLLM('extract_a'/'extract_b'), mock in demo mode) → quote check → agreement → resolve →
 * graph, then calls `buildSignalsAndScore(runId)`. Progress is appended to `run_events` with
 * `RunCounters`; `runs.status` ends as 'done' or 'failed'. A failing source never stops the run.
 *
 * @param input query text, market codes (e.g. ["IN","SA"]) and lead kinds.
 * @returns the new run id (uuid).
 */
export async function startRun(input: RunInput): Promise<string> {
  const db = getDb();
  const clean: RunInput = {
    query: String(input.query ?? "").trim().slice(0, 300),
    markets: [...new Set((input.markets ?? []).map((m) => String(m).trim().toUpperCase()).filter(Boolean))],
    leadKinds: (input.leadKinds ?? []).filter((k) => k === "bid" || k === "supply_subcontract"),
  };
  if (!clean.leadKinds.length) clean.leadKinds = ["bid", "supply_subcontract"];
  if (!clean.markets.length) clean.markets = [...getClientProfile().markets];
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

/** In-flight runs (tests and the API can await them). */
function activeRuns(): Map<string, Promise<void>> {
  const g = globalThis as unknown as { __mvpActiveRuns?: Map<string, Promise<void>> };
  return (g.__mvpActiveRuns ??= new Map());
}

/** Resolves when the run started in this process finishes (immediately if unknown). */
export async function waitForRun(runId: string): Promise<void> {
  await activeRuns().get(runId);
}

// ───────────────────────── progress ─────────────────────────

class Progress {
  readonly counters: Required<Pick<RunCounters, "sourcesTotal" | "sourcesDone" | "sourcesFailed" | "itemsRead" | "relevant" | "factsKept" | "factsDropped" | "newLeads" | "updatedLeads">> = {
    sourcesTotal: 0, sourcesDone: 0, sourcesFailed: 0, itemsRead: 0, relevant: 0, factsKept: 0, factsDropped: 0, newLeads: 0, updatedLeads: 0,
  };
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
    return [`Searched ${c.sourcesDone} of ${c.sourcesTotal} sources`, `read ${c.itemsRead} items`, `${c.relevant} relevant`, `${c.newLeads} new leads`].join(" · ");
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
    const offline = mvpEnv.offline();
    const ctx: SourceContext = { runId, input, profile, terms, log: (message) => progress.emit("info", message) };

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
          await progress.emit("collect", `${source.name}: ${docs.length} items · Searched ${progress.counters.sourcesDone} of ${progress.counters.sourcesTotal} sources`);
        } catch (error) {
          progress.counters.sourcesDone++;
          progress.counters.sourcesFailed++;
          await progress.emit("collect", `${source.name} unavailable (${errorText(error)}) · Searched ${progress.counters.sourcesDone} of ${progress.counters.sourcesTotal} sources`);
        }
      }),
    );
    if (!offline && raws.length === 0) {
      progress.counters.sourcesTotal++;
      const why = progress.counters.sourcesFailed === sources.length ? "All live sources failed" : "Live sources returned nothing";
      await progress.emit("collect", `${why} – using sample data (marked "Sample data")`);
      raws = await fixturesSource.collect(ctx);
      progress.counters.sourcesDone++;
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
      if (!text) {
        const fetched = await fetchPageText(raw.url);
        if (fetched.ok) {
          text = fetched.text;
          title = title ?? fetched.title;
        } else if (raw.fallbackText) {
          text = raw.fallbackText;
        } else {
          unreadable++;
          return null;
        }
      }
      try {
        const doc = await storeDocument(db, runId, { ...raw, title, text, publisherKey: raw.publisherKey ?? publisherKeyFor(raw.url) });
        progress.counters.itemsRead++;
        if (doc.state === "known") known++;
        if (progress.counters.itemsRead % 5 === 0) await progress.emit("read", `Read ${progress.counters.itemsRead} items`);
        return { stored: doc, raw: { ...raw, title, text } };
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

    // ── filter ──
    const relevant: Relevant[] = [];
    for (const { stored: doc, raw } of readable) {
      if (doc.state === "known") {
        if (doc.status === "extracted") progress.counters.relevant++;
        continue;
      }
      // Structured notices (TED) go through the same rules; their market is the buyer country.
      let verdict = filterDocument({ title: raw.title, text: doc.text, publishedAt: raw.publishedAt, markets: input.markets, queryTerms: terms, profile, sourceMarket: raw.market });
      if (raw.structured && verdict.verdict !== "drop") verdict = { ...verdict, verdict: "relevant", reason: `structured notice; ${verdict.reason}` };
      if (verdict.verdict === "uncertain") {
        const t = await triage(doc.text, raw.url, db, runId);
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

    // ── extract → check → resolve ──
    if (relevant.length) await progress.emit("extract", `Extracting facts from ${relevant.length} documents`);
    let docsDone = 0;
    for (const item of relevant) {
      try {
        const extracted = await extractDocument(
          { text: item.stored.text, url: item.raw.url, structured: item.raw.structured },
          { db, runId, onNote: (message) => progress.emit("info", message) },
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

    // ── signals + score ──
    await progress.emit("score", "Scoring…");
    try {
      const result = await buildSignalsAndScore(runId);
      progress.counters.newLeads = result.created;
      progress.counters.updatedLeads = result.updated;
    } catch (error) {
      console.error("[pipeline] scoring failed", error);
      await progress.emit("error", `Scoring failed: ${errorText(error)}`);
    }

    // ── done ──
    await progress.emit("done", `Done: ${progress.summary()}${progress.counters.updatedLeads ? ` · ${progress.counters.updatedLeads} updated` : ""}`);
    await db.query("update runs set status = 'done', finished_at = now(), counters = $2::jsonb where id = $1 and status <> 'cancelled'", [runId, JSON.stringify(progress.counters)]);
  } catch (error) {
    console.error("[pipeline] run failed", error);
    await progress.emit("error", `Run failed: ${errorText(error)}`).catch(() => undefined);
    await db
      .query("update runs set status = 'failed', finished_at = now(), error = $2, counters = $3::jsonb where id = $1", [runId, errorText(error).slice(0, 1000), JSON.stringify(progress.counters)])
      .catch(() => undefined);
  }
}
