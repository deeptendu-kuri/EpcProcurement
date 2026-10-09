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
  it("never hides extra billable repair or rate-limit retries inside durable single-attempt calls",async()=>{
    for(const response of [jsonFailed,()=>new Response(JSON.stringify({error:{message:"rate limit"}}),{status:429,headers:{"retry-after":"0.01"}})]){
      const {bodies,fetchImpl}=recorder([response]);
      await expect(createGroqProvider("gsk_x","m",fetchImpl).complete({system:"s",user:"u",json:true,singleAttempt:true})).rejects.toBeInstanceOf(LLMHttpError);
      expect(bodies).toHaveLength(1);
    }
  });
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

describe("Groq daily allowance fallback", () => {
  const perDay = () => new Response(JSON.stringify({ error: { message: "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_example` on tokens per day (TPD): Limit 200000, Used 199000, Requested 3770." } }), { status: 429 });
  it("answers with the fallback model when the requested model's daily allowance is used up", async () => {
    const { bodies, fetchImpl } = recorder([perDay, () => ok('{"companies":[]}')]);
    const res = await createGroqProvider("gsk_x", "openai/gpt-oss-120b", fetchImpl).complete({ system: "s", user: "u", json: true, singleAttempt: true });
    expect(res.text).toBe('{"companies":[]}');
    expect(bodies.map((b) => b.model)).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  });
  it("does not fall back for a per-minute limit or when switched off", async () => {
    const perMinute = () => new Response(JSON.stringify({ error: { message: "Rate limit reached on tokens per minute (TPM)" } }), { status: 429 });
    const a = recorder([perMinute]);
    await expect(createGroqProvider("gsk_x", "openai/gpt-oss-120b", a.fetchImpl).complete({ system: "s", user: "u", singleAttempt: true })).rejects.toBeInstanceOf(LLMHttpError);
    expect(a.bodies).toHaveLength(1);
    process.env.LLM_GROQ_DAILY_FALLBACK_MODEL = "off";
    try {
      const b = recorder([perDay]);
      await expect(createGroqProvider("gsk_x", "openai/gpt-oss-120b", b.fetchImpl).complete({ system: "s", user: "u", singleAttempt: true })).rejects.toBeInstanceOf(LLMHttpError);
      expect(b.bodies).toHaveLength(1);
    } finally { delete process.env.LLM_GROQ_DAILY_FALLBACK_MODEL; }
  });
});
