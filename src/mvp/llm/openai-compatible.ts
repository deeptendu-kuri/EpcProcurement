import { LLMHttpError, type LLMRequest, type LLMResponse, type ProviderName } from "./types";

export const LLM_TIMEOUT_MS = 60_000;

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

  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
  if (!response.ok) {
    const detail = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new LLMHttpError(provider, response.status, `${provider} ${response.status}: ${detail ?? response.statusText}`);
  }

  const text = payload.choices?.[0]?.message?.content ?? "";
  return {
    text: stripThinking(text),
    tokensIn: payload.usage?.prompt_tokens ?? estimateTokens(request.system + request.user),
    tokensOut: payload.usage?.completion_tokens ?? estimateTokens(text),
  };
}

/** Rough token estimate (≈4 chars per token) for providers that omit usage, and for the mock. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Remove `<think>…</think>` blocks some reasoning models emit even when asked not to. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
