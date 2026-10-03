// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { updateDraft } from "@/mvp/repo";
import { approveCampaign, controlCampaign, listCampaigns, processCampaignQueue, workerAuthorized } from "./campaigns";
import { sendDemoEmail } from "./send";
import { POST as workerPost } from "@/app/api/mvp/outreach/worker/route";
import { POST as approvePost } from "@/app/api/mvp/outreach/campaigns/route";

let db: Db;
const fetchMock = vi.fn();
const text = { subject: "Line pipe support", body: "Hello, could we discuss your line pipe specifications? This is a demo." };
beforeAll(async () => { db = await createTestDb(); setDbForTests(db); }, 120_000);
afterAll(async () => { setDbForTests(undefined); await db?.close(); });
beforeEach(async () => {
  vi.stubEnv("DEMO_EMAIL_ENABLED", "1"); vi.stubEnv("DEMO_RECIPIENT_EMAIL", "deeptendukuri@gmail.com");
  vi.stubEnv("RESEND_API_KEY", "re_fake_unit_test"); vi.stubEnv("DEMO_EMAIL_FROM", "Demo <onboarding@resend.dev>");
  vi.stubEnv("APP_URL", ""); vi.stubEnv("OUTREACH_WORKER_SECRET", "a".repeat(40));
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  await db.exec("delete from demo_campaigns; delete from outreach_drafts;");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function seed(qualification = "approved", companyId?: string) {
  const company = companyId ?? (await db.query<{ id: string }>("insert into companies (canonical_name,normalized_name,country) values ('Test EPC','test epc','IN') returning id")).rows[0].id;
  const priorLead = (await db.query<{ id: string }>("select id from leads where buyer_company_id=$1 limit 1", [company])).rows[0];
  const lead = priorLead?.id ?? (await db.query<{ id: string }>("insert into leads (kind,buyer_company_id,score_breakdown,gate_results,class,reasons,scoring_version) values ('supply_subcontract',$1,'{}','[]','research','[]',1) returning id", [company])).rows[0].id;
  const run = (await db.query<{ id: string }>("insert into runs (status) values ('done') returning id")).rows[0].id;
  const opportunity = (await db.query<{ id: string }>(`insert into search_opportunities
    (run_id,lead_id,company_id,keyword,product_id,product_name,buying_reason,evidence_ids,qualification)
    values ($1,$2,$3,'pipeline','line-pipe','Line pipe','Sample test evidence','{}',$4) returning id`, [run,lead,company,qualification])).rows[0].id;
  const draft = (await db.query<{ id: string }>("insert into outreach_drafts (lead_id,opportunity_id,subject,body,demo_only) values ($1,$2,$3,$4,true) returning id", [lead,opportunity,text.subject,text.body])).rows[0].id;
  return { company, opportunity, draft };
}
const accept = () => fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "provider-unit-id" }), { status: 200 }));
const state = async (id: string) => (await db.query("select * from demo_campaigns where id = $1", [id])).rows[0];

