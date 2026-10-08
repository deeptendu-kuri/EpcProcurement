/**
 * Read step (05 §4, §6): polite fetching, robots.txt, main-text extraction, normalisation, hashing,
 * de-duplication and storage in source_documents.
 *
 * - Fetch: 20 s timeout, custom User-Agent (CRAWL_USER_AGENT, default "BoroTechLeadBot/0.1"),
 *   at least 5 s between requests to the same host, robots.txt Disallow rules respected (cached).
 * - HTML main text: @mozilla/readability on jsdom; falls back to stripped body text.
 * - Text PDFs are parsed in a bounded worker; scanned documents need separate OCR.
 * - Dedupe: same canonical URL + same hash → known (not re-processed); same URL + new hash → changed
 *   (re-processed); same hash under another URL → known.
 */
import type { Queryable } from "@/mvp/db";
import type { RawDoc } from "./contracts";
import { BlockedUrlError, assertPublicHttpUrl, guardedLookup } from "./net-guard";
import { canonicalUrl, cleanText, hostOf, publisherKeyFor, sha256 } from "./text";

export const FETCH_TIMEOUT_MS = 20_000;
export const MIN_DOMAIN_INTERVAL_MS = 5_000;
/** Stored text is capped to keep the database small (the slice stores text inline). */
export const MAX_TEXT_CHARS = 60_000;

export function userAgent(): string {
  return process.env.CRAWL_USER_AGENT?.trim() || "BoroTechLeadBot/0.1 (+contact: set CRAWL_USER_AGENT)";
}

// ───────────────────────── politeness ─────────────────────────

const g = globalThis as unknown as { __mvpNextSlot?: Map<string, number>; __mvpRobots?: Map<string, Promise<string[]>> };
const nextSlot = (g.__mvpNextSlot ??= new Map<string, number>());
const robotsCache = (g.__mvpRobots ??= new Map<string, Promise<string[]>>());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until this host may be requested again (≥ intervalMs since the previous reserved slot). */
export async function politeWait(host: string, intervalMs = MIN_DOMAIN_INTERVAL_MS): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + intervalMs);
  if (slot > now) await sleep(slot - now);
}

/** Largest response body we read (bytes). Anything beyond is cut off, so a huge page cannot exhaust memory. */
export const MAX_BODY_BYTES = 3_000_000;

export interface SimpleResponse {
  status: number;
  ok: boolean;
  url: string;
  contentType: string;
  text: string;
  bytes?: Uint8Array;
  /** True when the body was cut at maxBytes. */
  truncated?: boolean;
}

/** Read a fetch body with a byte cap; stops (and cancels the stream) once the cap is passed. */
async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; bytes?:Uint8Array; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let size = 0;
  let text = "";
  const chunks: Uint8Array[]=[];
  const bytes=()=>Buffer.concat(chunks);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0,Math.max(0,remaining)));
        text += decoder.decode(value.subarray(0, Math.max(0, remaining)));
        await reader.cancel().catch(() => undefined);
        return { text, bytes:bytes(), truncated: true };
      }
      size += value.byteLength;
      chunks.push(value);
      text += decoder.decode(value, { stream: true });
    }
    return { text: text + decoder.decode(), bytes:bytes(), truncated: false };
  } finally {
    reader.releaseLock();
  }
}

/** Most redirect hops we follow. Each hop is re-checked by the SSRF guard (and `beforeHop`). */
export const MAX_REDIRECTS = 5;

export interface FetchGuardOptions {
  /** Called before every hop after the first (e.g. robots.txt + politeness for the new URL). Throw to stop. */
  beforeHop?: (url: string) => Promise<void>;
}

function timeoutError(timeoutMs: number, url: string): Error {
  return Object.assign(new Error(`timeout after ${timeoutMs} ms: ${url}`), { name: "AbortError" });
}

/**
 * fetch() with our User-Agent and ONE deadline that covers connect, headers, every redirect hop and
 * the whole body, which is read with a byte cap. Redirects are followed by hand (max MAX_REDIRECTS):
 * every hop must pass the SSRF guard (public http(s) only) and `beforeHop`.
 */
