/**
 * Plain-word labels and formatters for the slice UI (docs/mvp/09 §2 vocabulary).
 * Never show internal terms ("gate", "play", "verdict", "client-safe", "match score").
 */
import type {
  ActivityType,
  BuyerType,
  BuyingRole,
  CheckStatus,
  ConfidenceBand,
  Discipline,
  LeadClass,
  LeadKind,
  LeadStatus,
  OutreachPermission,
  PartyRole,
  ProjectStage,
  RejectReason,
  SourceTier,
} from "@/mvp/types";

export const CLASS_LABELS: Record<LeadClass, string> = {
  genuine: "Ready to approach",
  research: "Check first",
  watch: "Early — keep an eye",
  rejected: "Not a buyer",
};
export const CLASS_ORDER: LeadClass[] = ["genuine", "research", "watch", "rejected"];

/** Internal kinds are not shown as such (14 §1); where a kind must be named, use these plain words. */
export const KIND_LABELS: Record<LeadKind, string> = { bid: "Open tender", supply_subcontract: "Won work" };
export const KIND_SHORT: Record<LeadKind, string> = { bid: "Open tender", supply_subcontract: "Won work" };

export const BAND_LABELS: Record<ConfidenceBand, string> = { high: "High", medium: "Medium", low: "Low" };

/** Who the lead is about (13 §11). */
export const BUYER_TYPE_LABELS: Record<BuyerType, string> = {
  epc_contractor: "EPC contractor",
  subcontractor: "Subcontractor",
  supplier: "Manufacturer", // never "supplier" (14 §1)
  owner: "Project owner",
  manufacturer: "Manufacturer",
  fabricator: "Fabricator",
  distributor: "Distributor",
};
export const BUYER_TYPE_HINTS: Record<BuyerType, string> = {
  epc_contractor: "Won the main contract: buys materials and subcontracts packages",
  subcontractor: "Won a subcontract: buys materials for its package",
  supplier: "Won an order: buys materials and services to make and deliver it",
  owner: "Owns the project or runs the tender",
  manufacturer: "Makes products (e.g. pipe mill, valve maker): buys raw materials and consumables",
  fabricator: "Fabricator / spool shop: buys pipe, fittings, flanges and consumables",
  distributor: "Distributor / stockist: buys stock for resale",
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  accepted: "Good lead",
  rejected: "Not relevant",
  contacted: "Contacted",
  rfq: "RFQ received",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  wrong_company: "Wrong company",
  not_our_scope: "Not our scope",
  too_late: "Too late",
  too_small: "Too small",
  already_known: "Already known",
  other: "Other",
};

export function rejectReasonLabel(value: string | null | undefined): string {
  if (!value) return "";
  return REJECT_REASON_LABELS[value as RejectReason] ?? value;
}

/** Main path of the stage timeline, in order. on_hold / cancelled / completed are shown as flags. */
export const STAGE_PATH: ProjectStage[] = [
  "concept", "feasibility", "feed", "prequalification", "epc_tender", "awarded",
  "detailed_engineering", "procurement", "construction", "commissioning", "operations",
];

export const STAGE_LABELS: Record<ProjectStage, string> = {
  concept: "Concept",
  feasibility: "Feasibility",
  feed: "FEED",
  prequalification: "Prequalification",
  epc_tender: "Tender",
  awarded: "Awarded",
  detailed_engineering: "Engineering",
  procurement: "Procurement",
  construction: "Construction",
  commissioning: "Commissioning",
  operations: "Operating",
  on_hold: "On hold",
  cancelled: "Cancelled",
  completed: "Completed",
};

const DISCIPLINE_OVERRIDES: Partial<Record<Discipline, string>> = {
  civil_structural: "Civil & structural",
  instrumentation_control: "Instrumentation & control",
  hvac: "HVAC",
  insulation_painting: "Insulation & painting",
  logistics_heavy_lift: "Logistics & heavy lift",
};

