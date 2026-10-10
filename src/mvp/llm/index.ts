/**
 * Provider layer (docs/mvp/06 §2, 12 §2). Pick a provider per role; every call is budget-checked and
 * recorded in llm_usage. With no keys everything is the deterministic mock ("demo mode").
 *
 * Role → provider (when keys exist):
 *   triage     Groq openai/gpt-oss-20b        → Cloudflare @cf/openai/gpt-oss-20b → mock
 *   extract_a  Groq, one model per pass (EXTRACT_PASS_MODELS) → mock
 *   extract_b  Cloudflare @cf/openai/gpt-oss-20b → mock  (never Groq: agreement needs a distinct provider)
 *   draft      Groq openai/gpt-oss-120b        → Cloudflare → mock
 *   judge      Cloudflare @cf/openai/gpt-oss-20b → Groq openai/gpt-oss-20b → mock
 * Models can be overridden with LLM_MODEL__<ROLE> (e.g. LLM_MODEL__EXTRACT_A=openai/gpt-oss-120b).
 */
import { isDemoMode, mvpEnv } from "@/mvp/config/env";
import type { Queryable } from "@/mvp/db";
import type { LLMRole } from "@/mvp/types";
import { createCloudflareProvider } from "./cloudflare";
import { DAILY_LIMIT, createGroqProvider } from "./groq";
import { createMockProvider } from "./mock";
import { withQuota } from "./quota";
import { LLMHttpError, QuotaExceededError, type LLMProvider, type ProviderName } from "./types";

export * from "./types";
export { isDemoMode };
export { setMockExtractor, setMockTextGenerator, MOCK_MODEL, type MockExtractor, type MockTextGenerator } from "./mock";
export { getUsageSummary, hasCapacity, usedToday, dailyBudget, recordUsage, type UsageSummary } from "./quota";

export const DEFAULT_MODELS: Record<LLMRole, { groq: string; cloudflare: string }> = {
  triage: { groq: "openai/gpt-oss-20b", cloudflare: "@cf/openai/gpt-oss-20b" },
  extract_a: { groq: "openai/gpt-oss-120b", cloudflare: "@cf/openai/gpt-oss-20b" },
  extract_b: { groq: "openai/gpt-oss-20b", cloudflare: "@cf/openai/gpt-oss-20b" },
  draft: { groq: "openai/gpt-oss-120b", cloudflare: "@cf/openai/gpt-oss-20b" },
  judge: { groq: "openai/gpt-oss-20b", cloudflare: "@cf/openai/gpt-oss-20b" },
};

/**
 * Model A per extraction pass on Groq. Groq's free tier limits tokens per minute per model
 * (~8k; qwen also ~1k output tokens/min), so the three passes of a document run in parallel on
 * three different models instead of queueing on one. LLM_MODEL__EXTRACT_A overrides all passes.
 */
export const EXTRACT_PASS_MODELS: Record<"P1" | "P2" | "P3", string> = {
  P1: "openai/gpt-oss-120b",
  P2: "openai/gpt-oss-20b",
  P3: "qwen/qwen3.8-27b",
};

const ORDER: Record<LLMRole, Exclude<ProviderName, "mock">[]> = {
  triage: ["groq", "cloudflare"],
  extract_a: ["groq"],
  extract_b: ["cloudflare"],
  draft: ["groq", "cloudflare"],
  judge: ["cloudflare", "groq"],
};

function hasCloudflare(): boolean {
  return Boolean(mvpEnv.cloudflareAccountId() && mvpEnv.cloudflareApiToken());
}

/** Which provider getLLM(role) will use right now (without creating it). */
export function providerFor(role: LLMRole): ProviderName {
  for (const name of ORDER[role]) {
    if (name === "groq" && mvpEnv.groqApiKey()) return "groq";
    if (name === "cloudflare" && hasCloudflare()) return "cloudflare";
  }
  return "mock";
}

function modelFor(role: LLMRole, provider: Exclude<ProviderName, "mock">, preferred?: string): string {
  const override = process.env[`LLM_MODEL__${role.toUpperCase()}`]?.trim();
  return override || (provider === "groq" && preferred) || DEFAULT_MODELS[role][provider];
}

/**
 * The provider for a role, wrapped with quota checks and usage recording.
 * Check `provider.name === "mock"` to know the answer is rules-based (label facts `rule`).
 * @param db optional database for usage rows (tests); defaults to getDb().
 * @param groqModel preferred Groq model for this call (e.g. a pass model); env overrides still win.
 */
export function getLLM(role: LLMRole, db?: Queryable, groqModel?: string): LLMProvider {
  const name = providerFor(role);
  let provider: LLMProvider;
  if (name === "groq") {
    const groq = withQuota(createGroqProvider(mvpEnv.groqApiKey()!, modelFor(role, "groq", groqModel)), role, db);
    if (!hasCloudflare()) return groq;
    // When every Groq model is out for the day, Cloudflare answers instead (recorded as Cloudflare usage).
    // Answers are quote-checked against the original text whichever provider wrote them.
    const cloudflare = withQuota(createCloudflareProvider(mvpEnv.cloudflareAccountId()!, mvpEnv.cloudflareApiToken()!, modelFor(role, "cloudflare")), role, db);
    return { name: "groq", model: groq.model, async complete(request) {
      try { return await groq.complete(request); }
      catch (error) {
        const dayOut = error instanceof QuotaExceededError || error instanceof LLMHttpError && error.status === 429 && DAILY_LIMIT.test(error.message);
        if (!dayOut) throw error;
        return cloudflare.complete(request);
      }
    } };
  } else if (name === "cloudflare") {
    provider = createCloudflareProvider(mvpEnv.cloudflareAccountId()!, mvpEnv.cloudflareApiToken()!, modelFor(role, "cloudflare"));
  } else {
    provider = createMockProvider();
  }
  return withQuota(provider, role, db);
}
