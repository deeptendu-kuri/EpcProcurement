/**
 * Read step (05 §4, §6): polite fetching, robots.txt, main-text extraction, normalisation, hashing,
 * de-duplication and storage in source_documents.
 *
 * - Fetch: 20 s timeout, custom User-Agent (CRAWL_USER_AGENT, default "BoroTechLeadBot/0.1"),
 *   at least 5 s between requests to the same host, robots.txt Disallow rules respected (cached).
 * - HTML main text: @mozilla/readability on jsdom; falls back to stripped body text.
 * - PDFs are skipped in the slice (the full MVP uses pdfplumber + OCR).
 * - Dedupe: same canonical URL + same hash → known (not re-processed); same URL + new hash → changed
 *   (re-processed); same hash under another URL → known.
 */
import type { Queryable } from "@/mvp/db";
import type { RawDoc } from "./contracts";
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
  /** True when the body was cut at maxBytes. */
  truncated?: boolean;
}

/** Read a fetch body with a byte cap; stops (and cancels the stream) once the cap is passed. */
async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      if (value.byteLength > remaining) {
        text += decoder.decode(value.subarray(0, Math.max(0, remaining)));
        await reader.cancel().catch(() => undefined);
        return { text, truncated: true };
      }
      size += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    return { text: text + decoder.decode(), truncated: false };
  } finally {
    reader.releaseLock();
  }
}

/**
 * fetch() with our User-Agent and ONE deadline that covers connect, headers and the whole body,
 * which is read with a byte cap. A slow-drip or endless body aborts at the deadline instead of
 * hanging the run.
 */
export async function timedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
  maxBytes = MAX_BODY_BYTES,
): Promise<SimpleResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Object.assign(new Error("timeout"), { name: "AbortError" })), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": userAgent(), Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5", ...(init.headers ?? {}) },
    });
    const body = await readCapped(res, maxBytes);
    return { status: res.status, ok: res.ok, url: res.url || url, contentType: res.headers.get("content-type") ?? "", ...body };
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error(`timeout after ${timeoutMs} ms: ${url}`), { name: "AbortError" });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** GET over node:https/http (follows up to 5 redirects). Used when fetch() fails to connect. */
async function nodeGet(url: string, timeoutMs: number, accept: string, redirects = 5, deadline = Date.now() + timeoutMs): Promise<SimpleResponse> {
  const { request } = url.startsWith("https:") ? await import("node:https") : await import("node:http");
  return new Promise<SimpleResponse>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(Object.assign(new Error(`timeout after ${timeoutMs} ms: ${url}`), { name: "AbortError" }));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(total);
      fn();
    };
    const req = request(url, { method: "GET", headers: { "User-Agent": userAgent(), Accept: accept }, timeout: remaining }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        finish(() => nodeGet(new URL(res.headers.location!, url).toString(), timeoutMs, accept, redirects - 1, deadline).then(resolve, reject));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      const done = () =>
        finish(() =>
          resolve({ status, ok: status >= 200 && status < 300, url, contentType: String(res.headers["content-type"] ?? ""), text: Buffer.concat(chunks).toString("utf8"), truncated }),
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
    });
    // Total deadline (the socket `timeout` option is only an idle timeout).
    const total = setTimeout(() => {
      const error = Object.assign(new Error(`timeout after ${timeoutMs} ms: ${url}`), { name: "AbortError" });
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
 * where undici's 10 s connect timeout trips). Throws on network failure of both. The deadline covers
 * the whole body; bodies are capped at MAX_BODY_BYTES.
 */
export async function getText(url: string, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5", timeoutMs = FETCH_TIMEOUT_MS): Promise<SimpleResponse> {
  try {
    return await timedFetch(url, { headers: { Accept: accept } }, timeoutMs);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return nodeGet(url, timeoutMs, accept);
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

/** Main text of an HTML page (Readability, then plain body text as fallback). */
export async function htmlToText(html: string, url: string): Promise<{ title: string | null; text: string }> {
  const [{ JSDOM }, { Readability }] = await Promise.all([import("jsdom"), import("@mozilla/readability")]);
  const dom = new JSDOM(html, { url });
  try {
    const doc = dom.window.document;
    const pageTitle = doc.title || null;
    const article = new Readability(doc.cloneNode(true) as Document).parse();
    const text = article?.textContent?.trim() ? article.textContent : (doc.body?.textContent ?? "");
    return { title: article?.title || pageTitle, text: cleanText(text) };
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
  | { ok: true; title: string | null; text: string }
  | { ok: false; reason: "robots" | "pdf" | "http" | "timeout" | "empty" | "error"; detail?: string };

/** Politely fetch a page and return its cleaned main text. Never throws. */
export async function fetchPageText(url: string): Promise<FetchOutcome> {
  if (/\.pdf(?:$|\?)/i.test(url)) return { ok: false, reason: "pdf", detail: "PDFs are skipped in the slice" };
  const host = hostOf(url);
  if (!host) return { ok: false, reason: "error", detail: "bad url" };
  try {
    if (!(await robotsAllowed(url))) return { ok: false, reason: "robots", detail: "disallowed by robots.txt" };
    await politeWait(host);
    const res = await getText(url);
    if (!res.ok) return { ok: false, reason: "http", detail: `HTTP ${res.status}` };
    const type = res.contentType;
    if (/pdf/i.test(type)) return { ok: false, reason: "pdf", detail: "PDFs are skipped in the slice" };
    if (type && !/html|xml|text/i.test(type)) return { ok: false, reason: "error", detail: `unsupported content-type ${type}` };
    const { title, text } = await htmlToText(res.text.slice(0, 2_000_000), res.url || url);
    if (text.length < 200) return { ok: false, reason: "empty", detail: "too little text" };
    return { ok: true, title, text: text.slice(0, MAX_TEXT_CHARS) };
  } catch (error) {
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
    "select id, status, text from source_documents where content_hash = $1 limit 1",
    [hash],
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
