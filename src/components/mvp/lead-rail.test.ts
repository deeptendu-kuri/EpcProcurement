import { describe, expect, it } from "vitest";
import type { OutreachRule } from "@/mvp/types";
import { complianceCounts, draftBlockedReason } from "./lead-rail";

const rule = (email: OutreachRule["email"]): OutreachRule => ({ country: "SA", email, phone: "consent_needed", steps: [], sourceUrl: "" });

describe("lead page right rail (docs/mvp/13 §6)", () => {
  it("counts met / missing / unknown compliance items", () => {
    expect(complianceCounts([{ status: "met" }, { status: "met" }, { status: "missing" }, { status: "unknown" }, { status: "not_applicable" }])).toEqual({
      met: 2,
      missing: 1,
      unknown: 1,
    });
  });

  it("turns Draft email off with the reason only when no contact may be emailed", () => {
    const blocked = { id: "p1", name: "A", country: "SA", rule: rule("consent_needed") };
    const allowed = { id: null, name: "Company", country: "IN", rule: rule("opt_out_only") };
    expect(draftBlockedReason([blocked, allowed])).toBeNull();
    expect(draftBlockedReason([blocked])).toMatch(/consent/);
    expect(draftBlockedReason([])).toMatch(/No contact/);
  });
});
