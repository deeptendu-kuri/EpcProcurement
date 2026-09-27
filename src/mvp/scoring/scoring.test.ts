// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { GateResult } from "@/mvp/types";
import { classifyLead, findSub, researchTasks, totalScore } from "./classify";
import { computeConfidence, confidenceBand, freshnessWeight } from "./confidence";
import type { ScoringContext } from "./context";
import { evidence, IDS, NOW, workedExample } from "./fixtures.test-helpers";
import { evaluateGates } from "./gates";
import { topReasons } from "./reasons";
import { buildBreakdown, scoreRubric, sub } from "./rubric";
import { scoreContext } from "./index";
import { signalFingerprint } from "./signals";
import { parseSpec } from "./util";

const PASS: GateResult[] = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"].map((id) => ({ id, pass: true, why: "ok" }));

function gate(ctx: ScoringContext, id: string): GateResult {
  return evaluateGates(ctx).find((g) => g.id === id)!;
}

describe("worked example (07 §10)", () => {
  it("exact sub-scores add up to 71 and classify as genuine", () => {
    const breakdown = buildBreakdown([
      sub("1.1", 10, "Pipeline discipline"),
      sub("1.2", 6, "Spec in range"),
      sub("1.3", 5, "Oil and gas"),
      sub("1.4", 2, "Above sweet spot"),
      sub("2.1", 8, "Awarded 20 days ago"),
      sub("2.2", null, "No needed-by date"),
      sub("2.3", 4, "Fresh"),
      sub("2.4", 3, "Award + hiring"),
      sub("3.1", 3, "Typical buyer"),
      sub("3.2", 6, "Award confirmed"),
      sub("3.3", 5, "4 similar awards"),
      sub("3.4", 3, "Listed and active"),
      sub("4.1", 4, "Local content unknown"),
      sub("4.2", 1, "Company channel only"),
      sub("4.3", 2, "Recent award"),
      sub("4.4", 0, "No relationship"),
      sub("5.1", 4, "Value above sweet spot"),
      sub("5.2", null, "Competition unknown"),
      sub("5.3", 5, "Port matches"),
    ]);
    expect(breakdown.criteria.map((c) => c.total)).toEqual([23, 15, 17, 7, 9]);
    expect(breakdown.criteria.map((c) => c.max)).toEqual([25, 20, 20, 20, 15]);
    const score = totalScore(breakdown.criteria);
    expect(score).toBe(71);
    expect(breakdown.unknown).toEqual(["2.2", "5.2"]);

    const { confidence, band } = computeConfidence(
      [evidence("a"), evidence("b", { tier: "B", publisherKey: "trade-press" })],
      1,
      NOW,
    );
    expect(confidence).toBe(0.955);
    expect(band).toBe("high");

    const cls = classifyLead({ gates: PASS, score, band, eligibility: 4, size: 2, stage: "awarded" });
    expect(cls).toBe("genuine");
    // 3.1 = 3 of 6 is exactly half → no task; 4.3 = 2 of 4 likewise.
    expect(researchTasks(breakdown.criteria, cls)).toEqual(["2.2", "4.2", "5.2"]);
  });

  it("the full scorer reproduces the example from facts: 71, high, genuine", () => {
    const ctx = workedExample();
    const breakdown = scoreRubric(ctx);
    const points = Object.fromEntries(breakdown.criteria.flatMap((c) => c.subs.map((s) => [s.id, s.points])));
    expect(points).toEqual({
      "1.1": 10, "1.2": 6, "1.3": 5, "1.4": 2,
      "2.1": 8, "2.2": null, "2.3": 4, "2.4": 3,
      "3.1": 3, "3.2": 6, "3.3": 5, "3.4": 3,
      "4.1": 4, "4.2": 1, "4.3": 2, "4.4": 0,
      "5.1": 4, "5.2": null, "5.3": 5,
    });
    const result = scoreContext(ctx);
    expect(result.gates.every((g) => g.pass)).toBe(true);
    expect(result.score).toBe(71);
    expect(result.confidence).toBe(0.955);
    expect(result.band).toBe("high");
    expect(result.leadClass).toBe("genuine");
    expect(result.reasons).toHaveLength(3);
    expect(result.reasons[0].text).toMatch(/pipeline/i);
    expect(result.clientProductIds).toEqual(["prod-line-pipe"]);
    // If research finds a mapped procurement manager, 4.2 rises (3 here: contact unverified).
    const withPerson = workedExample();
    withPerson.people = [
      {
        person: { id: "p1", full_name: "A Example", normalized_name: "a example", current_company_id: IDS.buyer, title: "Procurement Manager", department: null, seniority: "manager", country: "IN", profile_url: null, created_at: "" },
        roles: [{ id: "r1", person_id: "p1", company_id: IDS.buyer, project_id: IDS.project, package_id: null, buying_role: "procurement_lead", works_with_person_id: null, start_date: null, end_date: null, created_at: "" }],
      },
    ];
    expect(scoreContext(withPerson).score).toBe(73);
  });
});

