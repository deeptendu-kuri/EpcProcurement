import type { ChecklistItem, OutreachRule } from "@/mvp/types";

/**
 * Bid / supply compliance checklist for a lead (docs/mvp/08 §2): seed rules for the lead's market
 * (project country, or buyer country for supply leads) compared with the client profile
 * (certifications, registrations, local content). Each item is met / missing / unknown / not_applicable.
 * A missing hard item sets sub-criterion 4.1 to 0.
 */
export async function bidChecklist(leadId: string): Promise<ChecklistItem[]> {
  void leadId;
  return [];
}

/**
 * Outreach rules for a contact's country (docs/mvp/08 §3): whether email and phone are allowed,
 * opt-out-only, consent-needed or blocked, with the steps to follow and the source.
 * Unknown countries return the most cautious rule (`consent_needed`).
 *
 * @param countryCode ISO 3166-1 alpha-2, e.g. "IN", "SA", "NO".
 */
export function outreachRules(countryCode: string): OutreachRule {
  return {
    country: countryCode.toUpperCase(),
    email: "consent_needed",
    phone: "consent_needed",
    steps: ["Outreach rules not implemented yet."],
    sourceUrl: "",
  };
}
