// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import { createGroqProvider } from "./groq";
import { cloudflareUrl, createCloudflareProvider } from "./cloudflare";
import { createMockProvider, setMockExtractor, setMockTextGenerator } from "./mock";
import { getUsageSummary, usedToday, withQuota } from "./quota";
import { getLLM, isDemoMode, providerFor } from "./index";
import { LLMHttpError, QuotaExceededError, type LLMProvider } from "./types";

const KEYS = ["GROQ_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "LLM_DAILY_TOKEN_BUDGET__GROQ"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  for (const key of KEYS) delete process.env[key];
  await db.query("delete from llm_usage");
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  setMockExtractor(null);
  setMockTextGenerator(null);
});

describe("mock provider", () => {
  it("returns {} for JSON requests when no extractor is registered", async () => {
    const response = await createMockProvider().complete({ system: "s", user: "doc text", json: true });
    expect(response.text).toBe("{}");
  });

  it("returns only what the registered rules extractor finds", async () => {
    setMockExtractor((request) => (request.user.includes("X65") ? { grade: { value: "X65", quote: "X65 line pipe" } } : null));
    const mock = createMockProvider();
    expect(JSON.parse((await mock.complete({ system: "s", user: "needs X65 line pipe", json: true })).text)).toEqual({
      grade: { value: "X65", quote: "X65 line pipe" },
    });
    expect((await mock.complete({ system: "s", user: "nothing here", json: true })).text).toBe("{}");
  });

  it("is deterministic for text requests and accepts a text generator", async () => {
    const mock = createMockProvider();
    const a = await mock.complete({ system: "s", user: "Write an email to R. Sharma" });
    const b = await mock.complete({ system: "s", user: "Write an email to R. Sharma" });
    expect(a).toEqual(b);
    expect(a.text).toContain("Demo mode");
    setMockTextGenerator(() => "Subject: Hello");
    expect((await mock.complete({ system: "s", user: "x" })).text).toBe("Subject: Hello");
  });
});

describe("provider selection", () => {
  it("uses the mock for every role in demo mode", () => {
    expect(isDemoMode()).toBe(true);
    for (const role of ["triage", "extract_a", "extract_b", "draft", "judge"] as const) {
      expect(providerFor(role)).toBe("mock");
      expect(getLLM(role, db).name).toBe("mock");
    }
  });

  it("uses Groq for model A and Cloudflare for model B when keys exist", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    expect(isDemoMode()).toBe(false);
    expect(providerFor("extract_a")).toBe("groq");
    expect(providerFor("extract_b")).toBe("mock"); // no second provider → no agreement partner
    expect(providerFor("judge")).toBe("groq");
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_API_TOKEN = "tok";
    expect(providerFor("extract_b")).toBe("cloudflare");
    expect(providerFor("judge")).toBe("cloudflare");
    expect(providerFor("draft")).toBe("groq");
    expect(getLLM("extract_a", db).model).toBe("openai/gpt-oss-120b");
    expect(getLLM("extract_a", db, "qwen/qwen3.8-27b").model).toBe("qwen/qwen3.8-27b");
    expect(getLLM("draft", db).model).toBe("openai/gpt-oss-120b");
  });
});

describe("OpenAI-compatible providers", () => {
  it("sends temperature 0 and JSON mode to Groq and reads usage", async () => {
    let captured: { url: string; body: Record<string, unknown>; auth: string | null } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const groq = createGroqProvider("gsk_x", "qwen3.8-27b", fakeFetch);
    const response = await groq.complete({ system: "sys", user: "doc", json: true, maxTokens: 200 });
    expect(response).toEqual({ text: '{"ok":true}', tokensIn: 12, tokensOut: 3 });
    expect(captured?.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(captured?.auth).toBe("Bearer gsk_x");
    expect(captured?.body).toMatchObject({
      model: "qwen3.8-27b",
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
  });

  it("raises LLMHttpError with the status (429 = rate limited)", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429 })) as unknown as typeof fetch;
    const cf = createCloudflareProvider("acc", "tok", "@cf/openai/gpt-oss-20b", fakeFetch);
    await expect(cf.complete({ system: "s", user: "u" })).rejects.toMatchObject({ status: 429, provider: "cloudflare" });
    await expect(cf.complete({ system: "s", user: "u" })).rejects.toBeInstanceOf(LLMHttpError);
    expect(cloudflareUrl("acc")).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/v1/chat/completions");
  });
});