describe("confidence (07 §5)", () => {
  it("keeps one vote per publisher", () => {
    const same = computeConfidence([evidence("a"), evidence("b", { tier: "B" })], 1, NOW);
    expect(same.confidence).toBe(0.85);
  });
  it("applies verification, freshness, agreement and match certainty", () => {
    expect(freshnessWeight(10)).toBe(1);
    expect(freshnessWeight(200)).toBe(0.8);
    expect(freshnessWeight(400)).toBe(0.5);
    const old = computeConfidence([evidence("a", { publishedAt: "2025-01-01T00:00:00Z", quoteVerified: false, agreement: "single" })], 0.9, NOW);
    expect(old.confidence).toBeCloseTo(0.85 * 0.3 * 0.5 * 0.75 * 0.9, 3);
    expect(confidenceBand(0.8)).toBe("high");
    expect(confidenceBand(0.79)).toBe("medium");
    expect(confidenceBand(0.5)).toBe("medium");
    expect(confidenceBand(0.49)).toBe("low");
    expect(computeConfidence([], 1, NOW).confidence).toBe(0);
  });
});

describe("classification boundaries (07 §8)", () => {
  const base = { gates: PASS, band: "high" as const, eligibility: 8, size: 4, stage: "awarded" as const };
  it.each([
    [54, "high", "watch"],
    [55, "high", "research"],
    [69, "high", "research"],
    [70, "high", "genuine"],
    [70, "medium", "research"],
    [85, "medium", "research"],
    [70, "low", "watch"],
    [60, "low", "research"],
  ] as const)("score %i with %s confidence → %s", (score, band, expected) => {
    expect(classifyLead({ ...base, score, band })).toBe(expected);
  });
  it("4.1 = 0 blocks genuine", () => {
    expect(classifyLead({ ...base, score: 80, eligibility: 0 })).toBe("watch");
  });
  it("concept stage or 1.4 = 0 → watch", () => {
    expect(classifyLead({ ...base, score: 90, stage: "concept" })).toBe("watch");
    expect(classifyLead({ ...base, score: 90, size: 0 })).toBe("watch");
  });
  it("any failed gate → rejected", () => {
    const gates = PASS.map((g) => (g.id === "G5" ? { ...g, pass: false } : g));
    expect(classifyLead({ ...base, gates, score: 95 })).toBe("rejected");
  });
});

