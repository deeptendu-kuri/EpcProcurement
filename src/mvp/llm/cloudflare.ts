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
  return {
    name: "cloudflare",
    model,
    complete: (request: LLMRequest) =>
      chatCompletion({ provider: "cloudflare", url: cloudflareUrl(accountId), apiKey: apiToken, model, request, fetchImpl }),
  };
}
