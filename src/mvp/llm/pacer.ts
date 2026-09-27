/**
 * Free-tier pacing (06 §7). Groq's free tier allows ~8 000 tokens per minute per model (and qwen
 * only ~1 000 output tokens per minute), so calls are spaced out per provider+model instead of
 * failing with 429. A sliding 60 s window of estimated tokens is kept in memory per model.
 */

const WINDOW_MS = 60_000;

export interface PaceLimits {
  /** Tokens (in + out) per minute. */
  tpm: number;
  /** Output tokens per minute, when the provider limits it separately. */
  otpm?: number;
}

/** Per-model limits (kept ~10% under Groq's published free-tier limits). */
export function paceLimitsFor(provider: string, model: string): PaceLimits | null {
  if (process.env.VITEST) return null; // unit tests use fake fetches
  if (provider === "groq") {
    const tpm = Number(process.env.LLM_GROQ_TPM ?? 7000) || 7000;
    return /qwen/i.test(model) ? { tpm, otpm: 900 } : { tpm };
  }
  if (provider === "cloudflare") return { tpm: 60_000 };
  return null;
}

interface Entry {
  at: number;
  tokens: number;
  out: number;
}

const windows = new Map<string, Entry[]>();
const queues = new Map<string, Promise<unknown>>();

function prune(entries: Entry[], now: number): Entry[] {
  return entries.filter((e) => now - e.at < WINDOW_MS);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until `tokens` (and `out` output tokens) fit in the model's minute window, then reserve them.
 * Calls for the same model are serialised so they reserve in order. Returns a function that
 * corrects the reservation with the real usage.
 */
export async function acquire(key: string, limits: PaceLimits, tokens: number, out: number): Promise<(actualTokens: number, actualOut: number) => void> {
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  queues.set(key, previous.then(() => mine));
  await previous;
  try {
    const need = Math.min(tokens, limits.tpm);
    const needOut = limits.otpm ? Math.min(out, limits.otpm) : 0;
    for (;;) {
      const now = Date.now();
      const entries = prune(windows.get(key) ?? [], now);
      windows.set(key, entries);
      const used = entries.reduce((s, e) => s + e.tokens, 0);
      const usedOut = entries.reduce((s, e) => s + e.out, 0);
      const fits = used + need <= limits.tpm && (!limits.otpm || usedOut + needOut <= limits.otpm);
      if (fits || !entries.length) {
        const entry: Entry = { at: now, tokens: need, out: needOut };
        entries.push(entry);
        return (actualTokens, actualOut) => {
          entry.tokens = Math.max(0, actualTokens);
          entry.out = limits.otpm ? Math.max(0, actualOut) : 0;
        };
      }
      await sleep(Math.max(250, WINDOW_MS - (now - entries[0].at) + 50));
    }
  } finally {
    release();
  }
}

/** Parse Groq/OpenAI reset headers: "4.755s", "1m26.4s", "600ms", or retry-after seconds. */
export function parseResetMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  let ms = 0;
  let matched = false;
  for (const m of v.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = Number(m[1]);
    ms += m[2] === "ms" ? n : m[2] === "s" ? n * 1000 : m[2] === "m" ? n * 60_000 : n * 3_600_000;
  }
  return matched ? Math.round(ms) : null;
}

/** For tests. */
export function resetPacer(): void {
  windows.clear();
  queues.clear();
}
