// Data contract for buyers (doc 14 §9). Shared by server (buyers domain) and UI.
// Keep this file free of runtime imports so client components can import it.

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
}
export interface BuyerRow { /* list row: subset of BuyerView */
  leadId: string; name: string; subRoleLabel: string | null; role: BuyerRole; roleLabel: string;
  buyingReason: string; sellSummary: string; competitorNote: string | null;
  country: string | null; fitScore: number; howSure: 'high' | 'medium' | 'low'; stage: BuyerStage;
  found: number; total: number; isSample: boolean; triggerDate: string | null;
}
export type BuyerSignal = 'order_won' | 'contract_won' | 'tender_open' | 'expansion';
export interface BuyerSearch {
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
}

// ---- Server function results (doc 14 §9 "Server functions") ----

export interface FacetCount { value: string; label: string; count: number }
export interface BuyerFacets {
  roles: FacetCount[];
  countries: FacetCount[];
  items: FacetCount[];
  signals: FacetCount[];
  stages: FacetCount[];
  howSure: FacetCount[];
  reach: FacetCount[];
  industries: FacetCount[];
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
}
export interface ContactSearchResult { rows: ContactRow[]; total: number; found: number; page: number; pageSize: number }

export interface LeadList { id: string; name: string; createdAt: string; updatedAt: string; itemCount: number }
export interface LeadListItem { listId: string; leadId: string; addedAt: string }

export const BUYER_ROLE_LABELS: Record<BuyerRole, string> = {
  owner: 'Project owner',
  epc_contractor: 'EPC contractor',
  subcontractor: 'Subcontractor',
  manufacturer: 'Manufacturer',
  fabricator: 'Fabricator',
  distributor: 'Distributor',
};

export const BUYER_STAGE_LABELS: Record<BuyerStage, string> = {
  ready: 'Ready to approach',
  check: 'Check first',
  early: 'Early — keep an eye',
  not_buyer: 'Not a buyer',
};
