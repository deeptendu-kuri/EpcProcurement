import type { LLMRole } from "@/mvp/types";

export type { LLMRole };

export interface LLMRequest {
  system: string;
  user: string;
  /** Ask for a JSON object (provider JSON mode). The mock only answers via a registered extractor. */
  json?: boolean;
  maxTokens?: number;
  /** Defaults to 0. */
  temperature?: number;
  /** Recorded in llm_usage.purpose (defaults to the role the provider was obtained for). */
  purpose?: string;
  /** Recorded in llm_usage.run_id. */
  runId?: string;
  /** Durable jobs own retries/budgets; forbid hidden provider retry/repair calls. */
  singleAttempt?: boolean;
}

export interface LLMResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** The model that answered, when it differs from the one asked for (a daily-limit fallback). */
  model?: string;
}

export type ProviderName = "groq" | "cloudflare" | "mock";

export interface LLMProvider {
  name: ProviderName;
  model: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}

/** HTTP error from a provider; `status === 429` means rate-limited. */
export class LLMHttpError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LLMHttpError";
  }
}

/** Thrown before a call when the provider's daily budget (minus 10% headroom) is used up. */
export class QuotaExceededError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly used: number,
    readonly budget: number,
  ) {
    super(`Daily AI budget for ${provider} used up (${used}/${budget} tokens). Resets 00:00 UTC.`);
    this.name = "QuotaExceededError";
  }
}
