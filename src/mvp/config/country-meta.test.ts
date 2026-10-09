// @vitest-environment node
import { describe, expect, it } from "vitest";
import { COUNTRY_CODES } from "./countries";
import { bingMarket, countryLanguage, gdeltCountry, tavilyCountry } from "./country-meta";

describe("country search details (docs/mvp/19 Phase 3)", () => {
  it("covers every country with a GDELT code except two uninhabited territories", () => {
    const missing = COUNTRY_CODES.filter((c) => !gdeltCountry(c));
    expect(missing.sort()).toEqual(["AX", "UM"]);
    expect([gdeltCountry("DE"), gdeltCountry("GB"), gdeltCountry("CH"), gdeltCountry("SZ"), gdeltCountry("NG"), gdeltCountry("ZA")]).toEqual(["GM", "UK", "SZ", "WZ", "NI", "SF"]);
  });
  it("knows each country's news language", () => {
    expect(["AE", "DE", "BR", "TR", "KE", "IN", "MX", "FR"].map(countryLanguage)).toEqual(["ar", "de", "pt", "tr", "en", "en", "es", "fr"]);
  });
  it("sends Tavily only names it accepts", () => {
    expect(["AE", "TR", "CZ", "KE", "DE", "US", "GB"].map(tavilyCountry)).toEqual(["united arab emirates", "turkey", "czech republic", "kenya", "germany", "united states", "united kingdom"]);
    expect(tavilyCountry("CI")).toBeNull(); // Côte d’Ivoire is not in Tavily's list: name goes in the query instead
  });
  it("picks a local-language and an English Bing News market", () => {
    expect([bingMarket("SA", "local"), bingMarket("SA", "en"), bingMarket("DE", "local"), bingMarket("KE", "local"), bingMarket("KE", "en"), bingMarket("IN", "en")])
      .toEqual(["ar-SA", "en-XA", "de-DE", "en-US", "en-US", "en-IN"]);
  });
});