export function disciplineLabel(value: string | null | undefined): string {
  if (!value) return "Not found";
  const override = DISCIPLINE_OVERRIDES[value as Discipline];
  if (override) return override;
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const PARTY_ROLE_LABELS: Record<PartyRole, string> = {
  owner: "Owner",
  pmc: "Project management consultant",
  consultant: "Consultant",
  main_epc: "Main EPC contractor",
  consortium_member: "Consortium partner",
  subcontractor: "Subcontractor",
  supplier: "Manufacturer / distributor",
  logistics: "Logistics",
  financier: "Financier",
};

export const BUYING_ROLE_LABELS: Record<BuyingRole, string> = {
  decision_maker: "Decision maker",
  project_director: "Project director",
  procurement_lead: "Procurement lead",
  package_manager: "Package manager",
  technical_evaluator: "Technical evaluator",
  discipline_lead: "Discipline lead",
  expediting: "Expediting",
  logistics_coordinator: "Logistics coordinator",
  tender_contact: "Tender contact",
  executive: "Executive",
  other: "Other",
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  note: "Note",
  status_change: "Status changed",
  email_draft: "Email drafted",
  email_sent: "Email sent",
  call: "Call",
  meeting: "Meeting",
};

export const CHECK_LABELS: Record<CheckStatus, string> = {
  met: "Met",
  missing: "Missing",
  unknown: "Unknown",
  not_applicable: "Not applicable",
};

export const PERMISSION_LABELS: Record<OutreachPermission, string> = {
  allowed: "allowed",
  opt_out_only: "allowed with opt-out",
  consent_needed: "consent needed first",
  blocked: "not allowed",
};

export const TIER_LABELS: Record<SourceTier, string> = {
  A: "Official source (tier A)",
  B: "Trade press (tier B)",
  C: "Other source (tier C)",
};

/** Plain-word titles for failed checks (07 §3). Shown on rejected leads. */
export const FAILED_CHECK_TITLES: Record<string, string> = {
  G1: "We could not confirm this is a real, active company",
  G2: "The work is outside what you offer",
  G3: "The project is outside your markets",
  G4: "The opportunity is no longer open",
  G5: "Only one weak source reports it",
  G6: "Key facts could not be checked against their sources",
  G7: "Possible sanctions match",
  G8: "The company is on your exclusion list",
};

/** Short names for the 5 score criteria in the summary line. */
export const CRITERION_SHORT: Record<string, string> = {
  C1: "Scope",
  C2: "Timing",
  C3: "Buyer",
  C4: "Access",
  C5: "Commercial",
};

/** Map a status-change activity body ("new → accepted (too_small)") into plain words. */
export function describeStatusChange(body: string | null): string {
  if (!body) return "";
  const match = body.match(/^(\w+)\s*→\s*(\w+)(?:\s*\((\w+)\))?$/);
  if (!match) return body;
  const [, from, to, reason] = match;
  const label = (value: string) => STATUS_LABELS[value as LeadStatus] ?? value;
  return `${label(from)} → ${label(to)}${reason ? ` (${rejectReasonLabel(reason)})` : ""}`;
}

// ───────────────────────── formatting ─────────────────────────

const DATE_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DATETIME_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});

/** "12 Sep 2026" (UTC). Accepts "YYYY-MM-DD" or ISO strings. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : DATE_FMT.format(date);
}

const SHORT_DATE_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "15 Oct" in the current year, "15 Oct 2027" otherwise (for tight table cells). */
export function formatShortDate(value: string | null | undefined, now: number = Date.now()): string {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.getUTCFullYear() === new Date(now).getUTCFullYear() ? SHORT_DATE_FMT.format(date) : DATE_FMT.format(date);
}

/** "27 Sep, 10:05 UTC". */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${DATETIME_FMT.format(date)} UTC`;
}

/** "USD 120M", "INR 2.4B". */
export function formatMoney(value: number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const amount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return `${(currency || "USD").toUpperCase()} ${amount}`;
}

/** Render a requirement spec object as "grade X65 · od in 24". */
export function formatSpec(spec: Record<string, unknown> | null | undefined): string {
  if (!spec) return "";
  return Object.entries(spec)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => {
      const label = key === "od_in" ? "OD (in)" : key.replace(/_/g, " ");
      const text = Array.isArray(value) ? value.join("–") : typeof value === "object" ? JSON.stringify(value) : String(value);
      return `${label} ${text}`;
    })
    .join(" · ");
}
