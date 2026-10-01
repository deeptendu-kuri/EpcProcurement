// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { updateDraft } from "@/mvp/repo";
import { demoEmailInfo } from "./config";
import { sendDemoEmail } from "./send";

let db: Db;
const fetchMock = vi.fn();
const text = { subject: "Procurement support", body: "Hello Buyer, could we discuss your requirements?" };
beforeAll(async () => { db = await createTestDb(); setDbForTests(db); }, 120_000);
afterAll(async () => { setDbForTests(undefined); await db?.close(); });
beforeEach(async () => {
  vi.stubEnv("DEMO_EMAIL_ENABLED", "1");
  vi.stubEnv("DEMO_RECIPIENT_EMAIL", "our-demo-inbox@example.com");
  vi.stubEnv("RESEND_API_KEY", "re_fake_test_key");
  vi.stubEnv("DEMO_EMAIL_FROM", "Demo <onboarding@resend.dev>");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  await db.exec("delete from outreach_drafts; delete from activities;");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function seed(blockedReason: string | null = null) {
  const buyer = (await db.query<{ id: string }>("insert into companies (canonical_name, normalized_name, country) values ('Demo Buyer', 'demo buyer', 'IN') returning id")).rows[0].id;
  const lead = (await db.query<{ id: string }>(
    "insert into leads (kind, buyer_company_id, score_breakdown, gate_results, class, reasons, scoring_version) values ('supply_subcontract', $1, '{}', '[]', 'research', '[]', 1) returning id", [buyer],
  )).rows[0].id;
  return (await db.query<{ id: string }>("insert into outreach_drafts (lead_id, subject, body, blocked_reason, demo_only) values ($1, $2, $3, $4, true) returning id", [lead, text.subject, text.body, blockedReason])).rows[0].id;
}
const accepted = (id = "provider-id-1") => new Response(JSON.stringify({ id }), { status: 200 });

describe("single-inbox demo email delivery", () => {
  it("returns only safe public configuration", () => {
    expect(demoEmailInfo()).toEqual({ enabled: true, ready: true, recipient: "our-demo-inbox@example.com", error: null });
    expect(JSON.stringify(demoEmailInfo())).not.toContain("re_fake_test_key");
  });
  it("fails closed without a provider key or when demo sending is off", async () => {
    const id = await seed();
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(sendDemoEmail(id, text)).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("RESEND_API_KEY", "re_fake"); vi.stubEnv("DEMO_EMAIL_ENABLED", "0");
    await expect(sendDemoEmail(id, text)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects multiple recipient addresses", async () => {
    vi.stubEnv("DEMO_RECIPIENT_EMAIL", "one@example.com,two@example.com");
    await expect(sendDemoEmail(await seed(), text)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends ONLY to the configured inbox and records acceptance once", async () => {
    const id = await seed(); fetchMock.mockResolvedValue(accepted());
    const result = await sendDemoEmail(id, text);
    expect(result).toEqual({ messageId: "provider-id-1", recipient: "our-demo-inbox@example.com", alreadySent: false });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toEqual({ from: "Demo <onboarding@resend.dev>", to: ["our-demo-inbox@example.com"], subject: "[Demo] Procurement support", text: text.body });
    const row = (await db.query("select * from outreach_drafts where id = $1", [id])).rows[0];
    expect(row).toMatchObject({ status: "sent_externally", delivery_state: "sent", provider_message_id: "provider-id-1" });
    const again = await sendDemoEmail(id, text);
    expect(again.alreadySent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await db.query("select * from activities where type = 'email_sent'")).rows).toHaveLength(1);
  });
  it("never shows sent on a provider failure; retries use the SAME idempotency key", async () => {
    const id = await seed();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 })).mockResolvedValueOnce(accepted());
    await expect(sendDemoEmail(id, text)).rejects.toMatchObject({ status: 502 });
    expect((await db.query("select status, delivery_state from outreach_drafts where id = $1", [id])).rows[0]).toMatchObject({ status: "draft", delivery_state: "failed" });
    expect((await db.query("select * from activities where type = 'email_sent'")).rows).toHaveLength(0);
    await sendDemoEmail(id, text);
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]);
  });
  it("rejects a second concurrent click and does not call the provider twice", async () => {
    const id = await seed();
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    const first = sendDemoEmail(id, text);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await expect(sendDemoEmail(id, text)).rejects.toMatchObject({ status: 409 });
    finish(accepted()); await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("freezes attempted content and blocks the legacy fake-sent action", async () => {
    const id = await seed();
    await expect(updateDraft(id, { status: "sent_externally" })).rejects.toThrow(/Use Send demo email/);
    fetchMock.mockRejectedValue(new Error("network timeout"));
    await expect(sendDemoEmail(id, text)).rejects.toMatchObject({ status: 502 });
    await expect(sendDemoEmail(id, { ...text, body: "Changed" })).rejects.toMatchObject({ status: 409 });
    await expect(updateDraft(id, { subject: "Changed" })).rejects.toThrow(/cannot be edited/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires manual review outside the provider duplicate-protection window", async () => {
    const id = await seed();
    await db.query("update outreach_drafts set delivery_first_attempt_at = now() - interval '25 hours' where id = $1", [id]);
    await expect(sendDemoEmail(id, text)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not send blocked drafts or claim a legacy marked-sent message again", async () => {
    await expect(sendDemoEmail(await seed("Sanctions match"), text)).rejects.toMatchObject({ status: 409 });
    const id = await seed(); await db.query("update outreach_drafts set status = 'sent_externally' where id = $1", [id]);
    await expect(sendDemoEmail(id, text)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
