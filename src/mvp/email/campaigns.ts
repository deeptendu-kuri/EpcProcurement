import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { getDb } from "@/mvp/db";
import type { OutreachDraftRow } from "@/mvp/types";
import { demoEmailSettings } from "./config";
import { DemoSendError, sendDemoEmail } from "./send";

export const AUTOMATION_RECIPIENT = "deeptendukuri@gmail.com";
export type CampaignStatus = "queued" | "sending" | "accepted" | "paused" | "cancelled" | "review";
export interface Campaign {
  id: string; draft_id: string; opportunity_id: string; recipient: string;
  status: CampaignStatus; attempts: number; next_attempt_at: string; locked_until: string | null;
  lease_token: string | null; last_error: string | null; provider_message_id: string | null;
  created_at: string; updated_at: string;
}
export interface CampaignView extends Omit<Campaign, "lease_token"> {
  name: string; keyword: string; product_name: string; run_id: string; subject: string;
}
export function automationSettings() {
  const settings = demoEmailSettings();
  if (settings.recipient !== AUTOMATION_RECIPIENT)
    throw new DemoSendError(503, `Automation is locked to ${AUTOMATION_RECIPIENT}. No buyer delivery is enabled.`);
  return settings;
}

/** Approval freezes the text. No address, follow-up schedule or scraped contact email is accepted. */
export async function approveCampaign(draftId: string, text: { subject: string; body: string }): Promise<Campaign> {
  const settings = automationSettings();
  return getDb().tx(async tx => {
    await tx.query("select pg_advisory_xact_lock(78240321)");
    const draft = (await tx.query<OutreachDraftRow & { opportunity_id: string | null }>(
      "select * from outreach_drafts where id = $1 for update", [draftId])).rows[0];
    if (!draft) throw new DemoSendError(404, "Draft not found.");
    const existing = (await tx.query<Campaign>("select * from demo_campaigns where draft_id = $1", [draftId])).rows[0];
    if (existing) {
      if (draft.subject !== text.subject || draft.body !== text.body) throw new DemoSendError(409, "Approved campaign text is locked. Cancel an unsent campaign before writing another draft.");
      return existing;
    }
    if (draft.blocked_reason) throw new DemoSendError(409, draft.blocked_reason);
    if (!draft.opportunity_id) throw new DemoSendError(409, "Open a product-scoped lead before approving automation.");
    if (draft.delivery_first_attempt_at || draft.status === "sent_externally") throw new DemoSendError(409, "This draft already has a delivery attempt. Review it rather than approving a new campaign.");
    const opportunity = (await tx.query<{ qualification: string; company_id: string; product_id: string; lead_id: string }>(
      "select qualification, company_id, product_id, lead_id from search_opportunities where id = $1 for share", [draft.opportunity_id])).rows[0];
    if (opportunity?.qualification !== "approved" || opportunity.lead_id !== draft.lead_id)
      throw new DemoSendError(409, "Review and approve this product's buyer fit first.");
    const contactKey = draft.person_id ?? "company";
    const duplicate = await tx.query("select id from demo_campaigns where company_id = $1 and product_id = $2 and contact_key = $3 and status <> 'cancelled'", [opportunity.company_id, opportunity.product_id, contactKey]);
    if (duplicate.rows.length) throw new DemoSendError(409, "An approved campaign already exists for this company, product and contact. Check Outreach.");
    await tx.query("update outreach_drafts set subject = $2, body = $3, updated_at = now() where id = $1", [draftId, text.subject, text.body]);
    const campaign = (await tx.query<Campaign>(
      `insert into demo_campaigns (draft_id, opportunity_id, company_id, product_id, contact_key, recipient)
       values ($1,$2,$3,$4,$5,$6) returning *`, [draftId, draft.opportunity_id, opportunity.company_id, opportunity.product_id, contactKey, settings.recipient])).rows[0];
    await tx.query("insert into opportunity_events (opportunity_id, body) values ($1,$2)", [draft.opportunity_id, `Approved one demo email to ${settings.recipient}; queued for automatic delivery. Follow-ups are off.`]);
    return campaign;
  });
}

export async function listCampaigns(): Promise<CampaignView[]> {
  // Explicit fields: do not expose lease tokens to browsers.
  return (await getDb().query<CampaignView>(`select c.id, c.draft_id, c.opportunity_id, c.recipient, c.status, c.attempts,
    c.next_attempt_at, c.locked_until, c.last_error, c.provider_message_id, c.created_at, c.updated_at,
    b.canonical_name as name, o.keyword, o.product_name, o.run_id, d.subject
    from demo_campaigns c join search_opportunities o on o.id = c.opportunity_id
    join companies b on b.id = c.company_id join outreach_drafts d on d.id = c.draft_id
    order by c.created_at desc limit 200`)).rows;
}

