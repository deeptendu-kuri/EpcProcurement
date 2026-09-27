// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getClientProfile } from "@/mvp/config/profile";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { bidChecklist, buildChecklist, eligibilityPoints, outreachForPeople, outreachRules, type ChecklistInput } from "./index";

const NOW = new Date("2026-09-27T00:00:00Z");

function input(over: Partial<ChecklistInput> = {}): ChecklistInput {
  return {
    kind: "bid",
    market: "SA",
    buyerName: "Example Government Buyer",
    buyerTypes: ["government_buyer"],
    projectOwnerName: null,
    projectSector: "oil_gas",
    valueUsd: 10_000_000,
    isGovernment: true,
    namedStandards: [],
    profile: getClientProfile(),
    now: NOW,
    ...over,
  };
}

const status = (items: ReturnType<typeof buildChecklist>, key: string) => items.find((i) => i.ruleKey === key)?.status;

describe("outreach rules (08 §3)", () => {
  it.each([
    ["IN", "opt_out_only", "blocked"],
    ["SA", "consent_needed", "consent_needed"],
    ["AE", "opt_out_only", "opt_out_only"],
    ["QA", "opt_out_only", "opt_out_only"],
    ["OM", "opt_out_only", "opt_out_only"],
    ["KW", "opt_out_only", "opt_out_only"],
    ["BH", "opt_out_only", "opt_out_only"],
    ["NO", "consent_needed", "opt_out_only"],
    ["MY", "consent_needed", "consent_needed"],
    ["FR", "opt_out_only", "opt_out_only"],
  ] as const)("%s → email %s, phone %s", (country, email, phone) => {
    const rule = outreachRules(country);
    expect(rule.country).toBe(country);
    expect(rule.email).toBe(email);
    expect(rule.phone).toBe(phone);
    expect(rule.steps.length).toBeGreaterThan(0);
  });

  it("India phone step names the 140-series and DND scrub", () => {
    expect(outreachRules("in").steps.join(" ")).toMatch(/140-series.*DND/);
  });

  it("per-person rules use the contact's country, then the fallback", () => {
    const rules = outreachForPeople([{ id: "a", country: "SA" }, { id: "b", country: null }], "AE");
    expect(rules.map((r) => [r.country, r.rule.email])).toEqual([["SA", "consent_needed"], ["AE", "opt_out_only"]]);
  });
});

describe("bid checklist (08 §2)", () => {
  it("SA government tender: Etimad missing (hard) → 4.1 = 0", () => {
    const items = buildChecklist(input());
    expect(status(items, "SA_ETIMAD_REG")).toBe("missing");
    expect(status(items, "SA_IKTVA")).toBe("not_applicable");
    expect(status(items, "ALL_SANCTIONS")).toBe("unknown");
    expect(eligibilityPoints(items).points).toBe(0);
  });

  it("Aramco buyer: IKTVA unknown and Ariba missing", () => {
    const items = buildChecklist(input({ kind: "supply_subcontract", buyerName: "Example EPC", isGovernment: false, projectOwnerName: "Saudi Aramco" }));
    expect(status(items, "SA_IKTVA")).toBe("unknown");
    expect(status(items, "SA_ARAMCO_ARIBA")).toBe("missing");
    expect(status(items, "SA_ETIMAD_REG")).toBe("not_applicable");
  });

  it("AE: valid ICV met, ADNOC hub registered → 8 (sanctions don't count for 4.1)", () => {
    const items = buildChecklist(input({ market: "AE", buyerName: "ADNOC Example", isGovernment: false, kind: "supply_subcontract" }));
    expect(status(items, "AE_ICV")).toBe("met");
    expect(status(items, "AE_ADNOC_HUB")).toBe("met");
    expect(eligibilityPoints(items).points).toBe(8);
  });

  it("named standards: API 5L held → met; API 6A not held → missing", () => {
    expect(status(buildChecklist(input({ market: "IN", namedStandards: ["API 5L"] })), "ALL_CERTS")).toBe("met");
    expect(status(buildChecklist(input({ market: "IN", namedStandards: ["API 6A"] })), "ALL_CERTS")).toBe("missing");
  });

  it("some hard item unknown → 4", () => {
    const items = buildChecklist(input({ market: "QA", isGovernment: false }));
    expect(status(items, "QA_TAWTEEN_ICV")).toBe("unknown");
    expect(eligibilityPoints(items).points).toBe(4);
  });

  describe("bidChecklist(leadId)", () => {
    let db: Db;
    beforeAll(async () => {
      db = await createTestDb();
      setDbForTests(db);
    }, 120_000);
    afterAll(async () => {
      setDbForTests(undefined);
      await db?.close();
    });

    it("loads the lead's market and buyer", async () => {
      const buyer = (await db.query<{ id: string }>(
        "insert into companies (canonical_name, normalized_name, country, types) values ('Example Ministry', 'example ministry', 'IN', '{government_buyer}') returning id",
      )).rows[0].id;
      const project = (await db.query<{ id: string }>(
        "insert into projects (name, normalized_name, country, owner_company_id) values ('P', 'p', 'IN', $1) returning id",
        [buyer],
      )).rows[0].id;
      const lead = (await db.query<{ id: string }>(
        "insert into leads (kind, buyer_company_id, project_id, score_breakdown, gate_results, class, reasons, scoring_version) values ('bid', $1, $2, '{}', '[]', 'watch', '[]', 1) returning id",
        [buyer, project],
      )).rows[0].id;
      const items = await bidChecklist(lead);
      expect(status(items, "IN_GEM_CPPP_REG")).toBe("met");
      expect(status(items, "IN_PPP_MII")).toBe("met");
      expect(await bidChecklist("00000000-0000-4000-8000-000000000000")).toEqual([]);
    });
  });
});
