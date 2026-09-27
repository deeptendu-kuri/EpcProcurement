import { describe, expect, it } from "vitest";
import { companyNameSimilarity, normalizeCompanyName } from "./normalization";

describe("company normalization", () => {
  it("removes common legal suffixes", () => {
    expect(normalizeCompanyName("ABC Construction L.L.C.")).toBe("abc construction");
    expect(normalizeCompanyName("ABC Constructions Ltd")).toBe("abc constructions");
  });

  it("provides a conservative similarity signal", () => {
    expect(companyNameSimilarity("ABC Construction LLC", "ABC Construction")).toBe(1);
    expect(companyNameSimilarity("ABC Construction", "XYZ Energy")).toBeLessThan(0.5);
  });
});