export async function controlCampaign(id: string, action: "pause" | "resume" | "cancel") {
  return getDb().tx(async tx => {
    const c = (await tx.query<Campaign>("select * from demo_campaigns where id = $1 for update", [id])).rows[0];
    if (!c) throw new DemoSendError(404, "Campaign not found.");
    if (c.status === "sending" || c.status === "accepted" || c.status === "review")
      throw new DemoSendError(409, "Delivery is in progress, accepted or needs review; it cannot safely be cancelled or restarted.");
    const status = action === "pause" ? "paused" : action === "resume" ? "queued" : "cancelled";
    if (c.status === status) return;
    if (c.status === "cancelled" || (action === "resume" && c.status !== "paused")) throw new DemoSendError(409, "This campaign cannot be restarted.");
    // A failed HTTP response can be uncertain acceptance. Never release the deduplication key then.
    if (action === "cancel" && c.attempts > 0) throw new DemoSendError(409, "An attempted email needs review. Pause it instead of cancelling its duplicate protection.");
    await tx.query("update demo_campaigns set status = $2, updated_at = now() where id = $1", [id, status]);
    await tx.query("insert into opportunity_events (opportunity_id, body) values ($1,$2)", [c.opportunity_id, `Demo campaign ${status}.`]);
  });
}

/** One atomic claim per invocation. Provider I/O is outside the transaction. */
export async function processCampaignQueue(): Promise<{ processed: boolean; campaignId?: string; status?: CampaignStatus }> {
  automationSettings(); // Configuration changes fail closed before claiming any job.
  const db = getDb();
  const job = await db.tx(async tx => {
    const c = (await tx.query<Campaign>(`select * from demo_campaigns
      where (status = 'queued' and next_attempt_at <= now()) or (status = 'sending' and locked_until <= now())
      order by next_attempt_at for update skip locked limit 1`)).rows[0];
    if (!c) return null;
    const lease = randomUUID();
    return (await tx.query<Campaign>(`update demo_campaigns set status = 'sending', attempts = attempts + 1,
      lease_token = $2, locked_until = now() + interval '2 minutes', updated_at = now() where id = $1 returning *`, [c.id, lease])).rows[0];
  });
  if (!job) return { processed: false };
  let status: CampaignStatus = "accepted";
  let error: string | null = null;
  let messageId: string | null = null;
  try {
    const draft = (await db.query<OutreachDraftRow>("select * from outreach_drafts where id = $1", [job.draft_id])).rows[0];
    if (!draft) throw new DemoSendError(409, "Approved draft is unavailable; manual review is required.");
    const result = await sendDemoEmail(job.draft_id, { subject: draft.subject ?? "", body: draft.body ?? "" }, { id: job.id, leaseToken: job.lease_token! });
    messageId = result.messageId;
  } catch (cause) {
    error = cause instanceof DemoSendError ? cause.message : "Delivery could not be confirmed. Review this campaign before resending.";
    // Only bounded retries of identical content/key within the provider's protection window.
    status = cause instanceof DemoSendError && cause.status >= 500 && job.attempts < 3 ? "queued" : "review";
  }
  await db.tx(async tx => {
    const updated = await tx.query(`update demo_campaigns set status = $3, last_error = $4,
      provider_message_id = coalesce($5, provider_message_id), next_attempt_at = now() + ($6 * interval '1 second'),
      lease_token = null, locked_until = null, updated_at = now() where id = $1 and lease_token = $2 returning opportunity_id`,
      [job.id, job.lease_token, status, error, messageId, Math.min(900, 60 * 2 ** (job.attempts - 1))]);
    if (updated.rows.length) await tx.query("insert into opportunity_events (opportunity_id, body) values ($1,$2)", [job.opportunity_id,
      status === "accepted" ? `Email provider accepted demo email to ${job.recipient} (provider ${messageId}). Inbox delivery is not yet verified.` : `Demo campaign ${status}: ${error}`]);
  });
  return { processed: true, campaignId: job.id, status };
}

export function workerAuthorized(authorization: string | null): boolean {
  const secret = process.env.OUTREACH_WORKER_SECRET?.trim() ?? "";
  if (secret.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(secret), digest(authorization.slice(7)));
}
