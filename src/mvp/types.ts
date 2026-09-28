/**
 * Shared domain types for the showcase slice (docs/mvp/12 §5).
 *
 * - Enum-like unions mirror the `check` constraints in src/mvp/db/migrations/001_slice_schema.sql.
 * - `*Row` types mirror table columns exactly (snake_case), as returned by `getDb().query<T>()`:
 *   timestamptz -> ISO string, date -> "YYYY-MM-DD", numeric -> number, jsonb -> parsed value.
 * - View types used by the UI (camelCase) are built by src/mvp/repo.ts.
 *
 * The block marked CONTRACT must not change without updating docs/mvp/12-SHOWCASE-SLICE.md.
 */

// ═════════════════════════ CONTRACT (12 §5) ═════════════════════════

export type LeadKind = "bid" | "supply_subcontract";
export type LeadClass = "genuine" | "research" | "watch" | "rejected";

export interface RunInput {
  query: string;
  markets: string[];
  leadKinds: LeadKind[];
  /** Search the sample documents (fixtures) for this run only, whatever MVP_OFFLINE says ("Load sample leads"). */
  offline?: boolean;
}

export interface SubScore {
  /** Sub-criterion id, e.g. "1.1" … "5.3" (07 §7). */
  id: string;
  label: string;
  max: number;
  /** null = unknown (scores 0 and drives research). */
  points: number | null;
  reason: string;
  evidenceIds: string[];
}

export interface CriterionScore {
  id: "C1" | "C2" | "C3" | "C4" | "C5";
  label: string;
  max: number;
  total: number;
  subs: SubScore[];
}

export interface GateResult {
  /** "G1" … "G8" (07 §3). */
  id: string;
  pass: boolean;
  why: string;
}

export interface Reason {
  text: string;
  evidenceIds: string[];
}

// ═════════════════════════ enums (text + check in SQL) ═════════════════════════

export const MARKET_CODES = ["IN", "SA", "AE", "QA", "OM", "KW", "BH", "NO", "MY"] as const;
export type MarketCode = (typeof MARKET_CODES)[number];

