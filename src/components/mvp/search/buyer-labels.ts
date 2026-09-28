/**
 * Words and colours for buyers (docs/mvp/14 §1). Never show "supplier", "bid" or "supply/subcontract":
 * a company that won a supply order is a Manufacturer, Distributor or Fabricator.
 */
import { BUYER_ROLE_LABELS, BUYER_STAGE_LABELS, type BuyerRole, type BuyerSignal, type BuyerStage, type ChainCompany, type FitLevel, type SlotRole } from "@/mvp/buyers/types";
import { marketName } from "@/mvp/config/markets";

export { BUYER_ROLE_LABELS, BUYER_STAGE_LABELS };

/** Pill colours per role, as in the mockup. */
export const ROLE_STYLES: Record<BuyerRole, string> = {
  manufacturer: "bg-[#fdf2f8] text-[#be185d]",
  epc_contractor: "bg-[#ecfdf5] text-[#047857]",
  subcontractor: "bg-[#fff7ed] text-[#c2410c]",
  owner: "bg-[#f1f5f9] text-[#475569]",
  distributor: "bg-[#f0f9ff] text-[#0369a1]",
  fabricator: "bg-[#faf5ff] text-[#7e22ce]",
};
export const TENDER_STYLE = "bg-[#eef2ff] text-[#4338ca]";

/** Short tags for "Other buyers on this project". */
export const CHAIN_ROLE_TAGS: Record<ChainCompany["role"], { label: string; style: string }> = {
  owner: { label: "Owner", style: ROLE_STYLES.owner },
  epc_contractor: { label: "EPC", style: ROLE_STYLES.epc_contractor },
  subcontractor: { label: "Sub", style: ROLE_STYLES.subcontractor },
  manufacturer: { label: "Maker", style: ROLE_STYLES.manufacturer },
  fabricator: { label: "Fabricator", style: ROLE_STYLES.fabricator },
  distributor: { label: "Stockist", style: ROLE_STYLES.distributor },
  pmc: { label: "PMC", style: "bg-[#f5f3ff] text-[#6d28d9]" },
  parent_group: { label: "Group", style: ROLE_STYLES.manufacturer },
};

export const STAGE_STYLES: Record<BuyerStage, string> = {
  ready: "bg-[#ecfdf3] text-[#067647]",
  check: "bg-[#fffaeb] text-[#b54708]",
  early: "bg-[#eff8ff] text-[#175cd3]",
  not_buyer: "bg-[#f2f4f7] text-[#475467]",
};

export const HOW_SURE_LABELS: Record<"high" | "medium" | "low", string> = { high: "High", medium: "Medium", low: "Low" };
export const HOW_SURE_STYLES: Record<"high" | "medium" | "low", string> = {
  high: "text-[#047857]",
  medium: "text-[#b45309]",
  low: "text-[#6b7280]",
};

export const SIGNAL_LABELS: Record<BuyerSignal, string> = {
  order_won: "Won an order",
  contract_won: "Won a contract",
  tender_open: "Open tender",
  expansion: "Expansion",
};

export const SLOT_ROLE_LABELS: Record<SlotRole, string> = {
  decision_maker: "Decision maker",
  buyer: "Buyer",
  technical_approver: "Technical approver",
  influencer: "Influencer",
  approver: "Approver",
  vendor_registration: "Vendor registration",
};

/** Departments of the buying-team slots (src/mvp/buyers/team.ts). */
export const DEPARTMENTS = ["Procurement", "Projects", "QA/QC", "Operations", "Management", "Vendor registration"];

/** Sector codes the buyers API filters on, with their labels. */
export const INDUSTRIES: { value: string; label: string }[] = [
  { value: "oil_gas", label: "Oil & gas" },
  { value: "petrochemical", label: "Refining & petrochemicals" },
  { value: "power", label: "Power" },
  { value: "water", label: "Water" },
  { value: "infrastructure", label: "Infrastructure" },
  { value: "mining", label: "Mining" },
];

export const REACH_LABELS: Record<"allowed" | "opt_out_only" | "consent_needed" | "blocked", string> = {
  allowed: "Cold email allowed",
  opt_out_only: "Email with opt-out",
  consent_needed: "Consent needed first",
  blocked: "Do not email",
};

export const FIT_LABELS: Record<FitLevel, string> = { good: "Good fit", possible: "Possible", competitor: "Competitor — they make it" };
export const FIT_STYLES: Record<FitLevel, string> = { good: "text-[#047857]", possible: "text-[#b45309]", competitor: "text-[#b91c1c]" };

export const SLOT_STATUS_LABELS = { not_found: "Not found", likely: "Likely", confirmed: "Confirmed" } as const;

/** "Project owner · open tender" for an open tender run by the owner (doc 14 §1). */
export function roleText(role: BuyerRole, roleLabel: string | null | undefined, tenderOpen = false): string {
  const base = roleLabel?.trim() || BUYER_ROLE_LABELS[role];
  if (tenderOpen && role === "owner" && !/tender/i.test(base)) return `${base} · open tender`;
  return base;
}

export function isTenderLabel(label: string): boolean {
  return /open tender/i.test(label);
}

/** Country code or name → display name. */
export function countryName(value: string | null | undefined): string {
  if (!value) return "Not known";
  return value.length <= 3 ? marketName(value) : value;
}

/** "EP" from "East Pipes (EPIC)". */
export function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, " ").split(/[\s\-–&]+/).filter((word) => /^[A-Za-z0-9]/.test(word));
  const letters = words.slice(0, 2).map((word) => word[0]!.toUpperCase());
  return letters.join("") || name.slice(0, 2).toUpperCase();
}

const AVATAR_COLOURS = ["#0f766e", "#1d4ed8", "#0369a1", "#b45309", "#475569", "#4338ca", "#be185d", "#047857", "#7c3aed"];

/** Stable avatar colour per name. */
export function avatarColour(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

const MONTH_FMT = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const DAY_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function toDate(value: string): Date | null {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Oct – Nov 2026", "Nov 2026 – Jan 2027", "~Mar 2027", "22 Sep 2026". */
export function windowText(from: string | null, to: string | null): string {
  const a = from ? toDate(from) : null;
  const b = to ? toDate(to) : null;
  if (a && b) {
    if (a.getTime() === b.getTime()) return DAY_FMT.format(a);
    const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
    const left = sameYear ? new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(a) : MONTH_FMT.format(a);
    return `${left} – ${MONTH_FMT.format(b)}`;
  }
  if (a) return DAY_FMT.format(a);
  if (b) return `~${MONTH_FMT.format(b)}`;
  return "";
}
