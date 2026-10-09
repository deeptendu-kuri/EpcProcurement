// Data contract for buyers (doc 14 §9). Shared by server (buyers domain) and UI.
// Keep this file free of runtime imports so client components can import it.

// Doc 16: additive hybrid-source contracts. WP5 materialises these snapshots in SQL.
export type TriggerKind = 'award' | 'order' | 'tender' | 'subcontract' | 'capability';
/** "award" means a contract award (the company won a contract or tender), never a prize. Awards are not required to be a lead. */
export const TRIGGER_KIND_LABELS: Record<TriggerKind, string> = {
  award: 'Contract won', order: 'Order won', tender: 'Open tender', subcontract: 'Subcontract won', capability: 'Does this work · no contract yet',
};
export const triggerKindLabel = (kind?: TriggerKind | null) => (kind ? TRIGGER_KIND_LABELS[kind] ?? kind : 'Not established');
export interface Trigger {
  id: string; kind: TriggerKind; role: 'contractor'|'subcontractor'|'supplier'|'owner'; title: string;
  date: string | null; datePrecision: 'day'|'month'|'year'|'unknown'; valueUsd: number | null;
  valueText: string | null; country: string | null; projectId: string | null; projectName: string | null;
  ownerName: string | null; strength: 'confirmed'|'likely'|'possible'; evidenceIds: string[];
}
export interface SourceCard {
  documentId: string; url: string; domain: string; title: string; publishedAt: string | null;
  kind: 'news'|'tender_notice'|'filing'|'company_site'|'directory'|'roundup';
  quotes: { evidenceId: string; sentence: string; highlight: string; proves: 'award'|'project'|'value'|'date'|'role'|'material'|'country'|'people' }[];
}
export interface LeadRow {
  opportunityId: string; companyId: string; name: string; whatTheyDo: string; trigger: Trigger | null;
  operatingCountry: string | null; hqCountry: string | null; sellSummary: string; fitScore: number;
  howSure: 'high'|'medium'|'low'; stage: 'ready'|'check'|'early'|'not_buyer'; contactsFound: number;
  contactsTotal: number; sourceCount: number; status: string; isSample: boolean;
}
export interface ContractorRow extends LeadRow { role: 'main_contractor'|'epc'|'subcontractor'; projectName: string | null; ownerName: string | null }
export interface SubcontractorRow {
  companyId: string; name: string; supplies: string; linkedToCompanyId: string; linkedToName: string;
  link: 'confirmed'|'likely'|'possible'; country: string | null; sellSummary: string;
  contactsFound: number; contactsTotal: number; sourceCount: number;
}
export interface EvidenceDrawerView {
  header: LeadRow; why: string; /** Why this work needs the searched product, when the source wording supports it. */ application?: string | null;
  sources: SourceCard[]; related: { above: SubcontractorRow[]; below: SubcontractorRow[] };
  contacts: ContactSlot[]; activity: { at: string; text: string }[];
}

