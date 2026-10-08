import { acquire, paceLimitsFor, parseResetMs } from "./pacer";
import { LLMHttpError, type LLMRequest, type LLMResponse, type ProviderName } from "./types";

export const LLM_TIMEOUT_MS = 60_000;
/** Retries after a 429 (waiting for the reset the provider tells us). */
export const RATE_LIMIT_RETRIES = 2;
/** Longest wait for a rate-limit reset before giving up (daily limits reset much later). */
const MAX_RESET_WAIT_MS = 65_000;

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

/**
 * POST to an OpenAI-compatible `/chat/completions` endpoint (Groq, Cloudflare Workers AI).
 * Temperature defaults to 0; JSON mode via `response_format` when `json` is true; 60 s timeout.
 */
export async function chatCompletion(options: {
  provider: ProviderName;
  url: string;
  apiKey: string;
  model: string;
  request: LLMRequest;
  extraBody?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<LLMResponse> {
  const { provider, url, apiKey, model, request, extraBody, fetchImpl = fetch } = options;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    temperature: request.temperature ?? 0,
    ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    ...(request.json ? { response_format: { type: "json_object" } } : {}),
    ...extraBody,
  };

  const limits = paceLimitsFor(provider, model);
  const estimateIn = estimateTokens(request.system + request.user);
  const estimateOut = request.maxTokens ?? 1000;
  for (let attempt = 0; ; attempt++) {
    const settle = limits ? await acquire(`${provider}:${model}`, limits, estimateIn + estimateOut, estimateOut) : null;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
    if (!response.ok) {
      settle?.(estimateIn, 0);
      const detail = typeof payload.error === "string" ? payload.error : payload.error?.message;
      if (!request.singleAttempt && response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        const headers = response.headers;
        // Per-minute token resets are short; a long wait means a daily limit, so give up instead.
        const wait = parseResetMs(headers?.get?.("retry-after")) ?? parseResetMs(headers?.get?.("x-ratelimit-reset-tokens"));
        // Retry only when the provider says when the limit resets (Groq sends reset headers).
        if (wait !== null && wait <= MAX_RESET_WAIT_MS) {
          await new Promise((resolve) => setTimeout(resolve, Math.max(250, wait) + 250));
          continue;
        }
      }
      throw new LLMHttpError(provider, response.status, `${provider} ${response.status}: ${detail ?? response.statusText}`);
    }

    const text = payload.choices?.[0]?.message?.content ?? "";
    const tokensIn = payload.usage?.prompt_tokens ?? estimateIn;
    const tokensOut = payload.usage?.completion_tokens ?? estimateTokens(text);
    settle?.(tokensIn + tokensOut, tokensOut);
    return { text: stripThinking(text), tokensIn, tokensOut };
  }
}

/** Rough token estimate (≈4 chars per token) for providers that omit usage, and for the mock. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Remove `<think>…</think>` blocks some reasoning models emit even when asked not to. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
