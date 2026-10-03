export type Journey = { stage: string; action: string; step: number };
/** Verified role holders are not necessarily verified email addresses. Never conflate the two. */
export function verifiedProspect(qualification: string, validatedEmails: number, sample: boolean): boolean {
  return qualification === "approved" && validatedEmails > 0 && !sample;
}
export function journey(qualification: string, validatedEmails: number, sent: boolean, sample = false): Journey {
  if (qualification === "rejected") return { stage: "Not relevant", action: "Review qualification", step: 0 };
  if (qualification !== "approved") return { stage: "Review buyer fit", action: "Review buyer fit", step: 0 };
  if (sent) return { stage: "Demo email sent", action: "Review conversation", step: 3 };
  if (!validatedEmails || sample) return { stage: "Contact validation needed", action: "Find and validate contact", step: 1 };
  return { stage: "Ready for outreach", action: "Review email", step: 2 };
}
export const CONTACT_ROLES = [
  { id: "buyer", name: "Purchase / Procurement Manager" },
  { id: "decision_maker", name: "CEO / Managing Director" },
  { id: "approver", name: "Director / Approver" },
  { id: "technical_approver", name: "Technical / Engineering Manager" },
  { id: "influencer", name: "Project Manager" },
  { id: "vendor_registration", name: "Vendor Registration" },
];
