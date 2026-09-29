// @vitest-environment node
/** Groq JSON-mode retry (docs/mvp/15 §F). */
import { describe, expect, it } from "vitest";
import { JSON_ONLY_INSTRUCTION, createGroqProvider, firstJsonObject } from "./groq";
import { LLMHttpError } from "./types";

const jsonFailed = () =>
  new Response(JSON.stringify({ error: { message: "Failed to generate JSON. Please adjust your prompt.", code: "json_validate_failed" } }), { status: 400 });
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }), { status: 200 });

function recorder(responses: (() => Response)[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return next();
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

describe("Groq JSON retry", () => {
  it("retries once with a stricter JSON-only instruction", async () => {
    const { bodies, fetchImpl } = recorder([jsonFailed, () => ok('{"companies":[]}')]);
    const groq = createGroqProvider("gsk_x", "openai/gpt-oss-20b", fetchImpl);
    const res = await groq.complete({ system: "Extract facts.", user: "text", json: true });
    expect(res.text).toBe('{"companies":[]}');
    expect(bodies).toHaveLength(2);
    const messages = (b: Record<string, unknown>) => b.messages as { role: string; content: string }[];
    expect(messages(bodies[0])[0].content).not.toContain(JSON_ONLY_INSTRUCTION);
    expect(messages(bodies[1])[0].content).toContain(JSON_ONLY_INSTRUCTION);
    expect(bodies[1].response_format).toEqual({ type: "json_object" });
  });

  it("then drops response_format and parses the first JSON object", async () => {
    const { bodies, fetchImpl } = recorder([jsonFailed, jsonFailed, () => ok('Here you go: {"a": {"b": "x}y"}} and {"c": 2} done')]);
    const groq = createGroqProvider("gsk_x", "openai/gpt-oss-20b", fetchImpl);
    const res = await groq.complete({ system: "Extract facts.", user: "text", json: true });
    expect(JSON.parse(res.text)).toEqual({ a: { b: "x}y" } });
    expect(bodies).toHaveLength(3);
    expect(bodies[2].response_format).toBeUndefined();
  });

  it("throws after the retries so the caller falls back to rules for that document only", async () => {
    const { fetchImpl } = recorder([jsonFailed, jsonFailed, () => ok("no json at all")]);
    const groq = createGroqProvider("gsk_x", "openai/gpt-oss-20b", fetchImpl);
    await expect(groq.complete({ system: "s", user: "u", json: true })).rejects.toBeInstanceOf(LLMHttpError);
    // The provider is not disabled: the next document gets a normal call.
    const next = recorder([() => ok('{"ok":true}')]);
    const again = createGroqProvider("gsk_x", "openai/gpt-oss-20b", next.fetchImpl);
    expect((await again.complete({ system: "s", user: "u", json: true })).text).toBe('{"ok":true}');
  });

  it("does not retry other errors or non-JSON requests", async () => {
    const other = recorder([() => new Response(JSON.stringify({ error: { message: "bad model" } }), { status: 400 })]);
    await expect(createGroqProvider("gsk_x", "m", other.fetchImpl).complete({ system: "s", user: "u", json: true })).rejects.toThrow(/bad model/);
    expect(other.bodies).toHaveLength(1);
    const plain = recorder([jsonFailed]);
    await expect(createGroqProvider("gsk_x", "m", plain.fetchImpl).complete({ system: "s", user: "u" })).rejects.toThrow();
    expect(plain.bodies).toHaveLength(1);
  });

  it("firstJsonObject skips invalid braces", () => {
    expect(firstJsonObject("{oops} {\"x\":1}")).toBe('{"x":1}');
    expect(firstJsonObject("nothing")).toBeNull();
  });
});
