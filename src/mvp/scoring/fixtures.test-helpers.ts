/**
 * Test helper: the worked example of docs/mvp/07 §10 as a ScoringContext.
 * A registry-matched contractor wins a gas pipeline EPC (exchange filing, Tier A); a trade-press
 * article two days later (Tier B) says the line pipe is 24-inch X65, 120 km.
 */
import { getClientProfile } from "@/mvp/config/profile";
import type {
  ChecklistItem,
  CompanyRow,
  PackageRow,
  ProjectPartyRow,
  ProjectRow,
  RequirementRow,
  SignalRow,
} from "@/mvp/types";
import type { ScoringContext } from "./context";
import type { EvidenceInfo } from "./util";

export const NOW = new Date("2026-09-27T09:00:00Z");

const ts = "2026-09-07T00:00:00.000Z";

export const IDS = {
  buyer: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  pkg: "00000000-0000-4000-8000-000000000003",
  req: "00000000-0000-4000-8000-000000000004",
  party: "00000000-0000-4000-8000-000000000005",
  sigAward: "00000000-0000-4000-8000-000000000006",
  sigHiring: "00000000-0000-4000-8000-000000000007",
  evA: "00000000-0000-4000-8000-0000000000a1",
  evB: "00000000-0000-4000-8000-0000000000b1",
  evC: "00000000-0000-4000-8000-0000000000c1",
};

export function evidence(id: string, over: Partial<EvidenceInfo> = {}): EvidenceInfo {
  return {
    id,
    tier: "A",
    publisherKey: "nseindia.com",
    quoteVerified: true,
    agreement: "rule",
    observedAt: ts,
    publishedAt: "2026-09-07T00:00:00.000Z",
    isSample: false,
    ...over,
  };
}

export function workedExample(): ScoringContext {
  const buyer: CompanyRow = {
    id: IDS.buyer,
    canonical_name: "Example Pipelines Construction Ltd",
    normalized_name: "example pipelines construction",
    country: "IN",
    types: ["main_epc"],
    registry_source: "MCA",
    registry_id: "L00000MH2000PLC000001",
    lei: null,
    domain: "example-pipelines.example",
    parent_company_id: null,
    listed_exchange: "NSE",
    ticker: "EXPC",
    status: "active",
    size_band: null,
    match_certainty: 1,
    verified_at: null,
    created_at: ts,
    updated_at: null,
  };
  const project: ProjectRow = {
    id: IDS.project,
    name: "Example Gas Trunk Pipeline",
    normalized_name: "example gas trunk pipeline",
    owner_company_id: null,
    country: "IN",
    site: null,
    region: null,
    sector: "oil_gas",
    project_type: "gas_pipeline",
    current_stage: "awarded",
    estimated_value: null,
    currency: null,
    value_usd: null,
    funding_status: null,
    start_date: null,
    end_date: null,
    specs: {},
    status: "active",
    created_at: ts,
    updated_at: null,
  };
  const pkg: PackageRow = {
    id: IDS.pkg,
    project_id: IDS.project,
    discipline: "pipeline",
    name: "Line pipe supply",
    scope_text: null,
    package_owner_company_id: null,
    procurement_route: null,
    status: "planned",
    estimated_value: null,
    currency: null,
    value_usd: 200_000_000,
    needed_by: null,
    created_at: ts,
    updated_at: null,
  };
  const req: RequirementRow = {
    id: IDS.req,
    package_id: IDS.pkg,
    item_category: "line pipe",
    client_product_id: "prod-line-pipe",
    spec: { od_in: 24, grade: "X65", standard: "API 5L" },
    quantity: 120,
    unit: "km",
    needed_by: null,
    delivery_site: null,
    delivery_port: "Mundra",
    incoterm: null,
    transport_mode: null,
    hs_code: null,
    created_at: ts,
  };
  const party: ProjectPartyRow = {
    id: IDS.party,
    project_id: IDS.project,
    company_id: IDS.buyer,
    role: "main_epc",
    package_id: null,
    scope_text: null,
    contract_value: null,
    currency: null,
    value_usd: null,
    award_date: "2026-09-07",
    status: "awarded",
    created_at: ts,
  };
  const signal = (id: string, type: SignalRow["type"], date: string, evidenceIds: string[]): SignalRow => ({
    id,
    type,
    signal_date: date,
    company_id: IDS.buyer,
    project_id: IDS.project,
    package_id: null,
    tender_ref: null,
    summary: `${type} ${date}`,
    fingerprint: id,
    evidence_ids: evidenceIds,
    run_id: null,
    created_at: ts,
  });
  const award = signal(IDS.sigAward, "contract_awarded", "2026-09-07", [IDS.evA, IDS.evB]);
  const hiring = signal(IDS.sigHiring, "hiring_project_roles", "2026-09-22", [IDS.evC]);
  // "Local-content status unknown" → 4.1 = 4.
  const checklist: ChecklistItem[] = [
    { ruleKey: "IN_LOCAL", title: "Local content status", status: "unknown", hard: true, note: "", sourceUrl: "" },
  ];
  const prior = (n: number) => ({
    projectId: `00000000-0000-4000-8000-00000000010${n}`,
    name: `Prior pipeline ${n}`,
    country: "IN",
    sector: "oil_gas",
    role: "main_epc" as const,
    awardDate: `202${3 + (n % 3)}-03-01`,
    valueUsd: null,
    evidenceIds: [],
  });
  return {
    now: NOW,
    kind: "supply_subcontract",
    profile: getClientProfile(),
    buyer,
    project,
    projectOwner: null,
    leadPackage: pkg,
    packages: [pkg],
    requirements: [req],
    parties: [party],
    stageEvents: [],
    tender: null,
    triggerSignals: [award],
    projectSignals: [award, hiring],
    people: [],
    insights: {
      companyId: IDS.buyer,
      awards5y: 5,
      sectors: ["oil_gas"],
      countries: ["IN"],
      regularSuppliers: [],
      regularPartners: [],
      typicalSubcontracted: [],
      typicalSelfPerformed: [],
      projects: [1, 2, 3, 4].map(prior),
    },
    checklist,
    existingCustomer: false,
    priorContact: false,
    competitorCount: null,
    evidence: {
      [IDS.evA]: evidence(IDS.evA),
      [IDS.evB]: evidence(IDS.evB, { tier: "B", publisherKey: "pipelinejournal.example", publishedAt: "2026-09-09T00:00:00.000Z" }),
      [IDS.evC]: evidence(IDS.evC, { tier: "C", publisherKey: "jobs.example", publishedAt: "2026-09-22T00:00:00.000Z" }),
    },
    factEvidence: {
      [`project_party:${IDS.party}`]: [IDS.evA, IDS.evB],
      [`package:${IDS.pkg}`]: [IDS.evB],
      [`requirement:${IDS.req}`]: [IDS.evB],
    },
  };
}
