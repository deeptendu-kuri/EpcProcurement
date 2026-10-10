import { chatCompletion } from "./openai-compatible";
import type { LLMProvider, LLMRequest } from "./types";

export function cloudflareUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`;
}

/** Cloudflare Workers AI (OpenAI-compatible endpoint). Default model "@cf/openai/gpt-oss-20b" (06 §2). */
export function createCloudflareProvider(
  accountId: string,
  apiToken: string,
  model: string,
  fetchImpl?: typeof fetch,
): LLMProvider {
  // gpt-oss: keep reasoning short, as on Groq. At the default effort a 20-company rating used ~2.9k of its
  // 3.9k answer tokens on reasoning, and a longer one ran out before the JSON (10 Oct live audit).
  const extraBody = model.includes("gpt-oss") ? { reasoning_effort: "low" } : undefined;
  return {
    name: "cloudflare",
    model,
    complete: (request: LLMRequest) =>
      chatCompletion({ provider: "cloudflare", url: cloudflareUrl(accountId), apiKey: apiToken, model, request, fetchImpl, extraBody }),
  };
}