describe("quota accounting", () => {
  function fakeProvider(tokens: number, fail = false): LLMProvider & { calls: number } {
    const provider = {
      name: "groq" as const,
      model: "fake",
      calls: 0,
      async complete() {
        provider.calls += 1;
        if (fail) throw new Error("upstream down");
        return { text: "ok", tokensIn: tokens, tokensOut: tokens };
      },
    };
    return provider;
  }

  it("records every call in llm_usage", async () => {
    const provider = withQuota(fakeProvider(100), "extract_a", db);
    await provider.complete({ system: "s", user: "u", runId: "00000000-0000-0000-0000-000000000009" });
    await provider.complete({ system: "s", user: "u", purpose: "extract_packages" });
    expect(await usedToday("groq", db)).toBe(400);
    const { rows } = await db.query<{ purpose: string; ok: boolean; run_id: string | null }>(
      "select purpose, ok, run_id from llm_usage order by id",
    );
    expect(rows).toEqual([
      { purpose: "extract_a", ok: true, run_id: "00000000-0000-0000-0000-000000000009" },
      { purpose: "extract_packages", ok: true, run_id: null },
    ]);
  });

  it("records failures with ok = false", async () => {
    const provider = withQuota(fakeProvider(10, true), "triage", db);
    await expect(provider.complete({ system: "s", user: "u" })).rejects.toThrow("upstream down");
    const { rows } = await db.query<{ ok: boolean; error: string }>("select ok, error from llm_usage");
    expect(rows).toEqual([{ ok: false, error: "upstream down" }]);
  });

  it("stops before the daily budget minus 10% headroom", async () => {
    process.env.LLM_DAILY_TOKEN_BUDGET__GROQ = "1000";
    const inner = fakeProvider(400);
    const provider = withQuota(inner, "extract_a", db);
    await provider.complete({ system: "s", user: "u" }); // 800 used; 800 < 900 → allowed next
    await provider.complete({ system: "s", user: "u" }); // 1600 used
    await expect(provider.complete({ system: "s", user: "u" })).rejects.toBeInstanceOf(QuotaExceededError);
    expect(inner.calls).toBe(2);
    const summary = await getUsageSummary(db);
    expect(summary.find((row) => row.provider === "groq")).toMatchObject({ usedToday: 1600, budget: 1000, calls: 2 });
  });

  it("records mock usage without a budget", async () => {
    await getLLM("extract_a", db).complete({ system: "s", user: "u".repeat(40), json: true });
    const summary = await getUsageSummary(db);
    expect(summary.find((row) => row.provider === "mock")).toMatchObject({ calls: 1, budget: null });
  });
});

describe("rate limits", () => {
  it("parses Groq reset headers", async () => {
    const { parseResetMs } = await import("./pacer");
    expect(parseResetMs("4.755s")).toBe(4755);
    expect(parseResetMs("1m26.4s")).toBe(86_400);
    expect(parseResetMs("600ms")).toBe(600);
    expect(parseResetMs("7")).toBe(7000);
    expect(parseResetMs(null)).toBeNull();
  });

  it("retries a 429 after the reset the provider gives", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "retry-after": "0.01" } });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const groq = createGroqProvider("gsk_x", "openai/gpt-oss-20b", fakeFetch);
    const response = await groq.complete({ system: "s", user: "u" });
    expect(response.text).toBe("ok");
    expect(calls).toBe(2);
  });
});
