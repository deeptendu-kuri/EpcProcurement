/**
 * Generate an outreach email draft for a lead (docs/mvp/06 §6.3, 08 §3, 12 §1 F4) with
 * getLLM('draft') (template via the mock in demo mode): subject + body ≤ 120 words + opt-out line where
 * the contact's country requires it. Stores a row in `outreach_drafts` and an 'email_draft' activity.
 *
 * When outreach for the contact's country is `consent_needed` or `blocked`, no text is generated:
 * the draft is stored with `blocked_reason` and returned with empty subject/body and `blockedReason`.
 *
 * @param personId the contact to write to, or null for a company-level draft.
 */
export async function generateDraft(
  leadId: string,
  personId: string | null,
): Promise<{ id: string; subject: string; body: string; blockedReason?: string }> {
  void leadId;
  void personId;
  throw new Error("not implemented");
}