export async function timedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
  maxBytes = MAX_BODY_BYTES,
  options: FetchGuardOptions = {},
): Promise<SimpleResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Object.assign(new Error("timeout"), { name: "AbortError" })), timeoutMs);
  let current = url;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  try {
    for (let hop = 0; ; hop += 1) {
      await assertPublicHttpUrl(current);
      if (hop > 0) await options.beforeHop?.(current);
      const res = await fetch(current, {
        ...init,
        method,
        body,
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": userAgent(), Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5", ...(init.headers ?? {}) },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => undefined);
        if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects: ${url}`);
        current = new URL(location, current).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
        }
        continue;
      }
      const capped = await readCapped(res, maxBytes);
      return { status: res.status, ok: res.ok, url: current, contentType: res.headers.get("content-type") ?? "", ...capped };
    }
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError(timeoutMs, current);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET over node:https/http, used when fetch() fails to connect. Follows up to MAX_REDIRECTS redirects,
 * re-checking every hop with the SSRF guard and `beforeHop`; DNS answers are checked again at
 * connect time (guardedLookup), so a rebinding host cannot reach a private address.
 */
async function nodeGet(
  url: string,
  timeoutMs: number,
  accept: string,
  options: FetchGuardOptions = {},
  hop = 0,
  deadline = Date.now() + timeoutMs,
): Promise<SimpleResponse> {
  await assertPublicHttpUrl(url);
  if (hop > 0) await options.beforeHop?.(url);
  const { request } = url.startsWith("https:") ? await import("node:https") : await import("node:http");
  return new Promise<SimpleResponse>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(timeoutError(timeoutMs, url));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(total);
      fn();
    };
    const req = request(
      url,
      { method: "GET", headers: { "User-Agent": userAgent(), Accept: accept }, timeout: remaining, lookup: guardedLookup },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (hop >= MAX_REDIRECTS) {
            finish(() => reject(new Error(`too many redirects: ${url}`)));
            return;
          }
          const next = new URL(res.headers.location, url).toString();
          finish(() => nodeGet(next, timeoutMs, accept, options, hop + 1, deadline).then(resolve, reject));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const done = () =>
          finish(() =>
            resolve({ status, ok: status >= 200 && status < 300, url, contentType: String(res.headers["content-type"] ?? ""), text: Buffer.concat(chunks).toString("utf8"), bytes:Buffer.concat(chunks), truncated }),
          );
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          const left = MAX_BODY_BYTES - size;
          if (chunk.length > left) {
            chunks.push(chunk.subarray(0, Math.max(0, left)));
            truncated = true;
            done();
            req.destroy();
            return;
          }
          size += chunk.length;
          chunks.push(chunk);
        });
        res.on("end", done);
        res.on("error", (error) => finish(() => reject(error)));
      },
    );
    // Total deadline (the socket `timeout` option is only an idle timeout).
    const total = setTimeout(() => {
      const error = timeoutError(timeoutMs, url);
      finish(() => reject(error));
      req.destroy(error);
    }, remaining);
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { name: "AbortError" })));
    req.on("error", (error) => finish(() => reject(error)));
    req.end();
  });
}

/**
 * GET a URL as text: fetch() first, then node:https when fetch cannot connect (seen on some networks
 * where undici's 10 s connect timeout trips). Throws on network failure of both, on a timeout, and
 * on a URL (or redirect hop) blocked by the SSRF guard. The deadline covers the whole body; bodies
 * are capped at MAX_BODY_BYTES.
 */
export async function getText(
  url: string,
  accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
  timeoutMs = FETCH_TIMEOUT_MS,
  options: FetchGuardOptions = {},
): Promise<SimpleResponse> {
  try {
    return await timedFetch(url, { headers: { Accept: accept } }, timeoutMs, MAX_BODY_BYTES, options);
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error instanceof BlockedUrlError)) throw error;
    if (error instanceof RobotsDisallowedError || (error instanceof Error && /too many redirects/.test(error.message))) throw error;
    return nodeGet(url, timeoutMs, accept, options);
  }
}

// ───────────────────────── robots.txt ─────────────────────────

/** Disallow path prefixes that apply to us (group "*" or our bot name). Exported for tests. */
export function parseRobots(body: string, agent = userAgent()): string[] {
  const token = agent.split(/[/\s]/)[0].toLowerCase();
  const groups: { agents: string[]; disallow: string[]; allowAll: boolean }[] = [];
  let current: { agents: string[]; disallow: string[]; allowAll: boolean } | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allowAll: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (key === "disallow") {
        if (value) current.disallow.push(value);
        else current.allowAll = true;
      }
    }
  }
  const mine = groups.filter((grp) => grp.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = mine.length ? mine : groups.filter((grp) => grp.agents.includes("*"));
  return chosen.flatMap((grp) => grp.disallow);
}

function pathMatches(path: string, rule: string): boolean {
  if (!rule.includes("*") && !rule.endsWith("$")) return path.startsWith(rule);
  const re = new RegExp("^" + rule.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
  return re.test(path);
}

/** True when robots.txt of the URL's origin allows us to fetch it (unreachable robots.txt = allowed). */
export async function robotsAllowed(url: string): Promise<boolean> {
  let origin: string;
  let path: string;
  try {
    const u = new URL(url);
    origin = u.origin;
    path = u.pathname + u.search;
  } catch {
    return false;
  }
  let pending = robotsCache.get(origin);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await getText(`${origin}/robots.txt`, "text/plain", 10_000);
        if (!res.ok) return [];
        return parseRobots(res.text);
      } catch {
        return [];
      }
    })();
    robotsCache.set(origin, pending);
  }
  const rules = await pending;
  return !rules.some((rule) => pathMatches(path, rule));
}

// ───────────────────────── main text ─────────────────────────

/** ISO timestamp from a date string, or null when it doesn't parse (or is in the future). */
function isoOrNull(value: string | null | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const time = Date.parse(value.trim());
  if (!Number.isFinite(time) || time > now + 36 * 3_600_000 || time < Date.UTC(1995, 0, 1)) return null;
  return new Date(time).toISOString();
}

/**
 * The article's own publication date from its HTML: meta article:published_time / og / Dublin Core /
 * itemprop, JSON-LD datePublished, or the first <time datetime>. Feed dates (Bing, RSS) are only the
 * date a feed saw the page, so this date wins over them (13 §11). Exported for tests.
 */
export function pagePublishedAt(doc: Document): string | null {
  const metaNames = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="publish-date"]',
    'meta[name="pubdate"]',
    'meta[name="date"]',
    'meta[name="DC.date.issued"]',
    'meta[itemprop="datePublished"]',
  ];
  for (const selector of metaNames) {
    const found = isoOrNull(doc.querySelector(selector)?.getAttribute("content"));
    if (found) return found;
  }
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const match = script.textContent?.match(/"datePublished"\s*:\s*"([^"]+)"/);
    const found = isoOrNull(match?.[1]);
    if (found) return found;
  }
  return isoOrNull(doc.querySelector("time[datetime]")?.getAttribute("datetime"));
}

/** Main text of an HTML page (Readability, then plain body text as fallback) and its publication date. */
export async function htmlToText(html: string, url: string, fullPage = false): Promise<{ title: string | null; text: string; publishedAt: string | null; links:{url:string;text:string}[]; tables:string[][][] }> {
  const [{ JSDOM }, { Readability }] = await Promise.all([import("jsdom"), import("@mozilla/readability")]);
  // Scraping needs article text, not layout. Removing style blocks before DOM construction
  // avoids costly stylesheet parsing (and repeated CSS errors) on large news websites.
  const articleHtml=html.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi," ");
  const dom = new JSDOM(articleHtml, { url });
  try {
    const doc = dom.window.document;
    const pageTitle = doc.title || null;
    const publishedAt = pagePublishedAt(doc);
    const links=[...doc.querySelectorAll('a[href]')].flatMap(a=>{
      try{const target=new URL(a.getAttribute('href')!,url);target.hash='';
        return /^https?:$/.test(target.protocol)?[{url:target.href,text:cleanText(a.textContent??'').slice(0,160)}]:[];
      }catch{return [];}
    }).slice(0,300);
    const tables=[...doc.querySelectorAll('table')].map(table=>[...table.querySelectorAll('tr')]
      .map(row=>[...row.querySelectorAll('th,td')].map(cell=>cleanText(cell.textContent??'')))).slice(0,20);
    // Keep JSON-LD long enough to read publication dates, then prevent code from becoming
    // fallback article/contact "evidence" on pages that Readability cannot identify.
    doc.querySelectorAll("script,style,noscript,template").forEach(node=>node.remove());
    // Contact details are often in the footer, outside Readability's article. This
    // mode retains original visible body text, never scripts or guessed values.
    if(fullPage) {
      // Rows stay atomic; adjacent company contacts can never bleed into another row.
      doc.querySelectorAll('tr').forEach(row=>row.replaceWith(doc.createTextNode('\n'+[...row.querySelectorAll('th,td')].map(c=>cleanText(c.textContent??'')).join(' | ')+'\n')));
      doc.querySelectorAll("br,p,div,li,section,h1,h2,h3,h4").forEach(node=>node.before(doc.createTextNode("\n")));
      return {title:pageTitle,text:cleanText(doc.body?.textContent??""),publishedAt,links,tables};
    }
    const article = new Readability(doc.cloneNode(true) as Document).parse();
    const text = article?.textContent?.trim() ? article.textContent : (doc.body?.textContent ?? "");
    return { title: article?.title || pageTitle, text: cleanText(text), publishedAt,links,tables };
  } finally {
    dom.window.close();
  }
}

/** Strip tags from an HTML fragment (RSS descriptions). */
export function stripHtml(html: string): string {
  return cleanText(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

export type FetchOutcome =
  | { ok: true; title: string | null; text: string; finalUrl?:string; publishedAt?: string | null;
      links?:{url:string;text:string}[]; tables?:string[][][]; pages?:{page:number;text:string}[]; truncated?:boolean; format?:"html"|"pdf" }
  | { ok: false; reason: "robots" | "pdf" | "http" | "timeout" | "empty" | "error" | "resource" | "pdf_parse" | "ocr_needed"; detail?: string };

/** Thrown by fetchPageText's redirect hook when robots.txt disallows a redirect target. */
export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`disallowed by robots.txt: ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

/**
 * Politely fetch a page and return its cleaned main text. Never throws. Only public http(s) URLs are
 * fetched (SSRF guard), and every redirect hop is re-checked against the guard, robots.txt and the
 * per-host politeness delay.
 */
export async function fetchPageText(url: string, options: { fullPage?: boolean; maxPdfPages?:number;allowUrl?:(url:string)=>boolean } = {}): Promise<FetchOutcome> {
  const host = hostOf(url);
  if (!host) return { ok: false, reason: "error", detail: "bad url" };
  try {
    if(options.allowUrl&&!options.allowUrl(url))return {ok:false,reason:'error',detail:'Excluded source.'};
    await assertPublicHttpUrl(url);
    if (!(await robotsAllowed(url))) return { ok: false, reason: "robots", detail: "disallowed by robots.txt" };
    await politeWait(host);
    const res = await getText(url, undefined, FETCH_TIMEOUT_MS, {
      beforeHop: async (next) => {
        if(options.allowUrl&&!options.allowUrl(next))throw new Error('Excluded redirect source.');
        if (!(await robotsAllowed(next))) throw new RobotsDisallowedError(next);
        const nextHost = hostOf(next);
        if (nextHost && nextHost !== host) await politeWait(nextHost);
      },
    });
    if (!res.ok) return { ok: false, reason: "http", detail: `HTTP ${res.status}` };
    const type = res.contentType;
    if (/pdf/i.test(type)||/\.pdf(?:$|\?)/i.test(url)||res.text.startsWith('%PDF-')) {
      if(res.truncated||!res.bytes)return {ok:false,reason:'resource',detail:'PDF byte ceiling exceeded.'};
      const {parsePdf}=await import('./pdf');const parsed=await parsePdf(res.bytes,options.maxPdfPages??10);
      if(!parsed.ok)return parsed;
      return {...parsed,title:null,finalUrl:res.url||url,publishedAt:null,format:'pdf'};
    }
    if (type && !/html|xml|text/i.test(type)) return { ok: false, reason: "error", detail: `unsupported content-type ${type}` };
    const { title, text, publishedAt,links,tables } = await htmlToText(res.text.slice(0, 2_000_000), res.url || url, options.fullPage);
    if (text.length < 200) return { ok: false, reason: "empty", detail: "too little text" };
    return { ok: true, title, text: text.slice(0, MAX_TEXT_CHARS), publishedAt, finalUrl:res.url||url,links,tables,format:'html',truncated:Boolean(res.truncated)||res.text.length>2_000_000||text.length>MAX_TEXT_CHARS };
  } catch (error) {
    if (error instanceof RobotsDisallowedError) return { ok: false, reason: "robots", detail: error.message };
    if (error instanceof BlockedUrlError) return { ok: false, reason: "error", detail: error.message };
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, reason: aborted ? "timeout" : "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

// ───────────────────────── store ─────────────────────────

export interface StoredDoc {
  id: string;
  /** new = first time; changed = same URL with new content; known = already stored (not re-processed). */
  state: "new" | "changed" | "known";
  text: string;
  status: string;
}

/**
 * Normalise, hash and store a document (with text) in source_documents, de-duplicating.
 * Known documents that were already extracted are re-attached to `runId` so scoring of this run sees them.
 */
export async function storeDocument(db: Queryable, runId: string, raw: RawDoc & { text: string }): Promise<StoredDoc> {
  const text = cleanText(raw.text).slice(0, MAX_TEXT_CHARS);
  const hash = sha256(text);
  const canonical = canonicalUrl(raw.url);
  const publisherKey = raw.publisherKey ?? publisherKeyFor(raw.url);

  const byUrl = await db.query<{ id: string; content_hash: string; status: string; text: string | null }>(
    "select id, content_hash, status, text from source_documents where canonical_url = $1",
    [canonical],
  );
  const existing = byUrl.rows[0];
  if (existing && existing.content_hash === hash) {
    if (existing.status === "extracted") await db.query("update source_documents set run_id = $2 where id = $1", [existing.id, runId]);
    return { id: existing.id, state: "known", text: existing.text ?? text, status: existing.status };
  }
  if (existing) {
    await db.query(
      `update source_documents
          set text = $2, content_hash = $3, title = coalesce($4, title), published_at = coalesce($5, published_at),
              fetched_at = now(), status = 'new', filter_reason = null, run_id = $6, is_sample = $7
        where id = $1`,
      [existing.id, text, hash, raw.title, raw.publishedAt, runId, raw.isSample],
    );
    return { id: existing.id, state: "changed", text, status: "new" };
  }
  const byHash = await db.query<{ id: string; status: string; text: string | null }>(
    "select id, status, text from source_documents where content_hash = $1 and is_sample = $2 limit 1",
    [hash,raw.isSample],
  );
  if (byHash.rows[0]) {
    const dup = byHash.rows[0];
    if (dup.status === "extracted") await db.query("update source_documents set run_id = $2 where id = $1", [dup.id, runId]);
    return { id: dup.id, state: "known", text: dup.text ?? text, status: dup.status };
  }
  const inserted = await db.query<{ id: string }>(
    `insert into source_documents
       (source_key, source_name, tier, publisher_key, url, canonical_url, title, language, published_at, content_hash, text, status, run_id, is_sample)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'new', $12, $13)
     on conflict (canonical_url) do update set fetched_at = now()
     returning id`,
    [raw.sourceKey, raw.sourceName, raw.tier, publisherKey, raw.url, canonical, raw.title, raw.language ?? null, raw.publishedAt, hash, text, runId, raw.isSample],
  );
  return { id: inserted.rows[0].id, state: "new", text, status: "new" };
}
