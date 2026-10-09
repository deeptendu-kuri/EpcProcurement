import { chatCompletion } from "./openai-compatible";
import { LLMHttpError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types";

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Stricter instruction added when Groq's JSON mode failed (docs/mvp/15 §F). */
export const JSON_ONLY_INSTRUCTION =
  "IMPORTANT: Reply with ONE valid JSON object only. No prose, no markdown, no code fences, no comments. Use null for unknown values.";

/** Groq's "failed to generate JSON" error (HTTP 400, code json_validate_failed). */
export function isJsonGenerationError(error: unknown): boolean {
  return error instanceof LLMHttpError && error.status === 400 && /json/i.test(error.message);
}

/**
 * The first balanced JSON object in a text (strings and escapes respected), or null. Used when the
 * model answered without JSON mode and added words around the object.
 */
export function firstJsonObject(text: string): string | null {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

/**
 * JSON-mode retry (15 §F): on HTTP 400 "failed to generate JSON", retry the same request once with a
 * stricter "JSON only" instruction; if that fails the same way, retry without response_format and keep
 * the first JSON object of the answer. Any other error (or a third failure) is thrown to the caller,
 * which falls back to rules for that document only.
 */
export async function completeWithJsonRetry(call: (request: LLMRequest, extraBody?: Record<string, unknown>) => Promise<LLMResponse>, request: LLMRequest): Promise<LLMResponse> {
  try {
    return await call(request);
  } catch (error) {
    if (request.singleAttempt || !request.json || !isJsonGenerationError(error)) throw error;
  }
  const strict: LLMRequest = { ...request, system: `${request.system}\n\n${JSON_ONLY_INSTRUCTION}` };
  try {
    return await call(strict);
  } catch (error) {
    if (!isJsonGenerationError(error)) throw error;
  }
  const plain = await call({ ...strict, json: false });
  const object = firstJsonObject(plain.text);
  if (object === null) throw new LLMHttpError("groq", 400, "groq 400: no JSON object in the answer after retries");
  return { ...plain, text: object };
}

/** Groq (OpenAI-compatible). Models per 06 §2, e.g. "qwen3.8-27b", "openai/gpt-oss-20b". */
// Groq answers 429 for a model's daily allowance with "tokens per day (TPD)" / "requests per day (RPD)".
const DAILY_LIMIT = /\bper day\b|\b(?:TPD|RPD)\b/i;
/** Model used when the requested model's own daily allowance is used up (Groq limits each model separately). */
export function dailyFallbackModel(): string | null {
  const value = process.env.LLM_GROQ_DAILY_FALLBACK_MODEL?.trim();
  return value === "off" ? null : value || "openai/gpt-oss-20b";
}
export function createGroqProvider(apiKey: string, model: string, fetchImpl?: typeof fetch): LLMProvider {
  // Qwen: thinking off (06 §2). gpt-oss: keep reasoning short.
  const extraBody = (m: string) => m.toLowerCase().includes("qwen") ? { reasoning_effort: "none" } : m.includes("gpt-oss") ? { reasoning_effort: "low" } : undefined;
  const call = (m: string, request: LLMRequest) =>
    completeWithJsonRetry((req) => chatCompletion({ provider: "groq", url: GROQ_URL, apiKey, model: m, request: req, fetchImpl, extraBody: extraBody(m) }), request);
  return {
    name: "groq",
    model,
    complete: async (request: LLMRequest) => {
      try {
        return await call(model, request);
      } catch (error) {
        // A refused request (429) is not billed, so asking the fallback model is not a repeated paid call.
        // Answers are still quote-checked against the original text, whichever model wrote them.
        const fallback = dailyFallbackModel();
        if (fallback && fallback !== model && error instanceof LLMHttpError && error.status === 429 && DAILY_LIMIT.test(error.message)) return call(fallback, request);
        throw error;
      }
    },
  };
}
