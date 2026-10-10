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
export const DAILY_LIMIT = /\bper day\b|\b(?:TPD|RPD)\b/i;
/**
 * Models tried in turn when a model's own daily allowance is used up (Groq limits each model separately,
 * over the last 24 hours). LLM_GROQ_DAILY_FALLBACK_MODEL takes a comma-separated list, or "off".
 */
export function dailyFallbackModels(): string[] {
  const value = process.env.LLM_GROQ_DAILY_FALLBACK_MODEL?.trim();
  if (value === "off") return [];
  return (value || "openai/gpt-oss-20b,qwen/qwen3.8-27b").split(",").map((m) => m.trim()).filter(Boolean);
}
/** The first fallback model (kept for callers that need one). */
export function dailyFallbackModel(): string | null {
  return dailyFallbackModels()[0] ?? null;
}

/** "Please try again in 20m58.848s" → milliseconds; null when Groq gave no time. */
export function retryAfterMs(message: string): number | null {
  const m = message.match(/try again in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return Math.ceil(((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000);
}

/**
 * Models Groq has refused for the day, and until when (shared by every provider in this process), so a
 * refused model is not asked again on every step. A refused request is not billed.
 */
const blocks = ((globalThis as typeof globalThis & { groqDailyBlocks?: Map<string, number> }).groqDailyBlocks ??= new Map<string, number>());
export function groqBlockedModels(now = Date.now()): { model: string; until: string }[] {
  return [...blocks.entries()].filter(([, until]) => until > now).map(([model, until]) => ({ model, until: new Date(until).toISOString() }));
}
export function resetGroqBlocks(): void { blocks.clear(); }
const blocked = (model: string) => (blocks.get(model) ?? 0) > Date.now();

export function createGroqProvider(apiKey: string, model: string, fetchImpl?: typeof fetch): LLMProvider {
  // Qwen: thinking off (06 §2). gpt-oss: keep reasoning short.
  const extraBody = (m: string) => m.toLowerCase().includes("qwen") ? { reasoning_effort: "none" } : m.includes("gpt-oss") ? { reasoning_effort: "low" } : undefined;
  const call = (m: string, request: LLMRequest) =>
    completeWithJsonRetry((req) => chatCompletion({ provider: "groq", url: GROQ_URL, apiKey, model: m, request: req, fetchImpl, extraBody: extraBody(m) }), request);
  return {
    name: "groq",
    model,
    complete: async (request: LLMRequest) => {
      // The requested model first, then the fallbacks, skipping models Groq already refused for the day.
      // Answers are still quote-checked against the original text, whichever model wrote them.
      const models = [model, ...dailyFallbackModels().filter((m) => m !== model)];
      for (const m of models) {
        if (blocked(m)) continue;
        try {
          const response = await call(m, request);
          return m === model ? response : { ...response, model: m };
        } catch (error) {
          if (!(error instanceof LLMHttpError && error.status === 429 && DAILY_LIMIT.test(error.message))) throw error;
          blocks.set(m, Date.now() + (retryAfterMs(error.message) ?? 10 * 60_000));
          if (!dailyFallbackModels().length) throw error;
        }
      }
      // Every model is out for now: say which, and when the first one frees up (the engine waits that long).
      const next = Math.min(...models.map((m) => blocks.get(m) ?? Date.now()));
      const wait = Math.max(1, Math.ceil((next - Date.now()) / 1000));
      throw new LLMHttpError("groq", 429, `groq 429: Groq's free daily AI limit (tokens per day) is used up for ${models.join(", ")}. Please try again in ${Math.floor(wait / 60)}m${wait % 60}s.`);
    },
  };
}
