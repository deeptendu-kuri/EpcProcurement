import { getDb } from "@/mvp/db";
import type { OutreachDraftRow } from "@/mvp/types";
import { demoEmailSettings } from "./config";

export class DemoSendError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface DemoSendResult {
  messageId: string;
  recipient: string;
  alreadySent: boolean;
}

/** No recipient argument exists: all delivery is locked to the server-configured inbox. */
export async function sendDemoEmail(id: string, text: { subject: string; body: string }): Promise<DemoSendResult> {
  let settings: ReturnType<typeof demoEmailSettings>;
  try { settings = demoEmailSettings(); }
  catch (error) { throw new DemoSendError(503, error instanceof Error ? error.message : "Demo sending is not configured."); }
  const db = getDb();
  const draft = await db.tx(async (tx) => {
    // Serialise claims across drafts too, to enforce the small demo quota.
    await tx.query("select pg_advisory_xact_lock(78240321)");
    const current = (await tx.query<OutreachDraftRow>("select * from outreach_drafts where id = $1 for update", [id])).rows[0];
    if (!current) throw new DemoSendError(404, "Draft not found.");
    if (current.blocked_reason) throw new DemoSendError(409, current.blocked_reason);
    if (current.delivery_state === "sent" && current.provider_message_id) return current;
    if (current.status === "sent_externally") throw new DemoSendError(409, "This draft was already marked as sent. Write a new draft for a demo delivery.");
    if (current.delivery_first_attempt_at) {
      if (Date.now() - Date.parse(current.delivery_first_attempt_at) >= 23 * 60 * 60 * 1000)
        throw new DemoSendError(409, "This delivery needs manual review before retrying; its duplicate-protection window has expired.");
      if (current.subject !== text.subject || current.body !== text.body || current.delivery_recipient !== settings.recipient || current.delivery_from !== settings.from)
        throw new DemoSendError(409, "Do not change a previously attempted email. Retry the same message, or write a new draft after checking the previous delivery.");
    }
    if (current.delivery_state === "sending" && current.delivery_attempted_at && Date.now() - Date.parse(current.delivery_attempted_at) < 60_000)
      throw new DemoSendError(409, "This email is already being sent. Wait a moment before retrying.");
    const quota = (await tx.query<{ count: number | string }>(
      "select count(*) as count from outreach_drafts where delivery_first_attempt_at >= date_trunc('day', now())",
    )).rows[0];
    if (!current.delivery_first_attempt_at && Number(quota.count) >= 50) throw new DemoSendError(429, "The demo limit of 50 email deliveries per day has been reached.");
    return (await tx.query<OutreachDraftRow>(
      `update outreach_drafts set subject = $2, body = $3, delivery_state = 'sending',
       delivery_recipient = $4, delivery_from = $5, delivery_error = null,
       delivery_first_attempt_at = coalesce(delivery_first_attempt_at, now()), delivery_attempted_at = now(), updated_at = now()
       where id = $1 returning *`, [id, text.subject, text.body, settings.recipient, settings.from],
    )).rows[0];
  });
  if (draft.delivery_state === "sent" && draft.provider_message_id)
    return { messageId: draft.provider_message_id, recipient: draft.delivery_recipient!, alreadySent: true };

  let messageId: string;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json", "Idempotency-Key": `demo-draft-${id}` },
      // No CC, BCC, scraped address, or browser-provided recipient is used.
      body: JSON.stringify({ from: settings.from, to: [settings.recipient], subject: `[Demo] ${draft.subject}`, text: draft.body }),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => ({})) as { id?: unknown };
    if (!response.ok || typeof result.id !== "string" || !result.id)
      throw new DemoSendError(502, `Email provider did not accept the message (HTTP ${response.status}). Check the sender, API key, recipient restrictions and quota, then retry the same draft.`);
    messageId = result.id;
  } catch (error) {
    const message = error instanceof DemoSendError ? error.message : "Email delivery could not be confirmed. Retry this same draft to avoid duplicate delivery.";
    await db.query("update outreach_drafts set delivery_state = 'failed', delivery_error = $2, updated_at = now() where id = $1 and delivery_state = 'sending'", [id, message]);
    throw new DemoSendError(502, message);
  }

  // The provider's idempotency key protects retries if acceptance succeeds but this transaction fails.
  await db.tx(async (tx) => {
    const updated = await tx.query(
      `update outreach_drafts set delivery_state = 'sent', provider_message_id = $2, delivery_sent_at = now(),
       delivery_error = null, status = 'sent_externally', updated_at = now()
       where id = $1 and delivery_state <> 'sent' returning id`, [id, messageId],
    );
    if (updated.rows.length) await tx.query(
      "insert into activities (lead_id, person_id, type, body) values ($1, $2, 'email_sent', $3)",
      [draft.lead_id, draft.person_id, `Demo email sent to test inbox ${settings.recipient}: ${draft.subject} (provider ${messageId})`],
    );
  });
  return { messageId, recipient: settings.recipient, alreadySent: false };
}