describe("gates (07 §3)", () => {
  it("worked example passes all 8, G7 is the demo stub", () => {
    const gates = evaluateGates(workedExample());
    expect(gates.map((g) => g.id)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]);
    expect(gates.every((g) => g.pass)).toBe(true);
    expect(gates[6].why).toBe("Sanctions screening not run in demo");
  });

  it("G1 fails on low match certainty or struck-off", () => {
    const ctx = workedExample();
    ctx.buyer.match_certainty = 0.6;
    expect(gate(ctx, "G1").pass).toBe(false);
    const ctx2 = workedExample();
    ctx2.buyer.status = "struck_off";
    expect(gate(ctx2, "G1").pass).toBe(false);
    const ctx3 = workedExample();
    ctx3.buyer.match_certainty = 0.85;
    expect(gate(ctx3, "G1").pass).toBe(true);
  });

  it("G2 passes on discipline or product, fails otherwise", () => {
    const ctx = workedExample();
    ctx.leadPackage!.discipline = "electrical";
    expect(gate(ctx, "G2").pass).toBe(true); // requirement still matches a product
    ctx.requirements = [];
    expect(gate(ctx, "G2").pass).toBe(false);
    ctx.leadPackage!.discipline = "insulation_painting"; // adjacent
    expect(gate(ctx, "G2").pass).toBe(true);
  });

  it("G3 needs a client market", () => {
    const ctx = workedExample();
    ctx.project!.country = "DE";
    expect(gate(ctx, "G3").pass).toBe(true); // supply lead: buyer is in IN
    ctx.buyer.country = "DE";
    expect(gate(ctx, "G3").pass).toBe(false);
  });

  it("G4 supply: award under 18 months; project not cancelled", () => {
    const ctx = workedExample();
    ctx.triggerSignals[0].signal_date = "2025-01-15";
    ctx.parties[0].award_date = "2025-01-15";
    expect(gate(ctx, "G4").pass).toBe(false);
    const ctx2 = workedExample();
    ctx2.project!.status = "cancelled";
    expect(gate(ctx2, "G4").pass).toBe(false);
    const ctx3 = workedExample();
    ctx3.project!.current_stage = "operations";
    expect(gate(ctx3, "G4").pass).toBe(false);
  });

  it("G4 supply: fails without an award date even with a recent non-award signal", () => {
    const ctx = workedExample();
    ctx.triggerSignals = ctx.triggerSignals.map((s) => ({ ...s, type: "hiring_project_roles" as typeof s.type, signal_date: "2026-09-20" }));
    ctx.parties = ctx.parties.map((p) => ({ ...p, award_date: null }));
    const g4 = gate(ctx, "G4");
    expect(g4.pass).toBe(false);
    expect(g4.why).toBe("No award date found");
  });

  it("G4 bid: closing ≥ 3 days away, or no date and a signal under 60 days", () => {
    const ctx = workedExample();
    ctx.kind = "bid";
    ctx.tender = { ref: "T-1", title: null, buyerCompanyId: IDS.buyer, packageId: null, issueDate: "2026-09-10", closingDate: "2026-09-29", status: "open", route: "open_tender", budgetUsd: null, isGovernment: null, biddersCount: null, approvedVendors: [], evidenceIds: [] };
    expect(gate(ctx, "G4").pass).toBe(false);
    ctx.tender.closingDate = "2026-09-30";
    expect(gate(ctx, "G4").pass).toBe(true);
    ctx.tender = null;
    expect(gate(ctx, "G4").pass).toBe(true); // signal 20 days old
    ctx.triggerSignals[0].signal_date = "2026-07-01";
    expect(gate(ctx, "G4").pass).toBe(false);
  });

  it("G5: Tier A, or two independent publishers; same publisher twice is not enough", () => {
    const ctx = workedExample();
    ctx.evidence[IDS.evA] = evidence(IDS.evA, { tier: "B", publisherKey: "news-one" });
    expect(gate(ctx, "G5").pass).toBe(true); // B + B from two publishers
    ctx.evidence[IDS.evA] = evidence(IDS.evA, { tier: "B", publisherKey: "pipelinejournal.example" });
    expect(gate(ctx, "G5").pass).toBe(false); // same publisher twice
    const ctx2 = workedExample();
    ctx2.evidence[IDS.evA] = evidence(IDS.evA, { agreement: "single" }); // Tier A but not gate-grade
    ctx2.evidence[IDS.evB] = evidence(IDS.evB, { tier: "B", publisherKey: "x", agreement: "single" });
    expect(gate(ctx2, "G5").pass).toBe(false);
  });

  it("G6: facts used by gates must be quote-verified and agreed (both/rule)", () => {
    const ctx = workedExample();
    ctx.evidence[IDS.evA] = evidence(IDS.evA, { agreement: "single" });
    ctx.evidence[IDS.evB] = evidence(IDS.evB, { tier: "B", publisherKey: "p2", quoteVerified: false });
    expect(gate(ctx, "G6").pass).toBe(false);
    const ctx2 = workedExample();
    ctx2.evidence[IDS.evB] = evidence(IDS.evB, { tier: "B", publisherKey: "p2", agreement: "both" });
    expect(gate(ctx2, "G6").pass).toBe(true);
  });

  it("G6: one `both` fact does not cover a `single` fact on the same entity", () => {
    const evBoth = "00000000-0000-4000-8000-0000000000d1";
    const evSingle = "00000000-0000-4000-8000-0000000000d2";
    const ctx = workedExample();
    ctx.evidence[evBoth] = evidence(evBoth, { agreement: "both" });
    ctx.evidence[evSingle] = evidence(evSingle, { agreement: "single" });
    ctx.factEvidence[`company:${IDS.buyer}`] = [evBoth, evSingle];
    // Without field info every evidence id counts as its own fact.
    expect(gate(ctx, "G6").pass).toBe(false);
    // Different fields: country is single-only → fails and names the fact.
    ctx.fieldEvidence = { [`company:${IDS.buyer}:canonical_name`]: [evBoth], [`company:${IDS.buyer}:country`]: [evSingle] };
    const failed = gate(ctx, "G6");
    expect(failed.pass).toBe(false);
    expect(failed.why).toContain("buyer country");
    // Same field backed by a `both` source and a weaker one → the fact is verified.
    ctx.fieldEvidence = { [`company:${IDS.buyer}:canonical_name`]: [evBoth, evSingle] };
    expect(gate(ctx, "G6").pass).toBe(true);
  });

  it("G6 checks every package G2 looked at when the lead has no package", () => {
    const evSingle = "00000000-0000-4000-8000-0000000000d3";
    const ctx = workedExample();
    ctx.evidence[evSingle] = evidence(evSingle, { agreement: "single" });
    ctx.leadPackage = null;
    ctx.factEvidence[`package:${IDS.pkg}`] = [evSingle];
    expect(gate(ctx, "G6").pass).toBe(false);
  });

  it("G8 rejects excluded companies", () => {
    const ctx = workedExample();
    ctx.profile = { ...ctx.profile, excluded_company_names: ["Example Pipelines Construction Limited"] };
    expect(gate(ctx, "G8").pass).toBe(false);
    expect(scoreContext(ctx).leadClass).toBe("rejected");
  });
});

