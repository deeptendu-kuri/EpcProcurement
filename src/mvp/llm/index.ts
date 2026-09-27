/**
 * Provider layer (docs/mvp/06 §2, 12 §2). Pick a provider per role; every call is budget-checked and
 * recorded in llm_usage. With no keys everything is the deterministic mock ("demo mode").
 *
 * Role → provider (when keys exist):
 *   triage     Groq openai/gpt-oss-20b        → Cloudflare @cf/openai/gpt-oss-20b → mock
 *   extract_a  Groq qwen3.8-27b               → mock
 *   extract_b  Cloudflare @cf/openai/gpt-oss-20b → mock  (never Groq: agreement needs a distinct provider)
 *   draft      Groq qwen3.8-27b               → Cloudflare → mock
 *   judge      Cloudflare @cf/openai/gpt-oss-20b → Groq openai/gpt-oss-20b → mock
 * Models can be overridden with LLM_MODEL__<ROLE> (e.g. LLM_MODEL__EXTRACT_A=openai/gpt-oss-120b).
 */
import { isDemoMode, mvpEnv } from "@/mvp/config/env";
import type { Queryable } from "@/mvp/db";
import type { LLMRole } from "@/mvp/types";
import { createCloudflareProvider } from "./cloudflare";
import { createGroqProvider } from "./groq";
import { createMockProvider } from "./mock";
import { withQuota } from "./quota";
import type { LLMProvider, ProviderName } from "./types";

export * from "./types";
export { isDemoMode };
export { setMockExtractor, setMockTextGenerator, MOCK_MODEL, type MockExtractor, type MockTextGenerator } from "./mock";
export { getUsageSummary, hasCapacity, usedToday, dailyBudget, recordUsage, type UsageSummary } from "./quota";

export const DEFAULT_MODELS: Record<LLMRole, { groq: string; cloudflare: string }> = {
  triage: { groq: "openai/gpt-oss-20b", cloudflare: "@cf/openai/gpt-oss-20b" },
  extract_a: { groq: "qwen/qwen3.8-27b", cloudflare: "@cf/openai/gpt-oss-20b" },
  extract_b: { groq: "openai/gpt-oss-20b", cloudflare: "@cf/openai/gpt-oss-20b" },
  draft: { groq: "qwen/qwen3.8-27b", cloudflare: "@cf/openai/gpt-oss-20b" },
  judge: { groq: "openai/gpt-oss-20b", cloudflare: "@cf/openai/gpt-oss-20b" },
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

function modelFor(role: LLMRole, provider: Exclude<ProviderName, "mock">): string {
  const override = process.env[`LLM_MODEL__${role.toUpperCase()}`]?.trim();
  return override || DEFAULT_MODELS[role][provider];
}

/**
 * The provider for a role, wrapped with quota checks and usage recording.
 * Check `provider.name === "mock"` to know the answer is rules-based (label facts `rule`).
 * @param db optional database for usage rows (tests); defaults to getDb().
 */
export function getLLM(role: LLMRole, db?: Queryable): LLMProvider {
  const name = providerFor(role);
  let provider: LLMProvider;
  if (name === "groq") {
    provider = createGroqProvider(mvpEnv.groqApiKey()!, modelFor(role, "groq"));
  } else if (name === "cloudflare") {
    provider = createCloudflareProvider(mvpEnv.cloudflareAccountId()!, mvpEnv.cloudflareApiToken()!, modelFor(role, "cloudflare"));
  } else {
    provider = createMockProvider();
  }
  return withQuota(provider, role, db);
}
