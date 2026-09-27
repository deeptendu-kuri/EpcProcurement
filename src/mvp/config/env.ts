/**
 * Typed access to the slice's environment variables (docs/mvp/12 §7). Read at call time, never cached,
 * so tests can change process.env. Server-only: none of these may reach the browser.
 */

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readInt(name: string, fallback: number): number {
  const value = Number(read(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const mvpEnv = {
  demoPassword: () => read("DEMO_PASSWORD"),
  sessionSecret: () => read("SESSION_SECRET"),
  databaseUrl: () => read("DATABASE_URL"),
  /** MVP_OFFLINE=1 → use fixtures only (no network). */
  offline: () => read("MVP_OFFLINE") === "1" || read("MVP_OFFLINE")?.toLowerCase() === "true",
  groqApiKey: () => read("GROQ_API_KEY"),
  cloudflareAccountId: () => read("CLOUDFLARE_ACCOUNT_ID"),
  cloudflareApiToken: () => read("CLOUDFLARE_API_TOKEN"),
  groqDailyTokenBudget: () => readInt("LLM_DAILY_TOKEN_BUDGET__GROQ", 180_000),
  cloudflareDailyTokenBudget: () => readInt("LLM_DAILY_TOKEN_BUDGET__CLOUDFLARE", 300_000),
  /** Comma-separated RSS feed URLs; empty → defaults in the RSS source. */
  rssFeeds: () =>
    (read("RSS_FEEDS") ?? "")
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean),
};

/** Minimum length for SESSION_SECRET (12 §7: 32+ random chars). */
export const MIN_SESSION_SECRET_LENGTH = 32;

/** Demo mode = no GROQ_API_KEY: AI calls go to the deterministic mock and the UI shows a badge. */
export function isDemoMode(): boolean {
  return !mvpEnv.groqApiKey();
}
