// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { startRun, waitForRun } from "@/mvp/pipeline";
import { captureOpportunities, getOpportunity, listOpportunities, updateOpportunity, isVerified } from "./index";
import { journey, verifiedProspect } from "./workflow";
import { generateDraft } from "@/mvp/drafts";
import { sendDemoEmail } from "@/mvp/email/send";
import { runInputSchema } from "@/app/api/mvp/_shared/schemas";
import { savedSearchJob } from "@/mvp/scheduler";
import { createSavedSearch } from "@/mvp/saved-searches";
import type { RunInput } from "@/mvp/types";

let db: Db;
let pipeRun: string;
let valveRun: string;
beforeAll(async () => {
  db = await createTestDb(); setDbForTests(db);
  vi.stubEnv("MVP_OFFLINE", "1"); vi.stubEnv("MVP_SCHEDULER", "off"); vi.stubEnv("DEMO_EMAIL_ENABLED", "1");
  vi.stubEnv("GROQ_API_KEY", "");
  pipeRun = await startRun({ query: "pipeline", productId: "line-pipe", contactRole: "buyer", markets: ["IN", "SA", "AE", "NO", "MY"], leadKinds: ["supply_subcontract"], offline: true });
  await waitForRun(pipeRun);
  valveRun = await startRun({ query: "valves", productId: "ball-valves", contactRole: "decision_maker", markets: ["IN", "SA", "AE", "NO", "MY"], leadKinds: ["supply_subcontract"], offline: true });
  await waitForRun(valveRun);
}, 120_000);
afterAll(async () => { setDbForTests(undefined); await db?.close(); vi.unstubAllEnvs(); });

