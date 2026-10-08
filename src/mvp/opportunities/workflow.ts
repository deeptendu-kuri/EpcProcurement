export type Journey = { stage: string; action: string; step: number };
/** Verified role holders are not necessarily verified email addresses. Never conflate the two. */
export function verifiedProspect(qualification: string, validatedEmails: number, sample: boolean): boolean {
  return qualification === "approved" && validatedEmails > 0 && !sample;
}
export function journey(qualification: string, validatedEmails: number, sent: boolean, sample = false): Journey {
  if (qualification === "rejected") return { stage: "Not relevant", action: "Review qualification", step: 0 };
  if (qualification !== "approved") return { stage: "Review buyer fit", action: "Review buyer fit", step: 0 };
  if (sent) return { stage: "Demo email sent", action: "Review conversation", step: 3 };
  if (!validatedEmails || sample) return { stage: "Potential company · contacts optional", action: "View contacts & enrichment", step: 1 };
  return { stage: "Validated contact ready", action: "View automation", step: 2 };
}
export const CONTACT_ROLES = [
  { id: "buyer", name: "Purchase / Procurement Manager" },
  { id: "decision_maker", name: "CEO / Managing Director" },
  { id: "approver", name: "Director / Approver" },
  { id: "technical_approver", name: "Technical / Engineering Manager" },
  { id: "influencer", name: "Project Manager" },
  { id: "vendor_registration", name: "Vendor Registration" },
];

export type ActivityStatus = "recent" | "ongoing" | "capability_only" | "historic" | "unknown";
export function activityLabel(status?: ActivityStatus): string {
  return status === "ongoing" ? "Ongoing work documented" : status === "recent" ? "Recent activity documented"
    : status === "capability_only" ? "Relevant capabilities · current work unconfirmed"
      : status === "historic" ? "Historical work · current work unconfirmed" : "Current activity not established";
}
export function activityGroup(status?: ActivityStatus): "active" | "capability" | "historic" {
  return status === "recent" || status === "ongoing" ? "active" : status === "historic" ? "historic" : "capability";
}
export const ACTIVITY_GROUPS = [
  { id: "active", label: "Recent or ongoing work", explanation: "Dated or explicitly ongoing work is supported. A current material order is still unconfirmed." },
  { id: "capability", label: "Relevant companies · current work unconfirmed", explanation: "Useful potential customers with grounded material fit; no current work date is established." },
  { id: "historic", label: "Historical work", explanation: "Previously documented work; confirm current activity before prioritising outreach." },
] as const;
export function availableRoleMatches(role: string, available: string[] = []): boolean {
  const mapping: Record<string, string[]> = { buyer: ["procurement_lead", "package_manager"], decision_maker: ["decision_maker", "executive"],
    approver: ["decision_maker", "project_director"], technical_approver: ["technical_evaluator", "discipline_lead"], influencer: ["project_director", "package_manager"], vendor_registration: ["vendor_registration"] };
  return !role || available.some(value => (mapping[role] ?? [role]).includes(value));
}
/** Display one published value; the database retains all original source quotes. */
export function uniquePublishedContacts<T extends {kind: "phone"|"email";value:string}>(contacts: T[]): T[] {
  const seen=new Set<string>();
  return contacts.filter(contact=>{
    const normalized=contact.kind==='phone'?contact.value.replace(/[^\d]/g,''):contact.value.trim().toLowerCase();
    const key=`${contact.kind}:${normalized || contact.value}`;
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}