export type BuyerRole = 'owner' | 'epc_contractor' | 'subcontractor' | 'manufacturer' | 'fabricator' | 'distributor';
export type BuyerStage = 'ready' | 'check' | 'early' | 'not_buyer'; // from class
export type FitLevel = 'good' | 'possible' | 'competitor';
export interface SellItem { itemId: string; name: string; category: string; fit: FitLevel; why: string; window?: string; evidenceIds: string[] }
export interface WindowStep { label: string; from: string | null; to: string | null; state: 'done' | 'now' | 'next' }
export interface WhyYou { strengthId: string; text: string; reason: string; isExample: boolean }
export type SlotRole = 'decision_maker' | 'buyer' | 'technical_approver' | 'influencer' | 'approver' | 'vendor_registration';
export interface ContactSlot {
  slotId: string; role: SlotRole; title: string; description: string;
  person: { id: string; name: string; title: string | null; evidenceIds: string[] } | null;
  status: 'not_found' | 'likely' | 'confirmed';
  findLinks: { label: string; url: string }[];
}
export interface ChainCompany { companyId: string | null; name: string; role: BuyerRole | 'pmc' | 'parent_group'; identified: boolean; found: number; total: number; note: string }
export interface ProofItem { evidenceId: string; sentence: string; highlight: string; source: string; date: string | null; url: string | null; verified: boolean }
export interface BuyerView {
  leadId: string; companyId: string; name: string; shortName: string;
  role: BuyerRole; roleLabel: string; subRoleLabel: string | null; // e.g. "Pipe mill", "Piping subcontractor"
  country: string | null; city: string | null;
  stage: BuyerStage; fitScore: number; howSure: 'high' | 'medium' | 'low';
  headline: string; buyingReason: string; buyingReasonEvidenceIds: string[]; triggerDate: string | null;
  sellItems: SellItem[]; competitorFor: string[];
  window: WindowStep[];
  whyYou: WhyYou[];
  team: ContactSlot[]; found: number; total: number;
  chain: ChainCompany[];
  reach: { country: string | null; email: 'allowed' | 'opt_out_only' | 'consent_needed' | 'blocked'; summary: string };
  proof: ProofItem[];
  status: string; isSample: boolean; updatedAt: string;
  // ---- doc 15 (buyer-first page + supply chain) ----
  /** Plain-words sub-role, e.g. "Pipeline builder", "Pipe maker", "Stockist". Never "EPC"/"owner". */
  whatTheyDo: string;
  /** Supply-chain tier of this buyer relative to how it was found (1 = won the work). */
  tier: ChainTier;
  /** For derived / tier 2-3 buyers: the tier-1 deal that surfaced them. */
  foundVia: { leadId: string; name: string } | null;
  /** All deals of this company (same company after name merging), strongest first. */
  deals: BuyerDeal[];
  chainSummary: { tier2: number; tier3: number; peopleTotal: number; peopleFound: number };
}
export interface BuyerRow { /* list row: subset of BuyerView */
  /** Doc 16: verified strongest trigger, absent on untouched legacy views. */
  trigger?: Trigger | null;
  leadId: string; name: string; subRoleLabel: string | null; role: BuyerRole; roleLabel: string;
  buyingReason: string; sellSummary: string; competitorNote: string | null;
  country: string | null; fitScore: number; howSure: 'high' | 'medium' | 'low'; stage: BuyerStage;
  found: number; total: number; isSample: boolean; triggerDate: string | null;
  // ---- doc 15 ----
  whatTheyDo: string;
  tier: ChainTier;
  foundVia: { leadId: string; name: string } | null;
  /** Number of deals for this company (row shows the strongest; "+N more deals" = dealsCount - 1). */
  dealsCount: number;
  /** Derived rows (tier 2/3 companies with no stored lead): stable key used by POST /api/mvp/buyers/derive. */
  derivedKey: string | null;
  /**
   * Stored lead id, or null for derived rows. `leadId` above stays a string for existing UI code:
   * for derived rows it is `derived:<derivedKey>` (use isDerivedLeadId / POST /api/mvp/buyers/derive).
   */
  storedLeadId: string | null;
  /** How we know the chain link (derived / tier 2-3 rows); null for tier 1. */
  link: ChainLinkStatus | null;
  /** Doc 17: the user's searches that saved this company, newest first. */
  searches?: { runId: string; label: string }[];
  /** Doc 17: the product searched for (what we can sell them), from the selected or latest search. */
  searchedProduct?: string | null;
  /** Doc 17: email automation status for this company. */
  emailStatus?: string | null;
  /** Doc 17: the saved opportunity for the selected or latest search. */
  opportunityId?: string | null;
}
export const DERIVED_PREFIX = 'derived:';
export function isDerivedLeadId(id: string): boolean { return id.startsWith(DERIVED_PREFIX); }
export type BuyerSignal = 'order_won' | 'contract_won' | 'tender_open' | 'expansion';
export interface BuyerSearch {
  triggers?: { kinds?:TriggerKind[]; withinDays?:number; undated?:boolean };
  location?: { any?: string[]; not?: string[]; basis?: 'hq' | 'site' };
  roles?: { any?: BuyerRole[]; not?: BuyerRole[] };
  sell?: { any?: string[] /* item ids */; hideCompetitors?: boolean };
  signals?: { any?: BuyerSignal[]; withinDays?: number };
  contacts?: { departments?: string[]; slotRoles?: SlotRole[]; onlyWithFound?: boolean };
  industry?: string[]; valueUsd?: { min?: number; max?: number };
  lookalikeOf?: string; companyList?: string[];
  reach?: ('allowed' | 'opt_out_only' | 'consent_needed')[];
  stage?: BuyerStage[]; minFit?: number; howSure?: ('high' | 'medium' | 'low')[];
  q?: string; sort?: 'latest' | 'fit' | 'window'; page?: number; pageSize?: number;
  /** Only companies saved by this search (run id). Absent = all searches. */
  run?: string;
  /** doc 15 D: supply-chain tier filter. Absent = all tiers. */
  tiers?: ChainTier[];
  /** doc 15 D: "How we know" filter (tier 1 rows count as confirmed). */
  linkStatus?: Exclude<ChainLinkStatus, 'not_identified'>[];
}

// ---- doc 15: supply-chain explorer ----