export const PROJECT_STAGES = [
  "concept", "feasibility", "feed", "prequalification", "epc_tender", "awarded",
  "detailed_engineering", "procurement", "construction", "commissioning",
  "operations", "on_hold", "cancelled", "completed",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const DISCIPLINES = [
  "civil_structural", "static_equipment", "rotating_equipment", "piping", "pipeline",
  "electrical", "instrumentation_control", "telecom", "hvac", "fire_safety",
  "insulation_painting", "logistics_heavy_lift", "procurement_services",
  "construction_services", "commissioning_services", "engineering_services", "other",
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const COMPANY_TYPES = [
  "owner", "pmc_consultant", "main_epc", "subcontractor", "fabricator",
  "manufacturer", "stockist_trader", "logistics", "financier", "government_buyer", "other",
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const PARTY_ROLES = [
  "owner", "pmc", "consultant", "main_epc", "consortium_member", "subcontractor",
  "supplier", "logistics", "financier",
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const RELATIONSHIP_TYPES = [
  "awarded_to", "subcontracted_to", "supplied_by", "partnered_with", "approved_vendor_of",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const BUYING_ROLES = [
  "decision_maker", "project_director", "procurement_lead", "package_manager",
  "technical_evaluator", "discipline_lead", "expediting", "logistics_coordinator",
  "tender_contact", "executive", "other",
] as const;
export type BuyingRole = (typeof BUYING_ROLES)[number];

export const SIGNAL_TYPES = [
  "capex_plan", "project_announced", "feed_awarded", "permit_approved",
  "prequalification_opened", "tender_released", "tender_closing_soon",
  "bid_results_published", "contract_awarded", "subcontract_awarded",
  "supply_order_announced", "vendor_registration_opened", "approved_vendor_listed",
  "hiring_project_roles", "import_shipment", "engagement",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const LEAD_STATUSES = ["new", "accepted", "rejected", "contacted", "rfq", "quoted", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type ConfidenceBand = "high" | "medium" | "low";
export type SourceTier = "A" | "B" | "C";
export type DocStatus = "new" | "filtered_out" | "queued" | "extracted" | "failed";
/** `disputed` facts are never stored (06 §4). */
export type Agreement = "both" | "single" | "rule";
export type CheckStatus = "met" | "missing" | "unknown" | "not_applicable";
export type ProcurementRoute = "open_tender" | "prequal" | "approved_vendor_list" | "direct" | "unknown";
export type PackageStatus = "planned" | "tendering" | "awarded" | "in_progress" | "closed";
export type PartyStatus = "announced" | "awarded" | "active" | "completed" | "terminated";
export type ProjectStatus = "active" | "cancelled" | "completed";
export type Seniority = "executive" | "director" | "manager" | "specialist";
export type ActivityType = "note" | "status_change" | "email_draft" | "email_sent" | "call" | "meeting";
export type DraftStatus = "draft" | "approved" | "sent_externally";
export type FactEntityType =
  | "company" | "project" | "package" | "requirement" | "tender" | "person" | "person_role"
  | "project_party" | "relationship" | "contact_point" | "signal" | "project_stage_event";

/** Reasons offered when rejecting a lead (09 §4.2). */
export const REJECT_REASONS = ["wrong_company", "not_our_scope", "too_late", "too_small", "already_known", "other"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

// ═════════════════════════ runs ═════════════════════════

export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** Allowed `run_events.stage` values. UI maps them onto: collecting → reading → checking → scoring. */
export type RunStage =
  | "collect" | "read" | "filter" | "extract" | "check" | "resolve" | "signals" | "score"
  | "research" | "done" | "error" | "info";

/** Stored in `runs.counters` and `run_events.counters` (all optional while a run is in flight). */
export interface RunCounters {
  sourcesTotal?: number;
  sourcesDone?: number;
  sourcesFailed?: number;
  itemsRead?: number;
  relevant?: number;
  factsKept?: number;
  factsDropped?: number;
  newLeads?: number;
  updatedLeads?: number;
}

export interface RunRow {
  id: string;
  adhoc_query: RunInput | null;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  counters: RunCounters;
  error: string | null;
  created_at: string;
}

export interface RunEventRow {
  id: number;
  run_id: string;
  ts: string;
  stage: RunStage;
  message: string;
  counters: RunCounters | null;
}

/** Alias used by the UI/API. */
export type RunEvent = RunEventRow;

export interface RunWithEvents extends RunRow {
  events: RunEventRow[];
}

// ═════════════════════════ documents and evidence ═════════════════════════

export interface SourceDocumentRow {
  id: string;
  source_key: string;
  source_name: string | null;
  tier: SourceTier;
  publisher_key: string;
  url: string;
  canonical_url: string;
  title: string | null;
  language: string | null;
  published_at: string | null;
  fetched_at: string;
  content_hash: string;
  text: string | null;
  status: DocStatus;
  filter_reason: string | null;
  run_id: string | null;
  is_sample: boolean;
  created_at: string;
}

export interface EvidenceRow {
  id: string;
  document_id: string | null;
  url: string;
  quote: string;
  char_start: number | null;
  char_end: number | null;
  extracted_by: string;
  quote_verified: boolean;
  agreement: Agreement | null;
  tier: SourceTier;
  publisher_key: string;
  observed_at: string;
  created_at: string;
}

export interface FactEvidenceRow {
  entity_type: FactEntityType;
  entity_id: string;
  field: string;
  evidence_id: string;
}

// ═════════════════════════ companies, projects, packages ═════════════════════════

export interface CompanyRow {
  id: string;
  canonical_name: string;
  normalized_name: string;
  country: string | null;
  types: CompanyType[];
  registry_source: string | null;
  registry_id: string | null;
  lei: string | null;
  domain: string | null;
  parent_company_id: string | null;
  listed_exchange: string | null;
  ticker: string | null;
  status: string | null;
  size_band: string | null;
  match_certainty: number;
  verified_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  normalized_name: string;
  owner_company_id: string | null;
  country: string | null;
  site: string | null;
  region: string | null;
  sector: string | null;
  project_type: string | null;
  current_stage: ProjectStage | null;
  estimated_value: number | null;
  currency: string | null;
  value_usd: number | null;
  funding_status: string | null;
  start_date: string | null;
  end_date: string | null;
  specs: Record<string, unknown>;
  status: ProjectStatus;
  created_at: string;
  updated_at: string | null;
}

export interface ProjectStageEventRow {
  id: string;
  project_id: string;
  stage: ProjectStage;
  event_date: string | null;
  evidence_id: string | null;
  created_at: string;
}

export interface PackageRow {
  id: string;
  project_id: string;
  discipline: Discipline;
  name: string;
  scope_text: string | null;
  package_owner_company_id: string | null;
  procurement_route: ProcurementRoute | null;
  status: PackageStatus | null;
  estimated_value: number | null;
  currency: string | null;
  value_usd: number | null;
  needed_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface RequirementRow {
  id: string;
  package_id: string;
  item_category: string;
  /** `id` of a product in client-profile.json, set by the matcher. */
  client_product_id: string | null;
  spec: Record<string, unknown>;
  quantity: number | null;
  unit: string | null;
  needed_by: string | null;
  delivery_site: string | null;
  delivery_port: string | null;
  incoterm: string | null;
  transport_mode: string | null;
  hs_code: string | null;
  created_at: string;
}

export interface ProjectPartyRow {
  id: string;
  project_id: string;
  company_id: string;
  role: PartyRole;
  package_id: string | null;
  scope_text: string | null;
  contract_value: number | null;
  currency: string | null;
  value_usd: number | null;
  award_date: string | null;
  status: PartyStatus | null;
  created_at: string;
}

// ═════════════════════════ people ═════════════════════════

export interface PersonRow {
  id: string;
  full_name: string;
  normalized_name: string;
  current_company_id: string | null;
  title: string | null;
  department: string | null;
  seniority: Seniority | null;
  country: string | null;
  profile_url: string | null;
  created_at: string;
}

export interface PersonRoleRow {
  id: string;
  person_id: string;
  company_id: string | null;
  project_id: string | null;
  package_id: string | null;
  buying_role: BuyingRole;
  works_with_person_id: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

// ═════════════════════════ graph, signals, leads ═════════════════════════

export interface RelationshipRow {
  id: string;
  from_company_id: string;
  to_company_id: string;
  type: RelationshipType;
  project_id: string | null;
  package_id: string | null;
  discipline: Discipline | null;
  event_date: string | null;
  value_usd: number | null;
  created_at: string;
}

export interface SignalRow {
  id: string;
  type: SignalType;
  signal_date: string;
  company_id: string | null;
  project_id: string | null;
  package_id: string | null;
  tender_ref: string | null;
  summary: string;
  fingerprint: string;
  evidence_ids: string[];
  run_id: string | null;
  created_at: string;
}

/** Stored in `leads.score_breakdown`. */
export interface ScoreBreakdown {
  criteria: CriterionScore[];
  /** Sub-criterion ids scored `unknown` (points null), e.g. ["2.2","5.2"]. */
  unknown: string[];
}

/**
 * Who the lead is about (14 §2): the six buyer roles. `supplier` is legacy (13 §11, rows scored before
 * migration 004); migration 004 maps it to `manufacturer` or `distributor` and scoring never writes it.
 */
export const BUYER_TYPES = ["owner", "epc_contractor", "subcontractor", "manufacturer", "fabricator", "distributor", "supplier"] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

export interface LeadRow {
  id: string;
  kind: LeadKind;
  buyer_company_id: string;
  project_id: string | null;
  package_id: string | null;
  tender_ref: string | null;
  client_product_ids: string[];
  signal_ids: string[];
  score: number | null;
  score_breakdown: ScoreBreakdown;
  gate_results: GateResult[];
  confidence: number | null;
  confidence_band: ConfidenceBand | null;
  class: LeadClass;
  reasons: Reason[];
  status: LeadStatus;
  reject_reason: string | null;
  owner_user_id: string | null;
  next_action: string | null;
  closing_date: string | null;
  scoring_version: number;
  is_sample: boolean;
  run_id: string | null;
  created_at: string;
  updated_at: string | null;
  /** Migration 003; null on leads scored before it. */
  buyer_type?: BuyerType | null;
}

export interface LeadScoreHistoryRow {
  id: number;
  lead_id: string;
  scored_at: string;
  score: number | null;
  confidence: number | null;
  class: LeadClass | null;
  scoring_version: number | null;
}

// ═════════════════════════ workflow ═════════════════════════

export interface ActivityRow {
  id: string;
  lead_id: string;
  person_id: string | null;
  type: ActivityType;
  body: string | null;
  user_id: string | null;
  created_at: string;
}

export interface OutreachDraftRow {
  id: string;
  lead_id: string;
  person_id: string | null;
  subject: string | null;
  body: string | null;
  language: string | null;
  status: DraftStatus;
  blocked_reason: string | null;
  model: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface LlmUsageRow {
  id: number;
  ts: string;
  provider: string;
  model: string | null;
  purpose: string | null;
  tokens_in: number;
  tokens_out: number;
  run_id: string | null;
  ok: boolean;
  error: string | null;
}

// ═════════════════════════ client profile (04 §4, as JSON) ═════════════════════════

export interface SpecRanges {
  standard?: string[];
  grade?: string[];
  /** [min, max] outside diameter in inches. */
  od_in?: [number, number];
  [key: string]: unknown;
}

export interface ClientProduct {
  /** Stable id referenced by requirements.client_product_id and leads.client_product_ids. */
  id: string;
  name: string;
  discipline: Discipline;
  hs_codes: string[];
  keywords: string[];
  spec_ranges: SpecRanges;
  active: boolean;
}

export interface ClientProfile {
  /** True for the shipped example; replace client-profile.json with the client's real data. */
  is_example: boolean;
  company_name: string;
  markets: MarketCode[];
  disciplines: Discipline[];
  adjacent_disciplines: Discipline[];
  /** Past sectors (sub-criterion 1.3), e.g. "oil_gas". */
  sectors: string[];
  /** Sectors that earn partial credit in 1.3. */
  related_sectors: string[];
  min_project_value_usd: number | null;
  sweet_spot_min_usd: number | null;
  sweet_spot_max_usd: number | null;
  served_ports: string[];
  served_regions: string[];
  certifications: string[];
  /** e.g. {"SA":{"iktva_score":null},"AE":{"icv_cert_valid_until":"2027-03-31"},"IN":{"ppp_mii_class":"I"}} */
  local_content: Record<string, Record<string, unknown>>;
  /** e.g. {"etimad":true,"adnoc_supplier_hub":false} */
  registrations: Record<string, boolean>;
  /** Competitors / do-not-contact, by name (the slice has no company ids at config time). */
  excluded_company_names: string[];
  /** Existing customers, by name (G8 routes them to the account owner; 4.4 relationship). */
  existing_customer_names: string[];
  products: ClientProduct[];
  updated_at: string | null;
}

// ═════════════════════════ compliance (08) ═════════════════════════

export interface ChecklistItem {
  ruleKey: string;
  title: string;
  status: CheckStatus;
  hard: boolean;
  note: string;
  sourceUrl: string;
}

export type OutreachPermission = "allowed" | "opt_out_only" | "consent_needed" | "blocked";

export interface OutreachRule {
  country: string;
  email: OutreachPermission;
  phone: OutreachPermission;
  /** Email to a generic company address, when it differs from `email` (e.g. NO). */
  companyEmail?: OutreachPermission;
  steps: string[];
  sourceUrl: string;
}

/** Outreach rules evaluated for one contact on a lead. */
export interface PersonOutreach {
  personId: string;
  country: string | null;
  rule: OutreachRule;
}

// ═════════════════════════ relationship graph (07 §6) ═════════════════════════

export interface GraphPartner {
  companyId: string;
  name: string;
  discipline: Discipline | null;
  evidenceCount: number;
  lastDate: string | null;
  evidenceIds: string[];
}

export interface InsightProject {
  projectId: string;
  name: string;
  country: string | null;
  sector: string | null;
  role: PartyRole;
  awardDate: string | null;
  valueUsd: number | null;
  evidenceIds: string[];
}

export interface CompanyInsights {
  companyId: string;
  /** Awards in the last 5 years. */
  awards5y: number;
  sectors: string[];
  countries: string[];
  regularSuppliers: GraphPartner[];
  regularPartners: GraphPartner[];
  typicalSubcontracted: Discipline[];
  typicalSelfPerformed: Discipline[];
  projects: InsightProject[];
}

// ═════════════════════════ read models for the UI (repo.ts) ═════════════════════════

export interface LeadFilter {
  class?: LeadClass;
  market?: string;
  /** client product id */
  productId?: string;
  kind?: LeadKind;
  /** "open" = new|accepted|contacted|rfq|quoted; "all" = no status filter. Default "open". */
  status?: LeadStatus | "open" | "all";
  runId?: string;
  limit?: number;
  offset?: number;
  // ── added for the CRM UI (docs/mvp/13 §4); all optional ──
  /** Free text: company, project, package or product. */
  q?: string;
  /** Category = discipline of the lead's package (or of its first product). */
  discipline?: string;
  /** Project stage (ProjectStage). */
  stage?: string;
  /** Only leads added in the last 24 h / 7 days / 30 days. */
  added?: AddedWindow;
  confidence?: ConfidenceBand;
  /** Minimum score (0–100). */
  minScore?: number;
  /** "live" = not sample, "sample" = built from sample documents. */
  source?: LeadSource;
  /** Only these statuses (overrides `status`; used by the pipeline board). */
  statuses?: LeadStatus[];
  /** EPC contractor, subcontractor, supplier or owner. */
  buyerType?: BuyerType;
  /** Default "latest". */
  sort?: LeadSort;
}

export interface LeadListItem {
  id: string;
  kind: LeadKind;
  class: LeadClass;
  status: LeadStatus;
  score: number | null;
  confidence: number | null;
  confidenceBand: ConfidenceBand | null;
  buyerId: string;
  buyerName: string;
  buyerCountry: string | null;
  projectId: string | null;
  projectName: string | null;
  projectCountry: string | null;
  packageName: string | null;
  discipline: Discipline | null;
  productNames: string[];
  reasons: Reason[];
  closingDate: string | null;
  isSample: boolean;
  createdAt: string;
  /** Project stage (added for the CRM table). */
  stage?: ProjectStage | null;
  /** The lead's next step (added for the pipeline board). */
  nextAction?: string | null;
  /** EPC contractor, subcontractor, supplier or owner (null on old leads). */
  buyerType?: BuyerType | null;
}

export interface LeadListResult {
  items: LeadListItem[];
  /** Count per class for the tabs, respecting the other filters. */
  counts: Record<LeadClass, number>;
  /** Leads matching the whole filter (all pages), for "Showing 1–25 of n". */
  total: number;
}

export type LeadPatch = Partial<Pick<LeadRow, "status" | "reject_reason" | "owner_user_id" | "next_action">>;

/** Evidence enriched with its document, for the ⓘ side panel. */
export interface EvidenceView extends EvidenceRow {
  sourceName: string | null;
  sourceKey: string | null;
  documentTitle: string | null;
  publishedAt: string | null;
  isSample: boolean;
  /** The full sentence of the document that contains the quote (null when the document text is gone). */
  sentence?: string | null;
}

export interface PartyView extends ProjectPartyRow {
  company: CompanyRow | null;
}

export interface PackageView extends PackageRow {
  owner: CompanyRow | null;
  requirements: RequirementRow[];
}

export interface PersonView extends PersonRow {
  companyName: string | null;
  roles: PersonRoleRow[];
}

/** A company on the lead (buyer, owner, EPC, subcontractor, supplier) with ways to find its contacts (13 §11). */
export interface CompanyContactView {
  companyId: string;
  name: string;
  country: string | null;
  /** Plain roles on this lead: "Buyer", "Owner", "EPC contractor", "Subcontractor", "Supplier". */
  roles: string[];
  /** Company website when known (companies.domain). */
  website: string | null;
  /** Web searches that open in a new tab (never scraped): label + url. */
  searches: { label: string; url: string }[];
  /** Outreach rule for the company's country (email to a company address). */
  rule: OutreachRule;
}

export interface LeadDetail {
  lead: LeadRow;
  buyer: CompanyRow;
  project: ProjectRow | null;
  projectOwner: CompanyRow | null;
  stageEvents: ProjectStageEventRow[];
  /** All packages of the project; `lead.package_id` marks the lead's own. */
  packages: PackageView[];
  /** Flat list of requirements across `packages` (convenience). */
  requirements: RequirementRow[];
  parties: PartyView[];
  people: PersonView[];
  signals: SignalRow[];
  /** evidence id -> evidence, covering every id referenced anywhere in this detail. */
  evidence: Record<string, EvidenceView>;
  /** Field-level provenance for entities in this detail (company/project/package/…). */
  facts: FactEvidenceRow[];
  breakdown: ScoreBreakdown;
  gates: GateResult[];
  reasons: Reason[];
  buyerInsights: CompanyInsights | null;
  /** Filled by src/mvp/compliance; empty placeholders until computed. */
  compliance: {
    bid: ChecklistItem[];
    outreach: PersonOutreach[];
  };
  activities: ActivityRow[];
  drafts: OutreachDraftRow[];
  scoreHistory: LeadScoreHistoryRow[];
  /** Companies on the lead with "Find contacts" research links (buyer first). */
  companies?: CompanyContactView[];
}

// ═════════════════════════ LLM ═════════════════════════

export type LLMRole = "triage" | "extract_a" | "extract_b" | "draft" | "judge";

// ═════════════════════════ CRM UI (docs/mvp/13) ═════════════════════════

export type LeadSort = "latest" | "score" | "closing";
export type AddedWindow = "24h" | "7d" | "30d";
export type LeadSource = "live" | "sample";

/** One option of a Leads filter with the number of matching leads (other filters applied). */
export interface FacetOption {
  value: string;
  count: number;
}

/** Options with counts for every Leads filter, computed from the database. */
export interface LeadFacets {
  discipline: FacetOption[];
  market: FacetOption[];
  kind: FacetOption[];
  stage: FacetOption[];
  status: FacetOption[];
  confidence: FacetOption[];
  product: FacetOption[];
  source: FacetOption[];
  buyerType: FacetOption[];
}

export type RefreshHours = 6 | 12 | 24;

/** `saved_searches` row (migration 002). refresh_hours null = manual only. */
export interface SavedSearchRow {
  id: string;
  name: string;
  query: string;
  markets: string[];
  lead_kinds: LeadKind[];
  refresh_hours: RefreshHours | null;
  active: boolean;
  last_run_at: string | null;
  last_run_id: string | null;
  created_at: string;
}

/** A saved search with its last run, for Find and Overview. */
export interface SavedSearchView extends SavedSearchRow {
  lastRunStatus: RunStatus | null;
  lastRunNewLeads: number | null;
  /** When the scheduler will run it next (null = manual or paused). */
  nextRunAt: string | null;
}

export interface OverviewStats {
  newThisWeek: number;
  genuine: number;
  closingSoon: number;
  inPipeline: number;
  byMarket: FacetOption[];
  byCategory: FacetOption[];
  latest: LeadListItem[];
  totalLeads: number;
}

/** Top-bar status: last refresh, new genuine leads and the run queue. */
export interface AppStatus {
  lastFinishedAt: string | null;
  newGenuine: number;
  queue: { running: boolean; waiting: number; runId: string | null };
}