describe("approved single-inbox automation", () => {
  it("queues, freezes approval, and never sends during approval", async () => {
    const s = await seed(); const c = await approveCampaign(s.draft, text);
    expect(c.status).toBe("queued"); expect(fetchMock).not.toHaveBeenCalled();
    expect((await approveCampaign(s.draft, text)).id).toBe(c.id);
    await expect(approveCampaign(s.draft, { ...text, body: "Changed" })).rejects.toMatchObject({ status: 409 });
    await expect(updateDraft(s.draft, { subject: "Changed" })).rejects.toThrow("locked");
    await expect(sendDemoEmail(s.draft, text)).rejects.toMatchObject({ status: 409 });
  });
  it("requires reviewed fit and the one approved inbox", async () => {
    const s = await seed("pending");
    await expect(approveCampaign(s.draft, text)).rejects.toMatchObject({ status: 409 });
    vi.stubEnv("DEMO_RECIPIENT_EMAIL", "buyer@example.com");
    await expect(approveCampaign(s.draft, text)).rejects.toMatchObject({ status: 503 });
    await expect(processCampaignQueue()).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("deduplicates campaigns across separate searches", async () => {
    const a = await seed(); await approveCampaign(a.draft, text);
    const b = await seed("approved", a.company);
    await expect(approveCampaign(b.draft, text)).rejects.toMatchObject({ status: 409 });
  });
  it("a concurrent worker sends once, only to the test inbox, and records provider acceptance", async () => {
    const s = await seed(); const c = await approveCampaign(s.draft, text); accept();
    const results = await Promise.all([processCampaignQueue(), processCampaignQueue()]);
    expect(results.filter(r => r.processed)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.to).toEqual(["deeptendukuri@gmail.com"]);
    expect(payload.cc).toBeUndefined(); expect(payload.bcc).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBe(`demo-draft-${s.draft}`);
    expect(await state(c.id)).toMatchObject({ status: "accepted", provider_message_id: "provider-unit-id" });
    expect(await processCampaignQueue()).toEqual({ processed: false });
    expect((await listCampaigns())[0]).not.toHaveProperty("lease_token");
  });
  it("can pause, resume and cancel only an unattempted campaign", async () => {
    const s = await seed(); const c = await approveCampaign(s.draft, text);
    await controlCampaign(c.id, "pause"); expect(await processCampaignQueue()).toEqual({ processed: false });
    await controlCampaign(c.id, "resume"); await controlCampaign(c.id, "cancel");
    expect(await processCampaignQueue()).toEqual({ processed: false });
    await expect(controlCampaign(c.id, "resume")).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("revoked fit prevents queued delivery", async () => {
    const s = await seed(); const c = await approveCampaign(s.draft, text);
    await db.query("update search_opportunities set qualification = 'rejected' where id=$1", [s.opportunity]);
    expect(await processCampaignQueue()).toMatchObject({ status: "review" });
    expect((await state(c.id)).last_error).toContain("buyer-fit"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("bounds uncertain provider retries and prevents cancelling duplicate protection", async () => {
    const s = await seed(); const c = await approveCampaign(s.draft, text);
    fetchMock.mockRejectedValue(new Error("network timeout"));
    for (let i = 0; i < 3; i++) {
      await db.query("update demo_campaigns set next_attempt_at=now() where id=$1", [c.id]);
      await processCampaignQueue();
      if (i === 0) await expect(controlCampaign(c.id, "cancel")).rejects.toMatchObject({ status: 409 });
    }
    expect(fetchMock).toHaveBeenCalledTimes(3); expect((await state(c.id)).status).toBe("review");
    expect(await processCampaignQueue()).toEqual({ processed: false });
  });
  it("recovers expired leases with the same provider key and does not retry outside 23 hours", async () => {
    const s = await seed(); const c = await approveCampaign(s.draft, text); accept();
    await db.query("update demo_campaigns set status='sending', lease_token=gen_random_uuid(),locked_until=now()-interval '1 minute' where id=$1", [c.id]);
    expect(await processCampaignQueue()).toMatchObject({ status: "accepted" });
    const other = await seed(); const stale = await approveCampaign(other.draft, text);
    await db.query("update outreach_drafts set delivery_first_attempt_at=now()-interval '24 hours',delivery_recipient=$2,delivery_from=$3 where id=$1", [other.draft,"deeptendukuri@gmail.com","Demo <onboarding@resend.dev>"]);
    expect(await processCampaignQueue()).toMatchObject({ status: "review" });
    expect((await state(stale.id)).last_error).toContain("expired"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("worker rejects missing, short and wrong tokens, and accepts the server-only secret", async () => {
    expect(workerAuthorized(null)).toBe(false); expect(workerAuthorized("Bearer wrong")).toBe(false);
    expect((await workerPost(new Request("http://localhost/api/mvp/outreach/worker", { method: "POST" }))).status).toBe(401);
    expect((await workerPost(new Request("http://localhost/api/mvp/outreach/worker", { method: "POST", headers: { authorization: `Bearer ${"a".repeat(40)}` } }))).status).toBe(200);
    vi.stubEnv("OUTREACH_WORKER_SECRET", "short"); expect(workerAuthorized("Bearer short")).toBe(false);
  });
  it("approval API rejects browser-provided recipient/schedules and cross-origin mutations", async () => {
    const s = await seed();
    const req = (body: object, origin = "http://localhost") => new Request("http://localhost/api/mvp/outreach/campaigns", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
    expect((await approvePost(req({ draftId: s.draft, ...text, recipient: "buyer@example.com" }))).status).toBe(400);
    expect((await approvePost(req({ draftId: s.draft, ...text, followUp: true }))).status).toBe(400);
    expect((await approvePost(req({ draftId: s.draft, ...text }, "https://evil.example"))).status).toBe(403);
    expect((await approvePost(req({ draftId: s.draft, ...text }))).status).toBe(200);
  });
});