describe("rubric details", () => {
  it("1.2: conflicting spec = 0, family only = 3, no requirements = unknown", () => {
    const ctx = workedExample();
    ctx.requirements[0].spec = { grade: "X80" };
    expect(findSub(scoreRubric(ctx).criteria, "1.2")?.points).toBe(0);
    ctx.requirements[0].spec = {};
    ctx.requirements[0].item_category = "line pipe";
    expect(findSub(scoreRubric(ctx).criteria, "1.2")?.points).toBe(3);
    ctx.requirements = [];
    expect(findSub(scoreRubric(ctx).criteria, "1.2")?.points).toBeNull();
  });

  it("1.4 below minimum = 0 and triggers watch", () => {
    const ctx = workedExample();
    ctx.leadPackage!.value_usd = 1_000_000;
    const result = scoreContext(ctx);
    expect(findSub(result.breakdown.criteria, "1.4")?.points).toBe(0);
    expect(result.leadClass).toBe("watch");
  });

  it("2.2 deadline windows", () => {
    const ctx = workedExample();
    ctx.leadPackage!.needed_by = "2026-11-01"; // 35 days
    expect(findSub(scoreRubric(ctx).criteria, "2.2")?.points).toBe(5);
    ctx.leadPackage!.needed_by = "2026-10-05"; // 8 days
    expect(findSub(scoreRubric(ctx).criteria, "2.2")?.points).toBe(3);
    ctx.leadPackage!.needed_by = "2027-09-01";
    expect(findSub(scoreRubric(ctx).criteria, "2.2")?.points).toBe(0);
  });

  it("reasons are the top 3 sub-criteria with evidence", () => {
    const reasons = topReasons(scoreRubric(workedExample()).criteria);
    expect(reasons).toHaveLength(3);
    expect(reasons[0].evidenceIds.length).toBeGreaterThan(0);
  });
});

describe("helpers", () => {
  it("fingerprint is stable per event and month", () => {
    const base = { type: "contract_awarded" as const, companyId: "c", projectId: "p", packageId: null, tenderRef: null, signalDate: "2026-09-07" };
    expect(signalFingerprint(base)).toBe(signalFingerprint({ ...base, signalDate: "2026-09-28" }));
    expect(signalFingerprint(base)).not.toBe(signalFingerprint({ ...base, signalDate: "2026-10-01" }));
    expect(signalFingerprint(base)).toMatch(/^[0-9a-f]{40}$/);
  });
  it("parses specs from loose shapes", () => {
    expect(parseSpec({ grade: "API 5L X65 PSL2", size: '24"' })).toEqual({ grades: ["X65"], standards: [], odIn: [24] });
    expect(parseSpec({ od_mm: 610 }).odIn[0]).toBe(24);
    expect(parseSpec({}, "API 5L X70 line pipe 36-inch")).toEqual({ grades: ["X70"], standards: ["API 5L"], odIn: [36] });
  });
});
