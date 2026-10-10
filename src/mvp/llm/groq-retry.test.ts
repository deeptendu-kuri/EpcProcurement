// @vitest-environment node
/** Groq JSON-mode retry (docs/mvp/15 §F). */
import { beforeEach, describe, expect, it } from "vitest";
import { JSON_ONLY_INSTRUCTION, createGroqProvider, firstJsonObject, groqBlockedModels, resetGroqBlocks, retryAfterMs } from "./groq";
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
  beforeEach(() => resetGroqBlocks());
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
  it("remembers a model Groq refused for the day, tries the next ones, then says when to retry", async () => {
    const a = recorder([perDay, () => ok('{"a":1}')]);
    await createGroqProvider("gsk_x", "openai/gpt-oss-120b", a.fetchImpl).complete({ system: "s", user: "u", json: true, singleAttempt: true });
    expect(groqBlockedModels().map((b) => b.model)).toEqual(["openai/gpt-oss-120b"]);
    // The refused model is skipped on the next call: no wasted request.
    const b = recorder([() => ok('{"b":2}')]);
    await createGroqProvider("gsk_x", "openai/gpt-oss-120b", b.fetchImpl).complete({ system: "s", user: "u", json: true, singleAttempt: true });
    expect(b.bodies.map((x) => x.model)).toEqual(["openai/gpt-oss-20b"]);
    const tpd = (m: string, t: string) => () => new Response(JSON.stringify({ error: { message: `Rate limit reached for model \`${m}\` on tokens per day (TPD). Please try again in ${t}.` } }), { status: 429 });
    const c = recorder([tpd("openai/gpt-oss-20b", "20m58.8s"), tpd("qwen/qwen3.8-27b", "4m10s")]);
    const error = await createGroqProvider("gsk_x", "openai/gpt-oss-120b", c.fetchImpl).complete({ system: "s", user: "u", singleAttempt: true }).catch((e) => e);
    expect(error).toBeInstanceOf(LLMHttpError);
    expect(error.message).toMatch(/daily AI limit .* used up .*try again in 4m1\ds/);
  });
  it("skips a fallback model too small for the request and reports Groq out for the day (10 Oct live audit)", async () => {
    const tooLarge = () => new Response(JSON.stringify({ error: { message: "Request too large for model `qwen/qwen3.8-27b` in organization `org_example` service tier `on_demand` on tokens per minute (TPM): Limit 6000, Requested 6900." } }), { status: 429 });
    const tpd = () => new Response(JSON.stringify({ error: { message: "Rate limit reached for model `openai/gpt-oss-20b` on tokens per day (TPD). Please try again in 7m30s." } }), { status: 429 });
    const a = recorder([tpd, tooLarge]);
    const error = await createGroqProvider("gsk_x", "openai/gpt-oss-20b", a.fetchImpl).complete({ system: "s", user: "u", singleAttempt: true }).catch((e) => e);
    expect(a.bodies.map((b) => b.model)).toEqual(["openai/gpt-oss-20b", "qwen/qwen3.8-27b"]);
    // A daily-limit error, so the Cloudflare backup answers; the retry time comes from the refused model.
    expect(error.message).toMatch(/daily AI limit .* used up .*try again in 7m(29|30)s/);
    expect(groqBlockedModels().map((b) => b.model)).toEqual(["openai/gpt-oss-20b"]);
    // The requested model's own "too large" still reaches the caller, which splits the batch.
    const b = recorder([tooLarge]);
    await expect(createGroqProvider("gsk_x", "qwen/qwen3.8-27b", b.fetchImpl).complete({ system: "s", user: "u", singleAttempt: true })).rejects.toThrow(/Request too large/);
    expect(b.bodies).toHaveLength(1);
  });
  it("reads Groq's retry time", () => {
    expect(retryAfterMs("Please try again in 20m58.848s.")).toBe(1_258_848);
    expect(retryAfterMs("Please try again in 1h2m3s")).toBe(3_723_000);
    expect(retryAfterMs("no time given")).toBeNull();
  });
});
