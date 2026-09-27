import { mvpEnv } from "@/mvp/config/env";
import { getDb, type Queryable } from "@/mvp/db";
import { QuotaExceededError, type LLMProvider, type LLMRequest, type ProviderName } from "./types";

/** Share of the daily budget kept free (06 §7: 10% headroom). */
export const QUOTA_HEADROOM = 0.1;

/**
 * Daily token budget per provider (UTC day).
 * Groq: LLM_DAILY_TOKEN_BUDGET__GROQ (default 180 000).
 * Cloudflare: LLM_DAILY_TOKEN_BUDGET__CLOUDFLARE (default 300 000; the free tier is 10k neurons/day,
 * treated here as a token budget). Mock: unlimited.
 */
export function dailyBudget(provider: ProviderName): number {
  if (provider === "groq") return mvpEnv.groqDailyTokenBudget();
  if (provider === "cloudflare") return mvpEnv.cloudflareDailyTokenBudget();
  return Number.POSITIVE_INFINITY;
}

/** Tokens (in + out) recorded for `provider` since 00:00 UTC today. */
export async function usedToday(provider: ProviderName, db: Queryable = getDb()): Promise<number> {
  const { rows } = await db.query<{ used: number | null }>(
    `select coalesce(sum(tokens_in + tokens_out), 0)::int as used
       from llm_usage
      where provider = $1
        and ts >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`,
    [provider],
  );
  return Number(rows[0]?.used ?? 0);
}

export interface UsageRecord {
  provider: ProviderName;
  model: string;
  purpose?: string;
  tokensIn: number;
  tokensOut: number;
  runId?: string;
  ok: boolean;
  error?: string;
}

/** Insert one row into llm_usage. */
export async function recordUsage(record: UsageRecord, db: Queryable = getDb()): Promise<void> {
  await db.query(
    `insert into llm_usage (provider, model, purpose, tokens_in, tokens_out, run_id, ok, error)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      record.provider,
      record.model,
      record.purpose ?? null,
      record.tokensIn,
      record.tokensOut,
      record.runId ?? null,
      record.ok,
      record.error?.slice(0, 500) ?? null,
    ],
  );
}

/** True when `provider` can still spend tokens today (budget minus headroom). */
export async function hasCapacity(provider: ProviderName, db: Queryable = getDb()): Promise<boolean> {
  const budget = dailyBudget(provider);
  if (!Number.isFinite(budget)) return true;
  return (await usedToday(provider, db)) < budget * (1 - QUOTA_HEADROOM);
}

export interface UsageSummary {
  provider: ProviderName;
  usedToday: number;
  budget: number | null;
  calls: number;
  failures: number;
}

/** Today's usage per provider, for Settings / Health. */
export async function getUsageSummary(db: Queryable = getDb()): Promise<UsageSummary[]> {
  const { rows } = await db.query<{ provider: ProviderName; used: number; calls: number; failures: number }>(
    `select provider,
            coalesce(sum(tokens_in + tokens_out), 0)::int as used,
            count(*)::int as calls,
            count(*) filter (where not ok)::int as failures
       from llm_usage
      where ts >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
      group by provider`,
  );
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return (["groq", "cloudflare", "mock"] as const).map((provider) => {
    const row = byProvider.get(provider);
    const budget = dailyBudget(provider);
    return {
      provider,
      usedToday: Number(row?.used ?? 0),
      budget: Number.isFinite(budget) ? budget : null,
      calls: Number(row?.calls ?? 0),
      failures: Number(row?.failures ?? 0),
    };
  });
}

/**
 * Wrap a provider so every call is budget-checked and recorded in llm_usage.
 * Throws QuotaExceededError (without calling the provider) once the budget minus headroom is used.
 * A failure to write the usage row never fails the call.
 */
export function withQuota(provider: LLMProvider, defaultPurpose: string, db?: Queryable): LLMProvider {
  const database = () => db ?? getDb();
  return {
    name: provider.name,
    model: provider.model,
    async complete(request: LLMRequest) {
      const budget = dailyBudget(provider.name);
      if (Number.isFinite(budget)) {
        const used = await usedToday(provider.name, database());
        if (used >= budget * (1 - QUOTA_HEADROOM)) throw new QuotaExceededError(provider.name, used, budget);
      }
      const base = { provider: provider.name, model: provider.model, purpose: request.purpose ?? defaultPurpose, runId: request.runId };
      try {
        const response = await provider.complete(request);
        await recordUsage({ ...base, tokensIn: response.tokensIn, tokensOut: response.tokensOut, ok: true }, database()).catch(
          (error) => console.warn("[llm] failed to record usage", error),
        );
        return response;
      } catch (error) {
        await recordUsage(
          { ...base, tokensIn: 0, tokensOut: 0, ok: false, error: error instanceof Error ? error.message : String(error) },
          database(),
        ).catch(() => undefined);
        throw error;
      }
    },
  };
}
