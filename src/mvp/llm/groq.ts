import { chatCompletion } from "./openai-compatible";
import type { LLMProvider, LLMRequest } from "./types";

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Groq (OpenAI-compatible). Models per 06 §2, e.g. "qwen3.8-27b", "openai/gpt-oss-20b". */
export function createGroqProvider(apiKey: string, model: string, fetchImpl?: typeof fetch): LLMProvider {
  return {
    name: "groq",
    model,
    complete: (request: LLMRequest) =>
      chatCompletion({
        provider: "groq",
        url: GROQ_URL,
        apiKey,
        model,
        request,
        fetchImpl,
        // Qwen: thinking off (06 §2). gpt-oss: keep reasoning short.
        extraBody: model.toLowerCase().includes("qwen")
          ? { reasoning_effort: "none" }
          : model.includes("gpt-oss")
            ? { reasoning_effort: "low" }
            : undefined,
      }),
  };
}