describe("guided search opportunities", () => {
  it("persists separate product/keyword contexts even when articles were already read", async () => {
    const pipes = await listOpportunities(pipeRun);
    const valves = await listOpportunities(valveRun);
    expect(pipes.length).toBeGreaterThan(0); expect(valves.length).toBeGreaterThan(0);
    expect(pipes.every(o => o.product_id === "line-pipe" && o.keyword === "pipeline" && o.contact_role === "buyer")).toBe(true);
    expect(valves.every(o => o.product_id === "ball-valves" && o.keyword === "valves" && o.contact_role === "decision_maker")).toBe(true);
    expect(pipes.some(p => valves.some(v => v.lead_id === p.lead_id && v.id !== p.id))).toBe(true);
    const roles = (await db.query<{ buyer_type: string }>("select buyer_type from leads where id = any($1::uuid[])", [pipes.map(p => p.lead_id)])).rows;
    expect(roles.every(r => r.buyer_type !== "owner")).toBe(true);
    expect(pipes.every(p => p.evidence_ids.length > 0)).toBe(true);
    expect(new Set(pipes.map(p => p.name)).size).toBe(pipes.length);
  });
  it("does not duplicate results when capture is retried", async () => {
    const input: RunInput = { query: "pipeline", productId: "line-pipe", markets: ["IN","SA","AE","NO","MY"], leadKinds: ["supply_subcontract"] };
    expect(await captureOpportunities(pipeRun, input, db)).toBe(0);
  });
  it("does not assign unrelated global buyers to an empty search", async () => {
    const run = (await db.query<{ id: string }>("insert into runs (status) values ('done') returning id")).rows[0].id;
    expect(await captureOpportunities(run, { query: "pipeline", productId: "line-pipe", markets: ["IN"], leadKinds: ["supply_subcontract"] }, db)).toBe(0);
    expect(await listOpportunities(run)).toEqual([]);
  });
  it("keeps role confirmation/manual/dummy emails out of verified CRM; only recent provider validation qualifies", async () => {
    const o = (await listOpportunities(pipeRun))[0];
    await updateOpportunity(o.id, { qualification: "approved" });
    expect(isVerified((await getOpportunity(o.id))!)).toBe(false);
    const company = (await db.query<{ buyer_company_id: string }>("select buyer_company_id from leads where id=$1", [o.lead_id])).rows[0].buyer_company_id;
    const person = (await db.query<{ id: string }>("insert into people (full_name, normalized_name, current_company_id, confirmed_at) values ('Validation fixture','validation fixture',$1,now()) returning id", [company])).rows[0].id;
    await db.query("insert into person_roles (person_id, buying_role) values ($1,'procurement_lead')", [person]);
    await db.query("insert into contact_points (person_id,kind,value,source,verified_at) values ($1,'email','fixture@example.com','manual',now())", [person]);
    expect((await getOpportunity(o.id))!.validated_emails).toBe(0);
    await db.query("update contact_points set source='provider:test' where person_id=$1", [person]);
    expect((await getOpportunity(o.id))!.validated_emails).toBe(1);
    expect(isVerified((await getOpportunity(o.id))!)).toBe(false); // samples never verified
    const oldSample = (await db.query<{ is_sample: boolean }>("select is_sample from leads where id=$1", [o.lead_id])).rows[0].is_sample;
    await db.query("update leads set is_sample=false where id=$1", [o.lead_id]);
    expect(isVerified((await getOpportunity(o.id))!)).toBe(true);
    await db.query("update contact_points set verified_at=now()-interval '91 days' where person_id=$1", [person]);
    expect(isVerified((await getOpportunity(o.id))!)).toBe(false);
    await db.query("update leads set is_sample=$2 where id=$1", [o.lead_id, oldSample]);
    await db.query("delete from people where id=$1", [person]);
  });
  it("scopes email offers and history to the product opportunity", async () => {
    const o = (await listOpportunities(valveRun))[0];
    await expect(generateDraft(o.lead_id, null, { templateOnly: true, opportunityId: o.id })).rejects.toThrow(/Review/);
    await updateOpportunity(o.id, { qualification: "approved", summary: "Discuss valve availability", ownerName: "Demo sales", nextAction: "Review email", followUpAt: "2026-11-01T10:00:00.000Z" });
    const draft = await generateDraft(o.lead_id, null, { templateOnly: true, opportunityId: o.id, demoContact: true });
    expect(draft.body).toContain("ball valves"); expect(draft.body).not.toContain("supplies line pipe");
    const row = (await db.query<{ opportunity_id: string }>("select opportunity_id from outreach_drafts where id=$1", [draft.id])).rows[0];
    expect(row.opportunity_id).toBe(o.id);
    expect((await getOpportunity(o.id))!.summary).toBe("Discuss valve availability");
    const other = (await listOpportunities(pipeRun)).find(p => p.lead_id === o.lead_id);
    if (other) expect(other.summary).not.toBe("Discuss valve availability");
  });
  it("preserves product and role in saved search refreshes", async () => {
    const saved = await createSavedSearch({ name: "Valves", query: "valves", productId: "ball-valves", contactRole: "decision_maker", markets: ["IN"], leadKinds: ["supply_subcontract"], refreshHours: null });
    expect(savedSearchJob(saved).input).toMatchObject({ productId: "ball-valves", contactRole: "decision_maker" });
  });
  it("records provider acceptance for this opportunity only; rejected reviews prevent sending", async () => {
    const o = (await listOpportunities(valveRun))[0];
    await updateOpportunity(o.id, { qualification: "approved" });
    const draft = await generateDraft(o.lead_id, null, { templateOnly: true, opportunityId: o.id });
    vi.stubEnv("RESEND_API_KEY", "re_test_not_real");
    vi.stubEnv("DEMO_RECIPIENT_EMAIL", "test-inbox@example.com");
    vi.stubEnv("DEMO_EMAIL_FROM", "Demo <onboarding@resend.dev>");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: "test-acceptance" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      await updateOpportunity(o.id, { qualification: "rejected" });
      await expect(sendDemoEmail(draft.id, draft)).rejects.toMatchObject({ status: 409 });
      expect(fetch).not.toHaveBeenCalled();
      await updateOpportunity(o.id, { qualification: "approved" });
      await sendDemoEmail(draft.id, draft);
      expect((await getOpportunity(o.id))!.sent).toBe(true);
      const payload = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body);
      expect(payload.to).toEqual(["test-inbox@example.com"]);
      const pipe = (await listOpportunities(pipeRun)).find(p => p.lead_id === o.lead_id);
      if (pipe) expect(pipe.sent).toBe(false);
      await sendDemoEmail(draft.id, draft);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});
describe("workflow boundaries", () => {
  it("requires both fit review and validation, never qualifies samples", () => {
    expect(verifiedProspect("pending",1,false)).toBe(false);
    expect(verifiedProspect("approved",0,false)).toBe(false);
    expect(verifiedProspect("approved",1,true)).toBe(false);
    expect(verifiedProspect("approved",1,false)).toBe(true);
    expect(journey("approved",0,true).stage).toBe("Demo email sent");
    expect(journey("rejected",1,true).stage).toBe("Not relevant");
  });
  it("accepts every ISO country and rejects invented codes/products and oversized selections", () => {
    const input = { query: "valves", productId: "ball-valves", markets: ["US","DE","JP"], leadKinds: ["supply_subcontract"] };
    expect(runInputSchema.safeParse(input).success).toBe(true);
    expect(runInputSchema.safeParse({ ...input, markets: ["ZZ"] }).success).toBe(false);
    expect(runInputSchema.safeParse({ ...input, productId: "imaginary" }).success).toBe(false);
  });
});
