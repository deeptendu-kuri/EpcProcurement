// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getClientProfile } from "@/mvp/config/profile";
import { detectCountry, detectMarkets, filterDocument, queryTerms } from "./filter";
import { projectCountry } from "./resolve";
import type { ExtractedDoc } from "./extract";
import { buildGdeltQuery } from "./sources/gdelt";
import { buildBingQuery } from "./sources/bing-news";

const NOW = new Date("2026-10-09T00:00:00Z");
// Example synthetic article text: tests country recognition, not live coverage.
const kenya = "Example Pipelines Ltd has been awarded a contract for the 120 km line pipe project in Kenya.";
const filter = (text: string, markets: string[]) =>
  filterDocument({ title: null, text, publishedAt: NOW.toISOString(), markets, queryTerms: queryTerms("line pipe"), profile: getClientProfile(), now: NOW });

describe("news path works for countries outside the default markets", () => {
  it("recognises a searched country by its full name", () => {
    expect(detectMarkets(kenya)).toEqual([]);
    expect(detectMarkets(kenya, ["KE"])).toEqual(["KE"]);
  });

  it("normalises and deduplicates countries without admitting invalid codes", () => {
    expect(detectMarkets(kenya, ["ke", "KE", "invalid"])).toEqual(["KE"]);
    expect(detectMarkets("Example pipeline contract in India.", ["in", "IN"])).toEqual(["IN"]);
    expect(detectMarkets(kenya, ["invalid"])).toEqual([]);
  });

  it("treats an article about the searched country as relevant, not unclear", () => {
    const result = filter(kenya, ["KE"]);
    expect(result.verdict).toBe("relevant");
    expect(result.markets).toEqual(["KE"]);
  });

  it("keeps an article that also mentions a default market", () => {
    const result = filter(`${kenya} The pipes will be shipped from India.`, ["KE"]);
    expect(result.verdict).toBe("relevant");
    expect(result.markets).toEqual(["KE"]);
  });

  it("does not change behaviour for the default markets", () => {
    expect(filter("GAIL has awarded a line pipe contract in India.", ["IN"]).markets).toEqual(["IN"]);
    expect(filter(kenya, ["IN"]).verdict).toBe("uncertain");
  });

  it("reads any country from a project location", () => {
    expect(detectCountry("Mombasa, Kenya")).toBe("KE");
    expect(detectCountry("Santos, Brazil")).toBe("BR");
    expect(detectCountry("Jubail")).toBe("SA");
    expect(detectCountry("somewhere offshore")).toBeNull();
    const ex = { project: { location: { value: "Mombasa, Kenya" } }, requirements: [], companies: [] } as unknown as ExtractedDoc;
    expect(projectCountry(ex, null)).toBe("KE");
  });

  it("searches GDELT and legacy Bing with country names, not codes", () => {
    const gdelt = buildGdeltQuery(["line pipe"], ["KE", "BR"]);
    expect(gdelt).toContain("Kenya");
    expect(gdelt).toContain("Brazil");
    expect(gdelt).not.toMatch(/\bKE\b|\bBR\b/);
    expect(buildBingQuery(["line pipe"], "KE")).toContain("Kenya");
  });
});
