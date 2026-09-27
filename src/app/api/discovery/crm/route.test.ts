import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ existing: null as Record<string, unknown> | null, upsert: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({ from: () => ({
  select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: mock.existing }), upsert: mock.upsert,
}) }) }));
import { POST } from "./route";

const save = (payload: Record<string, unknown>) => POST(new Request("http://localhost/api/discovery/crm", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "decision-maker", payload }),
}));

beforeEach(() => { mock.existing = null; mock.upsert.mockReset().mockResolvedValue({ error: null }); });

describe("verification provenance", () => {
  it("rejects a manually verified new contact", async () => {
    expect((await save({ id: "one", email: "test@example.com", emailStatus: "Verified" })).status).toBe(400);
    expect(mock.upsert).not.toHaveBeenCalled();
  });
  it("rejects carrying verification over to a changed email", async () => {
    mock.existing = { email: "old@example.com", email_status: "Verified" };
    expect((await save({ id: "one", email: "new@example.com", emailStatus: "Verified" })).status).toBe(400);
  });
  it("preserves trusted provenance when editing an unchanged verified contact", async () => {
    mock.existing = { email: "test@example.com", email_status: "Verified", verified_at: "2026-01-01", verification_source: "Existing result" };
    await save({ id: "one", email: "test@example.com", emailStatus: "Verified", verifiedAt: "invented", verificationSource: "invented" });
    expect(mock.upsert.mock.calls[0][0]).toMatchObject({ verified_at: "2026-01-01", verification_source: "Existing result" });
  });
  it("persists contact trust evidence fields", async () => {
    await save({
      id: "one",
      leadId: "lead-1",
      companyName: "Perma-Pipe",
      name: "Jane Miller",
      title: "Procurement Manager",
      emailStatus: "Verification Pending",
      confidenceBreakdown: { base: 55, professionalProfile: 20, directContact: 15, sourcePage: 10 },
      evidenceSignals: ["LinkedIn/profile evidence", "Email candidate found"],
    });

    expect(mock.upsert.mock.calls[0][0]).toMatchObject({
      confidence_breakdown: { base: 55, professionalProfile: 20, directContact: 15, sourcePage: 10 },
      evidence_signals: ["LinkedIn/profile evidence", "Email candidate found"],
    });
  });
});
