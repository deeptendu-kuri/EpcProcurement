// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import type { LLMProvider } from "@/mvp/llm/types";
import { localNewsQuery, localTerms } from "./local-terms";
import { sourcePlan } from "./plan";

describe("local-language search terms (docs/mvp/19 Phase 3)", () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); }, 60_000);
  afterAll(async () => { await db?.close(); });
  it("translates once per material and language, then reuses the cache", async () => {
    let calls = 0;
    const provider: LLMProvider = { name: "groq", model: "t", async complete(req) {
      calls++;
      expect(req.system).toMatch(/Arabic/);
      return { tokensIn: 1, tokensOut: 1, text: JSON.stringify({ material: "أنابيب الفولاذ المقاوم للصدأ الملحومة", work: "محطات تحلية المياه", awarded: "ترسية عقد", tender: "مناقصة", stockists: "موردو أنابيب الفولاذ" }) };
    } };
    const first = await localTerms(db, "ar", "welded stainless steel pipe", "desalination plants", provider);
    const again = await localTerms(db, "ar", "Welded stainless steel pipe ", "desalination plants", provider);
    expect(calls).toBe(1);
    expect(again).toEqual(first);
    expect(localNewsQuery(first!)).toBe("أنابيب الفولاذ المقاوم للصدأ الملحومة ترسية عقد");
  });
  it("stays in English for English countries and without AI", async () => {
    expect(await localTerms(db, "en", "steel pipe", "pipelines", null)).toBeNull();
    expect(await localTerms(db, "de", "steel pipe", "pipelines", null)).toBeNull();
  });
});

describe("search plan with the exact variant, resellers and local news", () => {
  it("searches the variant, the work that uses it and stockists in every country, alternating countries", () => {
    const plan = sourcePlan({ productId: "ss-duplex-pipe", keyword: "Welded Stainless Steel Pipes 316L", markets: ["AE", "DE"], mode: "preview" });
    const tavily = plan.filter((t) => t.source === "tavily").map((t) => t.query);
    expect(tavily.some((q) => q?.startsWith("Welded Stainless Steel Pipes 316L"))).toBe(true);
    expect(tavily.some((q) => q?.includes("water treatment and desalination plants contractor"))).toBe(true);
    expect(tavily.filter((q) => q?.includes("stockists suppliers"))).toHaveLength(2);
    expect(plan.filter((t) => t.source === "local-news").map((t) => t.market)).toEqual(["AE", "DE"]);
    // Fair order: the first trigger task of each country comes before any country's second.
    const triggers = plan.filter((t) => t.lane === "trigger").map((t) => t.market);
    expect(triggers.slice(0, 2).sort()).toEqual(["AE", "DE"]);
    expect(sourcePlan({ productId: "ss-duplex-pipe", keyword: "stainless steel pipe", markets: ["AE"], mode: "preview", includeResellers: false })
      .some((t) => t.query?.includes("stockists"))).toBe(false);
  });
});
