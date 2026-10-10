import { describe, expect, it } from "vitest";
import { getClientProfile } from "@/mvp/config/profile";
import type { SourceContext } from "@/mvp/pipeline/contracts";
import { buying } from "./sources";

const ctx = (productId: string): SourceContext => ({
  runId: "r", input: { productId, markets: ["SA"] } as unknown as SourceContext["input"], profile: getClientProfile(), terms: [], log: async () => {},
});

describe("project award news counts for piping materials (web audit, 10 Oct)", () => {
  const award = "Aramco awards EPC contract for Jafurah gas plant expansion to Samsung E&A";
  it("keeps an award for a gas plant, which consumes pipe and fittings", () => {
    expect(buying(award, ctx("bw-fittings"))).toBe(true);
    expect(buying("ACWA Power awards EPC contract for Ras Mohaisen desalination plant", ctx("line-pipe"))).toBe(true);
  });
  it("does not widen other materials", () => {
    expect(buying(award, ctx("cables"))).toBe(false);
  });
  it("still needs an award or contract word", () => {
    expect(buying("Aramco gas plant output rises in the second quarter", ctx("bw-fittings"))).toBe(false);
  });
});