export type ChainTier = 1 | 2 | 3;
export type ChainLinkStatus = 'confirmed' | 'likely' | 'possible' | 'not_identified';
export type ChainLinkSource = 'source' | 'history' | 'directory' | 'user';
export interface ChainCandidate { companyId: string; name: string; country: string | null; why: string }
export interface ChainNode {
  /** Stable id within the tree, e.g. "t1", "t2:pipe_maker", "t3:pipe_maker:steel_mill". */
  nodeId: string;
  tier: ChainTier;
  parentNodeId: string | null;
  companyId: string | null;
  /** Stored lead for this company, if any (tier 1 always has one). */
  leadId: string | null;
  /** Key for derived buyers (company identified, no lead). Null when not identified or a lead exists. */
  derivedKey: string | null;
  /** Company name when identified, else the supplier type label (e.g. "Valve maker"). */
  name: string;
  /** Plain words: "Pipe maker", "Stockist" … */
  whatTheyDo: string;
  /** What this node supplies to its parent, e.g. "line pipe". Empty for tier 1. */
  supplies: string;
  link: ChainLinkStatus;
  linkWhy: string;
  linkSource: ChainLinkSource | null;
  evidenceIds: string[];
  /** Items from the client's catalogue this node would buy (competitor items excluded). */
  wouldBuy: SellItem[];
  /** Catalogue item names this node competes on. */
  competitorFor: string[];
  found: number;
  total: number;
  candidates: ChainCandidate[];
  /** True when the node has supplier types below it that are not included yet (tier 2 → tier 3). */
  expandable: boolean;
}
export interface SupplyChain {
  rootLeadId: string;
  rootCompanyId: string;
  nodes: ChainNode[];
  peopleTotal: number;
  peopleFound: number;
}
export interface ChainContactRow {
  tier: ChainTier;
  nodeId: string;
  companyId: string | null;
  companyName: string;
  companyIdentified: boolean;
  slotId: string;
  role: SlotRole;
  title: string;
  why: string;
  person: { id: string; name: string; title: string; email: string | null; phone: string | null; linkedinUrl: string | null; evidenceIds: string[] } | null;
  status: 'not_found' | 'likely' | 'confirmed' | 'company_first';
  findLinks: { label: string; url: string }[];
}
export interface BuyerDeal { leadId: string; title: string; date: string | null; valueUsd: number | null; sourceCount: number }
export interface AddContactInput { companyId: string; slotId: string; name: string; title: string; email?: string; phone?: string; linkedinUrl?: string; notes?: string }


// ---- Server function results (doc 14 §9 "Server functions") ----

export interface FacetCount { value: string; label: string; count: number }
export interface BuyerFacets {
  triggers?: FacetCount[];
  roles: FacetCount[];
  countries: FacetCount[];
  items: FacetCount[];
  signals: FacetCount[];
  stages: FacetCount[];
  howSure: FacetCount[];
  reach: FacetCount[];
  industries: FacetCount[];
  /** doc 15 D: supply-chain tier (1 won the work · 2 · 3). */
  tiers?: FacetCount[];
  /** doc 15 D: how we know (tier 1 counts as confirmed). */
  linkStatus?: FacetCount[];
}
export interface BuyerSearchResult {
  rows: BuyerRow[];
  total: number;
  facets: BuyerFacets;
  contactsFound: number;
  contactsTotal: number;
  page: number;
  pageSize: number;
}
export interface ContactRow {
  leadId: string;
  companyId: string;
  company: string;
  role: BuyerRole;
  roleLabel: string;
  country: string | null;
  slotId: string;
  slotRole: SlotRole;
  slotTitle: string;
  person: ContactSlot['person'];
  status: ContactSlot['status'];
  findLinks: ContactSlot['findLinks'];
  /** doc 15: supply-chain tier of the company (1 = won the work). */
  tier?: ChainTier;
  /** doc 15: set for derived companies (no stored lead yet); `leadId` is then `derived:<key>`. */
  derivedKey?: string | null;
}
export interface ContactSearchResult { rows: ContactRow[]; total: number; found: number; page: number; pageSize: number }

export interface LeadList { id: string; name: string; createdAt: string; updatedAt: string; itemCount: number }
export interface LeadListItem { listId: string; leadId: string; addedAt: string }

export const BUYER_ROLE_LABELS: Record<BuyerRole, string> = {
  // Plain words (docs/mvp/15 §A): never "EPC", "owner" or "main contractor".
  owner: 'Client / tendering body',
  epc_contractor: 'Builder',
  subcontractor: 'Specialist contractor',
  manufacturer: 'Maker',
  fabricator: 'Fabricator',
  distributor: 'Stockist',
};

export const BUYER_STAGE_LABELS: Record<BuyerStage, string> = {
  ready: 'Ready to approach',
  check: 'Check first',
  early: 'Early — keep an eye',
  not_buyer: 'Not a buyer',
};
