import { estimateTokens } from "./openai-compatible";
import type { LLMProvider, LLMRequest, LLMResponse } from "./types";

/**
 * Deterministic stand-in used in demo mode (no keys).
 *
 * - JSON requests: the mock never invents facts. It returns whatever the registered rules-based
 *   extractor returns for the request (see `setMockExtractor`), or `{}` when none is registered or
 *   the extractor returns null. Facts from it are labelled `rule` by the pipeline (12 §3).
 * - Text requests: a deterministic templated string, or the output of `setMockTextGenerator`.
 */

/** Returns a JSON-serialisable object (or a JSON string), or null for "nothing found". */
export type MockExtractor = (request: LLMRequest) => unknown;
export type MockTextGenerator = (request: LLMRequest) => string | null;

const hooks = globalThis as unknown as {
  __mvpMockExtractor?: MockExtractor;
  __mvpMockTextGenerator?: MockTextGenerator;
};

/** Register (or clear with null) the rules-based extractor that answers JSON requests in demo mode. */
export function setMockExtractor(extractor: MockExtractor | null): void {
  hooks.__mvpMockExtractor = extractor ?? undefined;
}

/** Register (or clear with null) a generator for text requests (e.g. template-based email drafts). */
export function setMockTextGenerator(generator: MockTextGenerator | null): void {
  hooks.__mvpMockTextGenerator = generator ?? undefined;
}

export const MOCK_MODEL = "rules-v1";

function answer(request: LLMRequest): string {
  if (request.json) {
    const result = hooks.__mvpMockExtractor?.(request);
    if (result === null || result === undefined) return "{}";
    return typeof result === "string" ? result : JSON.stringify(result);
  }
  const generated = hooks.__mvpMockTextGenerator?.(request);
  if (generated !== null && generated !== undefined) return generated;
  const firstLine = request.user.split("\n").find((line) => line.trim())?.trim() ?? "";
  const topic = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  return `[Demo mode: AI simulated] Response to: ${topic}`;
}

export function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    model: MOCK_MODEL,
    async complete(request: LLMRequest): Promise<LLMResponse> {
      const text = answer(request);
      return { text, tokensIn: estimateTokens(request.system + request.user), tokensOut: estimateTokens(text) };
    },
  };
}
