// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasSpec, parseMaterialSpec, specBrief, specChips, specSearchWords, specUses } from "./spec";

describe("material spec from the user's words (docs/mvp/19 Phase 1)", () => {
  it.each([
    ["Welded Stainless Steel Pipes", { method: "welded", grades: [], standards: [] }],
    ["seamless pipe ASTM A106 Gr B sch 40", { method: "seamless", grades: ["Gr B"], standards: ["ASTM A106"], sizes: ["sch 40"] }],
    ["SS 316L welded pipe A312 2 inch", { method: "welded", grades: ["316L"], standards: ["ASTM A312"], sizes: ["2 inch"] }],
    ["API 5L X65 PSL2 LSAW line pipe", { method: "lsaw", grades: ["X65"], standards: ["API 5L", "PSL2"] }],
    ["ERW black steel pipe", { method: "erw", finishes: ["black"] }],
    ["duplex 2205 seamless tube", { method: "seamless", grades: ["duplex", "2205"] }],
    ["spiral welded pipe for water", { method: "ssaw" }],
    ["GI pipe 1/2 inch", { method: null, finishes: ["GI"], sizes: ["1/2 inch"] }],
    ["steel plates SA516 Gr 70", { grades: ["SA516 Gr 70"] }],
    ["steel pipe", { method: null, grades: [], standards: [], sizes: [], finishes: [] }],
  ])("%s", (words, expected) => {
    expect(parseMaterialSpec(words)).toMatchObject(expected);
  });
  it("knows when there is nothing beyond the base product", () => {
    expect(hasSpec(parseMaterialSpec("stainless steel pipe"))).toBe(false);
    expect(hasSpec(parseMaterialSpec("welded stainless steel pipe"))).toBe(true);
  });
  it("labels, searches and briefs with the variant", () => {
    const spec = parseMaterialSpec("Welded SS pipe 316L A312");
    expect(specChips(spec)).toEqual(["Welded", "316L", "ASTM A312"]);
    expect(specSearchWords("stainless steel pipe", spec)).toBe("welded stainless steel pipe ASTM A312");
    expect(specUses("ss-duplex-pipe", spec)[0]).toBe("water treatment and desalination plants");
    expect(specUses("ss-duplex-pipe", parseMaterialSpec("seamless ss pipe"))[0]).toMatch(/high-pressure/);
    expect(specUses("plates", spec)).toEqual([]);
    expect(specBrief("stainless steel pipe", "ss-duplex-pipe", spec)).toMatch(/^Welded, 316L, ASTM A312 stainless steel pipe; typically used in water treatment/);
  });
});
