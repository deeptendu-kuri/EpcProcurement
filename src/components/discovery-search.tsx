"use client";

import Link from "next/link";
import { useWorkspaceView } from "@/components/workspace-view";
import { ResponsiveTable } from "@/components/responsive-table";
import { CrmSyncStatus, useCrmSync } from "@/components/crm-sync";
import { mergeWorkspaceCache, restoreSearchFilters, rowsForAction, type SearchFilters } from "@/lib/crm-workspace";
import { FilterDrawer } from "@/components/filter-drawer";
import { AddToLeadList, useSavedContactIds } from "@/components/add-to-lead-list";
import { useEffect, useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  Building2,
  Check,
  CircleCheck,
  CircleSlash,
  Database,
  Download,
  ExternalLink,
  LinkIcon,
  ListPlus,
  Mail,
  MailCheck,
  MapPin,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Wifi,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/badge";
import { formatDateTime } from "@/lib/date-format";
import type { BuyerOpportunity, CrmStatus, DecisionMaker, EmailVerificationStatus } from "@/types/domain";

interface DiscoverySearchProps {
  opportunities: BuyerOpportunity[];
}

interface LeadRow {
  opportunity: BuyerOpportunity;
  contact: DecisionMaker;
}

type SortMode = "score" | "company" | "contact";
type ResultTab = "results" | "lists";
type CandidateStage = "New" | "Researching" | "Contact Needed" | "Qualified" | "Rejected";
type EmailPipelineStatus = "Email Not Found" | "Search Queued" | "Verification Pending" | "Verified" | "Risky";
type DiscoveryPlayId = "project_owner" | "contractor_map" | "material_package" | "decision_makers" | "tender_watch";

const discoveryPlays: Array<{
  id: DiscoveryPlayId;
  label: string;
  eyebrow: string;
  output: string;
  rules: string[];
}> = [
  {
    id: "material_package",
    label: "Material package buyers",
    eyebrow: "Best for products",
    output: "Find buyers and contractors with source-backed material/package requirements.",
    rules: ["material match", "buyer action", "fresh source"],
  },
  {
    id: "contractor_map",
    label: "Awarded contractor map",
    eyebrow: "Best for project supply chains",
    output: "Map EPCs, subcontractors, scopes, and parent project context.",
    rules: ["award signal", "contractor named", "package scope"],
  },
  {
    id: "project_owner",
    label: "Project owner search",
    eyebrow: "Best for exact projects",
    output: "Find owner/client accounts tied to a fresh project, tender, or award.",
    rules: ["project named", "owner identified", "market matched"],
  },
  {
    id: "tender_watch",
    label: "Tender / RFQ watch",
    eyebrow: "Best for fresh notices",
    output: "Find active procurement notices with buyer and requirement evidence.",
    rules: ["tender/RFQ", "buyer or notice owner", "requirement"],
  },
  {
    id: "decision_makers",
    label: "Decision maker finder",
    eyebrow: "Best after accounts are found",
    output: "Find people/contact targets attached to proven account evidence.",
    rules: ["account evidence", "role/person source", "verification status"],
  },
];

interface DiscoveryPreset {
  id: string;
  label: string;
  playId: DiscoveryPlayId;
  query: string;
  regions: string[];
  keywords: string[];
  output: string;
  why: string;
  strength: string;
}

const clientSafeDiscoveryPresets: DiscoveryPreset[] = [
  {
    id: "preset-gcc-line-pipe-buyers",
    label: "GCC line pipe buyers",
    playId: "material_package",
    query: "API 5L carbon steel line pipe procurement GCC",
    regions: ["GCC"],
    keywords: ["API 5L", "carbon steel pipe", "line pipe", "procurement"],
    output: "Buyer or contractor accounts with fresh pipe/package demand.",
    why: "Starts from product plus buyer-action language, avoiding generic supplier/catalog pages.",
    strength: "Material + procurement + market",
  },
  {
    id: "preset-awarded-epc-map",
    label: "Awarded EPC contractor map",
    playId: "contractor_map",
    query: "pipeline EPC award awarded contractor package scope GCC",
    regions: ["GCC"],
    keywords: ["EPC award", "awarded contractor", "package scope", "subcontract"],
    output: "Parent projects plus named EPCs, suppliers, or subcontractors.",
    why: "Best when the client wants the company that won the work, not only the project owner.",
    strength: "Award + contractor + scope",
  },
  {
    id: "preset-tender-rfq-watch",
    label: "Tender / RFQ watch",
    playId: "tender_watch",
    query: "steel pipe tender RFQ procurement notice GCC",
    regions: ["GCC"],
    keywords: ["tender", "RFQ", "procurement notice", "steel pipe"],
    output: "Active procurement notices with buyer and requirement evidence.",
    why: "Best for fresh opportunities where old completed awards should not enter the CRM.",
    strength: "Fresh notice + requirement",
  },
  {
    id: "preset-water-pipeline-packages",
    label: "Water pipeline packages",
    playId: "material_package",
    query: "DI GRE pipe water pipeline procurement tender UAE Saudi Oman",
    regions: ["UAE", "Saudi Arabia", "Oman"],
    keywords: ["DI pipe", "GRE pipe", "water pipeline", "tender"],
    output: "Water utility/project buyers with pipe, fittings, valves, or installation package demand.",
    why: "Gives product/material context plus public-sector procurement language.",
    strength: "Utility + package + market",
  },
  {
    id: "preset-contractor-contacts",
    label: "Contractor contact path",
    playId: "decision_makers",
    query: "EPC contractor procurement manager project director pipeline GCC",
    regions: ["GCC"],
    keywords: ["procurement manager", "project director", "contracts manager", "EPC contractor"],
    output: "Account evidence that justifies contact search and enrichment.",
    why: "Use after account discovery when the next job is people/contact enrichment.",
    strength: "Account + role path",
  },
];

interface PersistedCrmState {
  listMembership: Record<string, string[]>;
  emailVerificationQueue: string[];
  crmStatusOverrides: Record<string, CrmStatus>;
  savedDiscoveryCandidates?: SavedDiscoveryCandidate[];
  convertedDiscoveryLeads?: ConvertedDiscoveryLead[];
  savedSearchLibrary?: SavedDiscoverySearch[];
}

interface CrmSnapshotResponse {
  ok: boolean;
  mode?: string;
  savedSearches?: SavedDiscoverySearch[];
  candidates?: SavedDiscoveryCandidate[];
  convertedLeads?: ConvertedDiscoveryLead[];
  decisionMakers?: EnrichedDecisionMaker[];
  contactEnrichmentJobs?: DiscoveryQueueJob[];
  emailVerificationJobs?: DiscoveryQueueJob[];
}

interface DiscoveryRunItem {
  url: string;
  title?: string;
  status: "COMPLETED" | "CHECKED" | "FAILED" | "SKIPPED" | "NEEDS_RETRY";
  stage: string;
  extraction?: DiscoveryExtraction;
  sourceQuality?: {
    score: number;
    category: string;
    matchedSignals: string[];
  };
  matchScore?: DiscoveryMatchScore;
  reason?: string;
  error?: string;
}

interface DiscoveryMatchScore {
  total: number;
  project: number;
  material: number;
  region: number;
  freshness: number;
  source: number;
  contractor: number;
  contactability: number;
  reasons: string[];
}

interface DiscoveryIntentClassification {
  mode: "exact_project" | "material_sourcing" | "contractor_lookup" | "tender_watch" | "broad_procurement" | "historical_research";
  strictness: "strict" | "balanced" | "broad";
  label: string;
  explanation: string;
  requiredTerms: string[];
}

interface DiscoveryAuditRow {
  item: DiscoveryRunItem;
  decision: "Saveable" | "Rejected" | "Needs Retry";
  decisionTone: "green" | "amber" | "red" | "neutral";
  matchedTerms: string[];
  missingTerms: string[];
  freshness: "Fresh" | "Stale" | "Unknown";
  regionStatus: "Matched" | "Missing" | "Not required";
  sourceQuality: string;
}

interface DiscoveryCompany {
  name?: string;
  country?: string;
}

interface DiscoveryRequirement {
  productCategory?: string;
  productType?: string;
  specification?: string;
  standard?: string;
  grade?: string;
  diameter?: string;
  quantity?: number;
  unit?: string;
}

interface AwardedContractor {
  name: string;
  country?: string;
  role?: string;
  scope?: string;
  contractValue?: string;
  packageHint?: string;
  confidence?: number;
}

interface DiscoveryExtraction {
  companies?: DiscoveryCompany[];
  awardedContractors?: AwardedContractor[];
  project?: {
    name?: string;
    country?: string;
    location?: string;
  };
  requirements?: DiscoveryRequirement[];
  signalType?: string;
  confidence?: number;
}

interface DiscoveryRunResult {
  ok: boolean;
  mode?: string;
  queryMode?: "project" | "broad";
  requiredMatchTerms?: string[];
  intentClassification?: DiscoveryIntentClassification;
  discoveryPlay?: {
    id: DiscoveryPlayId;
    label: string;
    output: string;
    evidenceRules: string[];
  };
  queries?: string[];
  discovered?: number;
  attempted?: number;
  autoRecovery?: {
    enabled: boolean;
    recoveryCandidateCount: number;
  };
  coverage?: {
    domainsChecked: number;
    sourceCategories: string[];
    evidenceSignals: string[];
    accepted: number;
    rejected: number;
    retry: number;
    sourceDiversity: number;
    evidenceStrength: number;
    retryPressure: number;
    rejectionPressure: number;
  };
  runVerdict?: {
    status: "client_safe" | "review" | "weak";
    label: string;
    bestScore: number;
    acceptedCount: number;
    minimumScore: number;
    reasons: string[];
  };
  processed?: DiscoveryRunItem[];
  error?: string;
}

interface RunHealth {
  ok: boolean;
  databaseConfigured?: boolean;
  databaseConnected?: boolean;
  liveDiscoveryConfigured?: boolean;
}

interface SavedDiscoveryCandidate {
  id: string;
  companyName: string;
  country: string;
  projectName: string;
  signalType: string;
  leadType?: "owner" | "contractor";
  parentLeadId?: string;
  parentCompanyName?: string;
  parentProjectName?: string;
  contractorRole?: string;
  contractorScope?: string;
  packageHint?: string;
  stage: CandidateStage;
  notes?: string;
  confidence?: number;
  requirementSummary: string;
  awardedContractors?: AwardedContractor[];
  sourceUrl: string;
  savedAt: string;
}

interface ConvertedDiscoveryLead extends SavedDiscoveryCandidate {
  crmStatus: CandidateStage;
  enrichmentStatus: "Not Started" | "Decision Maker Search Queued" | "Decision Makers Found";
  emailStatus: EmailPipelineStatus;
  targetRoles: string[];
  convertedAt: string;
}

interface SavedDiscoverySearch {
  id: string;
  label: string;
  query: string;
  regions: string[];
  keywords: string[];
  playId?: DiscoveryPlayId;
  createdAt: string;
  filters?: SearchFilters;
}

interface DiscoveryQueueJob {
  id: string;
  leadId: string;
  companyName: string;
  projectName?: string;
  targetRoles?: string[];
  emailStatus?: EmailPipelineStatus;
  status: string;
  queuedAt?: string;
  completedAt?: string;
  error?: string;
}

interface EnrichedDecisionMaker {
  id: string;
  leadId: string;
  companyName: string;
  name: string;
  title: string;
  emailStatus: EmailPipelineStatus;
  linkedinUrl?: string;
  phone?: string;
  phoneStatus?: string;
  linkedinStatus?: string;
  dataSourceType?: string;
  confidence?: number;
  evidenceNotes?: string;
  emailCandidateType?: string;
}

const crmStorageKey = "industrialBuyerCrmState.v1";
const defaultListMembership: Record<string, string[]> = {
  "priority-pipeline": ["contact-mexico-pacific-nelly-molina", "contact-mexico-pacific-faith-parker", "contact-mexico-pacific-percival-cleetus"],
  procurement: ["contact-mexico-pacific-procurement-target"],
  "project-owners": ["contact-mexico-pacific-percival-cleetus"],
};
const leadLists = [
  { id: "priority-pipeline", name: "Priority Pipeline Buyers" },
  { id: "procurement", name: "Procurement Contacts" },
  { id: "project-owners", name: "Project Owners" },
];
const regionOptions = ["Mexico", "GCC", "Saudi Arabia", "UAE", "USA", "Canada", "North America", "South America", "Qatar", "Oman"];
const jobTitleOptions = ["Procurement Head", "Project Director", "Supply Chain", "Engineering Manager", "Operations Lead"];
const industryOptions = ["Oil & Gas", "EPC", "Utilities", "Infrastructure"];
const keywordOptions = ["steel pipes", "steel plates", "hollow sections", "API 5L", "desalination tender", "pipeline EPC"];
const employeeOptions = ["1-50", "51-200", "201-500", "500+"];
const emailOptions: EmailVerificationStatus[] = ["Verified", "Unknown", "Risky", "Not Found"];
const candidateStages: CandidateStage[] = ["New", "Researching", "Contact Needed", "Qualified", "Rejected"];
const emailPipelineStatuses: EmailPipelineStatus[] = ["Email Not Found", "Search Queued", "Verification Pending", "Verified", "Risky"];
const targetDecisionMakerRoles = ["Procurement Head", "Project Director", "Supply Chain Manager", "Engineering Manager", "CEO / Managing Director"];
const defaultSavedSearches: SavedDiscoverySearch[] = [
  { id: "saved-gcc-pipeline-epc", label: "GCC pipeline EPC buyers", query: "GCC pipeline EPC buyers", regions: ["GCC"], keywords: ["pipeline EPC"], createdAt: "2026-09-04T00:00:00.000Z" },
  { id: "saved-saudi-utilities", label: "Saudi utilities procurement", query: "Saudi utilities procurement", regions: ["Saudi Arabia"], keywords: ["tender"], createdAt: "2026-09-04T00:00:00.000Z" },
  { id: "saved-canada-lng", label: "Canada LNG project procurement", query: "Canada LNG project procurement", regions: ["Canada"], keywords: ["gas expansion"], createdAt: "2026-09-04T00:00:00.000Z" },
];

function leadRows(opportunities: BuyerOpportunity[]): LeadRow[] {
  return opportunities.flatMap((opportunity) =>
    (opportunity.decisionMakers ?? []).map((contact) => ({
      opportunity,
      contact,
    })),
  );
}

function emailTone(status: string) {
  if (status === "Verified") return "green";
  if (status === "Risky") return "amber";
  if (status === "Not Found") return "red";
  return "neutral";
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function upsertQueueJob(jobs: DiscoveryQueueJob[], job: DiscoveryQueueJob) {
  const byId = new Map(jobs.map((item) => [item.id, item]));
  byId.set(job.id, job);
  return Array.from(byId.values()).sort((a, b) => (b.queuedAt ?? "").localeCompare(a.queuedAt ?? ""));
}

function matchesAny(value: string | undefined, selected: string[]) {
  if (selected.length === 0) return true;
  return selected.some((item) => value?.toLowerCase().includes(item.toLowerCase()));
}

function visibleListIds(listId: string, membership: Record<string, string[]>, knownContactIds: Set<string>) {
  const savedIds = (membership[listId] ?? []).filter((id) => knownContactIds.has(id));
  if (savedIds.length > 0) return savedIds;
  return (defaultListMembership[listId] ?? []).filter((id) => knownContactIds.has(id));
}

function csvEscape(value: string | number | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function stableCandidateId(companyName: string, projectName: string, sourceUrl: string) {
  return `${companyName}-${projectName}-${sourceUrl}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 140);
}

function requirementSummary(requirements: DiscoveryRequirement[]) {
  if (requirements.length === 0) return "Product details pending";

  return requirements
    .slice(0, 2)
    .map((requirement) =>
      [
        requirement.productCategory,
        requirement.productType,
        requirement.standard,
        requirement.grade,
        requirement.diameter,
        requirement.quantity ? `${requirement.quantity} ${requirement.unit ?? ""}`.trim() : "",
      ]
        .filter(Boolean)
        .join(" / "),
    )
    .filter(Boolean)
    .join("; ");
}

function awardedContractorSummary(contractors?: AwardedContractor[]) {
  if (!contractors?.length) return "Awarded contractor not extracted yet";

  return contractors
    .slice(0, 3)
    .map((contractor) => [contractor.name, contractor.role, contractor.scope].filter(Boolean).join(" / "))
    .join("; ");
}

function normalizeSavedCandidate(candidate: SavedDiscoveryCandidate): SavedDiscoveryCandidate {
  return {
    ...candidate,
    leadType: candidate.leadType ?? (candidate.parentCompanyName ? "contractor" : "owner"),
    stage: candidateStages.includes(candidate.stage) ? candidate.stage : "New",
    notes: candidate.notes ?? "",
    awardedContractors: Array.isArray(candidate.awardedContractors) ? candidate.awardedContractors : [],
  };
}

function normalizeConvertedLead(lead: ConvertedDiscoveryLead): ConvertedDiscoveryLead {
  return {
    ...normalizeSavedCandidate(lead),
    crmStatus: candidateStages.includes(lead.crmStatus) ? lead.crmStatus : "New",
    enrichmentStatus: lead.enrichmentStatus ?? "Not Started",
    emailStatus: emailPipelineStatuses.includes(lead.emailStatus) ? lead.emailStatus : "Email Not Found",
    targetRoles: Array.isArray(lead.targetRoles) && lead.targetRoles.length > 0 ? lead.targetRoles : targetDecisionMakerRoles,
    convertedAt: lead.convertedAt ?? lead.savedAt,
  };
}

function isContractorRecord(candidate: Pick<SavedDiscoveryCandidate, "leadType" | "parentCompanyName">) {
  return candidate.leadType === "contractor" || Boolean(candidate.parentCompanyName);
}

function leadRelationshipLabel(candidate: Pick<SavedDiscoveryCandidate, "leadType" | "parentCompanyName">) {
  return isContractorRecord(candidate) ? "Contractor CRM lead" : "Owner / buyer lead";
}

function leadRelationshipSummary(candidate: Pick<SavedDiscoveryCandidate, "companyName" | "projectName" | "parentCompanyName" | "parentProjectName" | "contractorRole" | "contractorScope" | "requirementSummary" | "leadType">) {
  if (isContractorRecord(candidate)) {
    const parent = [candidate.parentCompanyName, candidate.parentProjectName ?? candidate.projectName].filter(Boolean).join(" / ");
    return `${candidate.companyName} is a contractor-side lead${parent ? ` under ${parent}` : ""}. ${candidate.contractorScope || candidate.requirementSummary || candidate.contractorRole || "Package scope pending"}`;
  }

  return `${candidate.companyName} is the owner/buyer record for ${candidate.projectName}. Contractor leads can be created from awarded EPC or supplier evidence.`;
}

function discoveryLeadCards(run: DiscoveryRunResult | null) {
  const isProjectMode = run?.queryMode === "project";

  return (
    run?.processed
      ?.filter((item) => ["COMPLETED", "CHECKED"].includes(item.status) && item.extraction && isActionableDiscoveryExtraction(item.extraction))
      .flatMap((item) => {
        const contractorNames = new Set((item.extraction?.awardedContractors ?? []).map((contractor) => contractor.name.toLowerCase().trim()));
        const ownerCompanies = (item.extraction?.companies ?? [])
          .filter((company) => company.name)
          .filter((company) => !contractorNames.has(company.name!.toLowerCase().trim()));
        const companies = ownerCompanies.length > 0 ? ownerCompanies : (item.extraction?.companies ?? []).filter((company) => company.name).slice(0, 1);

        const candidateCompanies = isProjectMode ? companies.slice(0, 1) : companies;

        return candidateCompanies
          .map((company) => ({
            sourceUrl: item.url,
            companyName: company.name!,
            country: company.country ?? item.extraction?.project?.country ?? item.extraction?.project?.location ?? "Location pending",
            projectName: item.extraction?.project?.name ?? "Project name pending",
            signalType: item.extraction?.signalType?.replaceAll("_", " ") ?? "Industrial signal",
            confidence: item.extraction?.confidence,
            requirements: item.extraction?.requirements ?? [],
            requirementSummary: requirementSummary(item.extraction?.requirements ?? []),
            awardedContractors: item.extraction?.awardedContractors ?? [],
            matchScore: item.matchScore,
            sourceQuality: item.sourceQuality,
            sourceReason: item.reason,
          }));
      }) ?? []
  );
}

function matchScoreBreakdown(lead: ReturnType<typeof discoveryLeadCards>[number]) {
  const score = lead.matchScore;
  if (!score) return [];

  return [
    { label: "Project", value: score.project, max: 25 },
    { label: "Material", value: score.material, max: 20 },
    { label: "Region", value: score.region, max: 12 },
    { label: "Freshness", value: score.freshness, max: 13 },
    { label: "Source", value: score.source, max: 12 },
    { label: "Contractor", value: score.contractor, max: 12 },
    { label: "Contact path", value: score.contactability, max: 8 },
  ];
}

function playCandidateEvidence(playId: DiscoveryPlayId, lead: ReturnType<typeof discoveryLeadCards>[number]) {
  const hasProject = Boolean(lead.projectName && lead.projectName !== "Project name pending");
  const hasRequirements = lead.requirements.length > 0 && !lead.requirementSummary.toLowerCase().includes("product details pending");
  const hasContractors = lead.awardedContractors.length > 0;
  const highMatch = (lead.matchScore?.total ?? 0) >= 58;
  const hasFreshness = (lead.matchScore?.freshness ?? 0) > 0;
  const hasRegion = (lead.matchScore?.region ?? 0) >= 10;
  const hasSource = (lead.matchScore?.source ?? 0) >= 6;

  switch (playId) {
    case "contractor_map":
      return [
        { label: "Award / contract evidence", passed: hasContractors || lead.signalType.toLowerCase().includes("award") },
        { label: "Contractor or EPC named", passed: hasContractors },
        { label: "Parent project context", passed: hasProject },
        { label: "Fresh source", passed: hasFreshness },
      ];
    case "project_owner":
      return [
        { label: "Owner/client account", passed: Boolean(lead.companyName) },
        { label: "Project or tender named", passed: hasProject },
        { label: "Requested market", passed: hasRegion },
        { label: "Fresh source", passed: hasFreshness },
      ];
    case "tender_watch":
      return [
        { label: "Tender/procurement signal", passed: /tender|rfq|procurement/i.test(lead.signalType) || hasRequirements },
        { label: "Buyer or notice owner", passed: Boolean(lead.companyName) },
        { label: "Requirement extracted", passed: hasRequirements },
        { label: "Fresh source", passed: hasFreshness },
      ];
    case "decision_makers":
      return [
        { label: "Account evidence", passed: Boolean(lead.companyName) && hasProject },
        { label: "Role search justified", passed: hasRequirements || hasContractors },
        { label: "Source quality", passed: hasSource },
        { label: "Ready for enrichment", passed: highMatch },
      ];
    case "material_package":
    default:
      return [
        { label: "Requested material fit", passed: hasRequirements || (lead.matchScore?.material ?? 0) >= 13 },
        { label: "Buyer action", passed: /award|tender|procurement|requirement/i.test(lead.signalType) },
        { label: "Market matched", passed: hasRegion },
        { label: "Source quality", passed: hasSource },
      ];
  }
}

function isActionableDiscoveryExtraction(extraction: DiscoveryExtraction) {
  const signal = extraction.signalType ?? "";
  const hasCompany = Boolean(extraction.companies?.some((company) => company.name));
  const hasProject = Boolean(extraction.project?.name);
  const hasContractor = Boolean(extraction.awardedContractors?.length);
  const hasRequirement = Boolean(extraction.requirements?.length);
  const actionableSignal = ["EPC_AWARD", "TENDER_RELEASED", "PROCUREMENT_REQUIREMENT", "PRODUCT_SPECIFICATION", "CAPEX_ANNOUNCEMENT", "EXPANSION"].includes(signal);
  const procurementSignal = ["EPC_AWARD", "TENDER_RELEASED", "PROCUREMENT_REQUIREMENT", "CAPEX_ANNOUNCEMENT", "EXPANSION"].includes(signal);

  return hasCompany && (hasProject || hasContractor || (hasRequirement && actionableSignal && procurementSignal));
}

function isExactSourceSaved(item: DiscoveryRunItem, savedCandidates: SavedDiscoveryCandidate[]) {
  const projectName = item.extraction?.project?.name ?? item.extraction?.requirements?.[0]?.productCategory ?? "Project name pending";
  return Boolean(item.extraction?.companies?.some((company) => company.name && savedCandidates.some((candidate) => candidate.id === stableCandidateId(company.name!, projectName, item.url))));
}

function discoveryStatusLabel(item: DiscoveryRunItem, savedCandidates: SavedDiscoveryCandidate[]) {
  if (["COMPLETED", "CHECKED"].includes(item.status) && isExactSourceSaved(item, savedCandidates)) {
    return "Saved exact";
  }

  if (item.status === "COMPLETED" || item.status === "CHECKED") return "Accepted";
  if (item.status === "NEEDS_RETRY") return "Needs retry";
  return item.status.charAt(0) + item.status.slice(1).toLowerCase();
}

function discoveryStatusTone(item: DiscoveryRunItem, savedCandidates: SavedDiscoveryCandidate[]) {
  const label = discoveryStatusLabel(item, savedCandidates);
  if (label === "Saved exact" || label === "Accepted") return "green";
  if (label === "Failed") return "red";
  return "amber";
}

function discoveryAuditRows(run: DiscoveryRunResult | null): DiscoveryAuditRow[] {
  if (!run?.processed?.length) return [];
  const requiredTerms = run.intentClassification?.requiredTerms?.length ? run.intentClassification.requiredTerms : run.requiredMatchTerms ?? [];

  return run.processed.map((item) => {
    const auditText = discoveryAuditText(item);
    const matchedTerms = requiredTerms.filter((term) => matchesAuditTerm(auditText, term));
    const missingTerms = requiredTerms.filter((term) => !matchesAuditTerm(auditText, term));
    const decision = ["CHECKED", "COMPLETED"].includes(item.status) ? "Saveable" : item.status === "NEEDS_RETRY" ? "Needs Retry" : "Rejected";
    const statusText = `${item.reason ?? ""} ${item.error ?? ""}`.toLowerCase();
    const freshness = /old\/completed|stale|archive|historical|20(1\d|2[0-3])/.test(statusText) ? "Stale" : item.stage === "complete" || (item.matchScore?.freshness ?? 0) > 0 ? "Fresh" : "Unknown";
    const regionStatus = item.matchScore ? (item.matchScore.region >= 10 ? "Matched" : "Missing") : "Not required";

    return {
      item,
      decision,
      decisionTone: decision === "Saveable" ? "green" : decision === "Needs Retry" ? "amber" : "neutral",
      matchedTerms,
      missingTerms,
      freshness,
      regionStatus,
      sourceQuality: item.sourceQuality?.category ?? "Unclassified source",
    };
  });
}

function discoveryAuditText(item: DiscoveryRunItem) {
  const extraction = item.extraction;
  return [
    item.title,
    item.url,
    item.reason,
    item.error,
    item.sourceQuality?.matchedSignals?.join(" "),
    extraction?.companies?.map((company) => [company.name, company.country].join(" ")).join(" "),
    extraction?.awardedContractors?.map((contractor) => [contractor.name, contractor.role, contractor.scope, contractor.packageHint, contractor.country].join(" ")).join(" "),
    extraction?.project ? [extraction.project.name, extraction.project.country, extraction.project.location].join(" ") : "",
    extraction?.requirements?.map((requirement) => [requirement.productCategory, requirement.productType, requirement.standard, requirement.grade, requirement.specification].join(" ")).join(" "),
    extraction?.signalType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesAuditTerm(text: string, term: string) {
  const normalized = term.toLowerCase().replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (text.includes(normalized)) return true;
  const words = normalized.split(/\s+/).filter((word) => word.length >= 3);
  return words.length > 0 && words.every((word) => text.includes(word));
}

function candidateSearchText(lead: ReturnType<typeof discoveryLeadCards>[number]) {
  return [
    lead.companyName,
    lead.country,
    lead.projectName,
    lead.signalType,
    lead.requirementSummary,
    lead.sourceReason,
    lead.sourceQuality?.category,
    lead.sourceQuality?.matchedSignals.join(" "),
    lead.matchScore?.reasons.join(" "),
    lead.awardedContractors.map((contractor) => [contractor.name, contractor.role, contractor.scope, contractor.packageHint, contractor.country].filter(Boolean).join(" ")).join(" "),
    lead.requirements.map((requirement) => [requirement.productCategory, requirement.productType, requirement.standard, requirement.grade, requirement.specification, requirement.diameter].filter(Boolean).join(" ")).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function candidateSaveGate({
  lead,
  run,
  playId,
}: {
  lead: ReturnType<typeof discoveryLeadCards>[number];
  run: DiscoveryRunResult | null;
  playId: DiscoveryPlayId;
}) {
  const score = lead.matchScore;
  const minimumScore = run?.runVerdict?.minimumScore ?? 58;
  const requiredTerms = run?.intentClassification?.requiredTerms?.length ? run.intentClassification.requiredTerms : run?.requiredMatchTerms ?? [];
  const searchText = candidateSearchText(lead);
  const matchedTerms = requiredTerms.filter((term) => matchesAuditTerm(searchText, term));
  const strictTermCount = run?.queryMode === "project" ? Math.min(requiredTerms.length, 4) : Math.min(requiredTerms.length, 3);
  const requiredSlice = requiredTerms.slice(0, strictTermCount);
  const strictMatchedCount = requiredSlice.filter((term) => matchesAuditTerm(searchText, term)).length;
  const termMatchPass = requiredTerms.length === 0 || (run?.queryMode === "project" ? strictMatchedCount === requiredSlice.length : matchedTerms.length > 0);
  const hasProjectIdentity = Boolean(lead.companyName && lead.projectName && lead.projectName !== "Project name pending");
  const hasFreshness = (score?.freshness ?? 0) > 0;
  const hasSource = (score?.source ?? 0) >= 6;
  const hasScore = Boolean(score && score.total >= minimumScore);

  const reasons: string[] = [];
  if (!score) reasons.push("No match score was produced for this card.");
  if (score && score.total < minimumScore) reasons.push(`Match score ${score.total}/100 is below the ${minimumScore}/100 save gate.`);
  if (!termMatchPass) reasons.push(`Search terms are not locked to this candidate: ${requiredSlice.join(", ") || requiredTerms.join(", ") || "requested terms"}.`);
  if (!hasProjectIdentity) reasons.push("Company and project identity are not both proven.");
  if (!hasFreshness) reasons.push("Fresh/actionable source evidence is missing.");
  if (!hasSource) reasons.push("Source quality is below the save gate.");

  if (playId === "contractor_map" && (score?.contractor ?? 0) <= 0) reasons.push("Contractor-map saves require named contractor evidence.");
  if (playId === "material_package" && (score?.material ?? 0) < 13 && lead.requirements.length === 0) reasons.push("Material-package saves require requested material or package fit.");
  if (playId === "tender_watch" && !/tender|rfq|procurement|bid|solicitation/i.test(`${lead.signalType} ${lead.requirementSummary} ${lead.sourceQuality?.matchedSignals.join(" ") ?? ""}`)) reasons.push("Tender-watch saves require tender, RFQ, bid, or procurement language.");

  return {
    locked: reasons.length > 0,
    reasons,
    matchedTerms,
    badges: [
      { label: termMatchPass ? "Search matched" : "Search mismatch", passed: termMatchPass },
      { label: hasFreshness ? "Fresh/actionable" : "Freshness missing", passed: hasFreshness },
      { label: hasProjectIdentity ? "Project locked" : "Project unclear", passed: hasProjectIdentity },
      { label: hasSource ? "Source qualified" : "Weak source", passed: hasSource },
      { label: hasScore ? "Score passed" : "Score below gate", passed: hasScore },
    ],
  };
}

function playReviewCopy(playId: DiscoveryPlayId) {
  switch (playId) {
    case "contractor_map":
      return {
        resultTitle: "Awarded contractor candidates",
        resultSubtitle: "Save only contractors or owners with a named award, scope, package, and parent project trail.",
        primaryBlockLabel: "Parent project / owner context",
        packageBlockLabel: "Contractor package evidence",
        qaText: "Saveable contractor-map results must prove the award/contractor trail, package scope, parent context, freshness, and requested market before CRM entry.",
        emptyText: "No contractor map passed the evidence gate. Try a named project, EPC award, subcontract, or package-specific query.",
        loadingSteps: ["Find award sources", "Extract contractors", "Map package scope", "Prepare contractor leads"],
      };
    case "project_owner":
      return {
        resultTitle: "Project owner candidates",
        resultSubtitle: "Save only owner/client accounts tied to a fresh project, tender, award, or procurement signal.",
        primaryBlockLabel: "Project / tender evidence",
        packageBlockLabel: "Owner requirement evidence",
        qaText: "Saveable owner-search results must prove the searched project or tender, owner/client identity, freshness, and market fit before CRM entry.",
        emptyText: "No owner/client account passed the evidence gate. Use a named project, buyer, tender, or recent award phrase.",
        loadingSteps: ["Find project sources", "Identify owner", "Check freshness", "Prepare owner leads"],
      };
    case "tender_watch":
      return {
        resultTitle: "Tender / RFQ candidates",
        resultSubtitle: "Save only active procurement notices with buyer, requirement, market, and freshness evidence.",
        primaryBlockLabel: "Tender / notice evidence",
        packageBlockLabel: "Requirement evidence",
        qaText: "Saveable tender-watch results must prove tender/RFQ language, buyer or notice owner, requirement details, source quality, and freshness.",
        emptyText: "No tender/RFQ passed the evidence gate. Try adding country, authority, material, or procurement notice terms.",
        loadingSteps: ["Find notices", "Rank tender sources", "Extract requirements", "Prepare tender leads"],
      };
    case "decision_makers":
      return {
        resultTitle: "Decision maker account candidates",
        resultSubtitle: "Save only accounts with enough evidence to justify contact search and enrichment.",
        primaryBlockLabel: "Account evidence",
        packageBlockLabel: "Contact target evidence",
        qaText: "Saveable decision-maker results must first prove the account/project/package context. Real people are added only when a profile or contact source is found.",
        emptyText: "No account passed the decision-maker evidence gate. Start with a proven owner, contractor, project, or package query.",
        loadingSteps: ["Find account evidence", "Identify roles", "Check contact path", "Prepare contact targets"],
      };
    case "material_package":
    default:
      return {
        resultTitle: "Material package buyer candidates",
        resultSubtitle: "Save only buyers or contractors with source-backed material/package demand.",
        primaryBlockLabel: "Project / buyer evidence",
        packageBlockLabel: "Material package evidence",
        qaText: "Saveable material-package results must prove requested product fit, buyer action, freshness, market match, and source quality before CRM entry.",
        emptyText: "No material-package buyer passed the evidence gate. Try a specific material, standard, buyer, market, or tender phrase.",
        loadingSteps: ["Search product demand", "Rank buyer sources", "Extract packages", "Prepare buyer leads"],
      };
  }
}

function weakRunRecovery({
  run,
  playId,
  query,
  regions,
  keywords,
  saveableCount,
}: {
  run: DiscoveryRunResult | null;
  playId: DiscoveryPlayId;
  query: string;
  regions: string[];
  keywords: string[];
  saveableCount: number;
}) {
  if (!run || run.error || !run.processed?.length) return null;

  const coverage = run.coverage;
  const reasons: string[] = [];
  if (saveableCount === 0) reasons.push("No source passed every save gate for this play.");
  if (run.runVerdict?.status === "weak") reasons.push("The run verdict is weak, so saving is blocked until stronger evidence is found.");
  if (run.runVerdict?.status === "review") reasons.push("The run needs review before it should be treated as client-safe.");
  if ((coverage?.sourceDiversity ?? 100) < 55) reasons.push("Source diversity was thin; use another angle or source class.");
  if ((coverage?.evidenceStrength ?? 100) < 55) reasons.push("Evidence strength was weak; require clearer buyer action, requirement, award, or tender language.");
  if ((coverage?.retryPressure ?? 0) >= 25) reasons.push("Several sources need retry; provider or extraction pressure may have hidden useful evidence.");
  if ((coverage?.rejectionPressure ?? 0) >= 70) reasons.push("Most sources were rejected by freshness, source-quality, or query-fit gates.");

  const auditText = run.processed.map((item) => `${item.reason ?? ""} ${item.error ?? ""}`).join(" ").toLowerCase();
  if (/old\/completed|stale|archive|historical|20(1\d|2[0-3])/.test(auditText)) reasons.push("Old/completed sources were blocked; use active tender, procurement, award, or package wording.");
  if (/supplier\/catalog|catalog page|product range|datasheet/.test(auditText)) reasons.push("Generic supplier/catalog pages were ignored because they do not prove a buyer opportunity.");
  if (/did not prove the requested material|missing required|did not match the requested keyword/.test(auditText)) reasons.push("The run did not prove the requested product/material strongly enough.");
  if (/contractor-map play requires|contractor evidence|awarded epc/.test(auditText)) reasons.push("Contractor evidence was missing; search award, scope, EPC, and subcontract language.");

  if (reasons.length === 0) return null;

  const base = query.trim() || keywords[0] || "industrial procurement";
  const market = regions[0] || "GCC";
  const normalizedBase = base.replace(/\s+/g, " ").trim();
  const quotedBase = normalizedBase.includes(" ") ? `"${normalizedBase}"` : normalizedBase;
  const materialTerms = materialRecoveryTerms([query, ...keywords].join(" "));
  const materialPhrase = materialTerms.length ? materialTerms.slice(0, 3).join(" OR ") : normalizedBase;
  const playSuggestions: Record<DiscoveryPlayId, Array<{ label: string; query: string; playId?: DiscoveryPlayId; why: string }>> = {
    material_package: [
      { label: "Buyer action", query: `${quotedBase} procurement package ${market}`, why: "Adds procurement/package language so product searches become buyer-opportunity searches." },
      { label: "Tender demand", query: `${materialPhrase} tender RFQ procurement ${market}`, playId: "tender_watch", why: "Looks for active RFQ/tender demand instead of generic product pages." },
      { label: "Contractor demand", query: `${quotedBase} EPC contractor supply contract ${market}`, playId: "contractor_map", why: "Finds awarded EPCs and package owners who may buy the material." },
      { label: "Awarded package", query: `${quotedBase} award supply scope ${market}`, why: "Looks for recent awarded package evidence with scope." },
    ],
    contractor_map: [
      { label: "Awarded EPC", query: `${quotedBase} awarded contractor ${market}`, why: "Forces named contractor/award language." },
      { label: "Package scope", query: `${quotedBase} EPC contractor package scope ${market}`, why: "Looks for contractor plus scope, not just project mentions." },
      { label: "Subcontract trail", query: `${quotedBase} subcontractors award ${market}`, why: "Targets downstream package/subcontract opportunities." },
      { label: "Owner fallback", query: `${quotedBase} project owner client award ${market}`, playId: "project_owner", why: "If contractor evidence is thin, first lock the parent owner/project." },
    ],
    project_owner: [
      { label: "Owner/client", query: `${quotedBase} project owner ${market}`, why: "Locks the account that owns or buys for the project." },
      { label: "Client award", query: `${quotedBase} client award ${market}`, why: "Finds source-backed award/project-owner evidence." },
      { label: "Procurement angle", query: `${quotedBase} developer procurement ${market}`, why: "Looks for buying action tied to the owner." },
      { label: "Tender angle", query: `${quotedBase} project tender ${market}`, playId: "tender_watch", why: "Switches to live notice/procurement discovery." },
    ],
    tender_watch: [
      { label: "Tender", query: `${quotedBase} tender ${market}`, why: "Targets explicit tender pages." },
      { label: "RFQ", query: `${quotedBase} RFQ ${market}`, why: "Targets request-for-quotation language." },
      { label: "Procurement notice", query: `${quotedBase} procurement notice ${market}`, why: "Targets official notice wording." },
      { label: "Package bid", query: `${quotedBase} bid package ${market}`, why: "Looks for package-level procurement details." },
    ],
    decision_makers: [
      { label: "Procurement role", query: `${quotedBase} procurement manager ${market}`, why: "Finds procurement-side people only after account evidence exists." },
      { label: "Supply chain role", query: `${quotedBase} supply chain manager ${market}`, why: "Targets supply-chain ownership." },
      { label: "Project role", query: `${quotedBase} project director ${market}`, why: "Targets project-side leadership." },
      { label: "Account first", query: `${quotedBase} project procurement ${market}`, playId: "project_owner", why: "If people are thin, first strengthen account/project proof." },
    ],
  };

  const suggestedActions = dedupeRecoveryActions(playSuggestions[playId]).slice(0, 4);
  return { reasons: Array.from(new Set(reasons)).slice(0, 5), suggestedActions };
}

function materialRecoveryTerms(text: string) {
  const lower = text.toLowerCase();
  const terms = new Set<string>();
  if (lower.includes("carbon steel")) ["carbon steel pipe", "CS pipe", "steel pipe"].forEach((term) => terms.add(term));
  if (lower.includes("api 5l")) ["API 5L line pipe", "line pipe", "pipeline materials"].forEach((term) => terms.add(term));
  if (lower.includes("pipe")) ["pipe supply", "line pipe", "pipeline materials"].forEach((term) => terms.add(term));
  if (lower.includes("steel")) ["steel pipe", "steel plates", "structural steel"].forEach((term) => terms.add(term));
  if (lower.includes("valve")) ["valves", "flow control", "valve package"].forEach((term) => terms.add(term));
  return Array.from(terms);
}

function dedupeRecoveryActions(actions: Array<{ label: string; query: string; playId?: DiscoveryPlayId; why: string }>) {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.query}|${action.playId ?? ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clientSafeAudit({
  run,
  auditRows,
  saveableCount,
  savedCount,
  recoveryReasons,
}: {
  run: DiscoveryRunResult | null;
  auditRows: DiscoveryAuditRow[];
  saveableCount: number;
  savedCount: number;
  recoveryReasons: string[];
}) {
  if (!run || run.error) return null;

  const coverage = run.coverage;
  const runVerdict = run.runVerdict;
  const accepted = auditRows.filter((row) => row.decision === "Saveable");
  const rejected = auditRows.filter((row) => row.decision === "Rejected");
  const retry = auditRows.filter((row) => row.decision === "Needs Retry");
  const matchedTerms = new Set(accepted.flatMap((row) => row.matchedTerms));
  const staleCount = auditRows.filter((row) => row.freshness === "Stale").length;
  const missingRegionCount = auditRows.filter((row) => row.regionStatus === "Missing").length;

  const failures = [
    saveableCount === 0 ? "No CRM-saveable lead passed every gate." : "",
    runVerdict?.status === "weak" ? "Run verdict is weak; saving should stay blocked." : "",
    runVerdict?.status === "review" ? "Run needs reviewer judgement before client use." : "",
    staleCount > 0 ? `${staleCount} stale/old source${staleCount === 1 ? "" : "s"} rejected.` : "",
    missingRegionCount > 0 ? `${missingRegionCount} source${missingRegionCount === 1 ? "" : "s"} missed the requested market.` : "",
    retry.length > 0 ? `${retry.length} source${retry.length === 1 ? "" : "s"} need retry.` : "",
    (coverage?.rejectionPressure ?? 0) >= 70 ? "Most checked sources were rejected." : "",
    (coverage?.sourceDiversity ?? 100) < 55 ? "Source diversity is thin." : "",
  ].filter(Boolean);

  const passes = [
    saveableCount > 0 ? `${saveableCount} saveable lead${saveableCount === 1 ? "" : "s"} passed save gates.` : "",
    matchedTerms.size > 0 ? `${matchedTerms.size} requested term${matchedTerms.size === 1 ? "" : "s"} matched.` : "",
    (coverage?.evidenceStrength ?? 0) >= 55 ? "Evidence strength is acceptable." : "",
    (coverage?.sourceDiversity ?? 0) >= 55 ? "Source diversity is acceptable." : "",
    savedCount > 0 ? `${savedCount} exact lead${savedCount === 1 ? "" : "s"} already saved.` : "",
  ].filter(Boolean);

  const status =
    runVerdict?.status === "client_safe" && saveableCount > 0 && failures.length <= 1
      ? "ready"
      : runVerdict?.status === "weak" || saveableCount === 0
        ? "blocked"
        : "review";

  const label =
    status === "ready"
      ? "Ready to show"
      : status === "blocked"
        ? "Blocked from CRM"
        : "Needs rerun / review";

  const nextStep =
    status === "ready"
      ? "Save exact leads, open detail, then create contractor/contact work."
      : status === "blocked"
        ? "Use the stronger rerun suggestions before saving anything."
        : "Review accepted sources, then rerun or save only exact locked leads.";

  return {
    status,
    label,
    nextStep,
    passes: passes.slice(0, 5),
    failures: Array.from(new Set([...failures, ...recoveryReasons])).slice(0, 6),
    metrics: [
      { label: "Saveable", value: saveableCount },
      { label: "Rejected", value: rejected.length },
      { label: "Retry", value: retry.length },
      { label: "Saved exact", value: savedCount },
    ],
  };
}

function estimateLiveDiscoveryQueryCount(query: string, regions: string[], keywords: string[]) {
  if (!query.trim() && regions.length === 0 && keywords.length === 0) return 3;

  const locationCount = Math.max(1, regions.length);
  const keywordCount = Math.max(1, keywords.length);
  const lower = query.toLowerCase();
  const focusedCount =
    lower.includes("taweelah") || lower.includes("ccgt") || lower.includes("combined cycle") || lower.includes("gas turbine")
      ? 4
      : 0;
  const subcontractCount = lower.includes("subcontract") ? 2 : 0;

  return Math.min(5, Number(Boolean(query.trim())) + focusedCount * locationCount + subcontractCount * locationCount + locationCount * keywordCount);
}

function isClientReadyCandidate(candidate: SavedDiscoveryCandidate) {
  const source = candidate.sourceUrl.toLowerCase();
  const text = [candidate.companyName, candidate.projectName, candidate.signalType, candidate.requirementSummary, candidate.country].join(" ").toLowerCase();
  const weakSource = ["linkedin.com", "instagram.com", "facebook.com", "youtube.com", "paulhastings.com", "/blog", "/insights/client-alerts"].some((item) => source.includes(item));
  const missingProject = candidate.projectName.toLowerCase().includes("project name pending");
  const missingRequirement = candidate.requirementSummary.toLowerCase().includes("product details pending");
  const weakCompany = ["icheme"].some((item) => candidate.companyName.toLowerCase() === item);
  const buyerSignal = ["pipeline", "tender", "contract", "award", "procurement", "water", "lng", "epc", "gas", "power plant", "ccgt", "combined cycle", "gas turbine", "subcontract"].some((item) => text.includes(item));

  return buyerSignal && !weakSource && !weakCompany && (!missingProject || !missingRequirement);
}

function runHealthTone(connected: boolean) {
  return connected ? "green" : "amber";
}

export function DiscoverySearch({ opportunities }: DiscoverySearchProps) {
  const sync = useCrmSync();
  const persistCrmPayload = (type: string, payload: Record<string, unknown>) => sync.write({ type, payload });
  const persistCrmQueuePayload = persistCrmPayload;
  const deleteCrmPayload = (type: string, id: string) => sync.write({ type, id }, "DELETE");
  const [query, setQuery] = useState("");
  const [customRegion, setCustomRegion] = useState("");
  const [customKeyword, setCustomKeyword] = useState("");
  const [regions, setRegions] = useState<string[]>([]);
  const [jobTitles, setJobTitles] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [selectedDiscoveryPlayId, setSelectedDiscoveryPlayId] = useState<DiscoveryPlayId>("material_package");
  const [employees, setEmployees] = useState<string[]>([]);
  const [emailStatuses, setEmailStatuses] = useState<string[]>([]);
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [skipOwned, setSkipOwned] = useState(false);
  const savedContactIds = useSavedContactIds();
  const [oneLeadPerCompany, setOneLeadPerCompany] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const [activeResultTab] = useState<ResultTab>("results");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedListId, setSelectedListId] = useState(leadLists[0].id);
  const [listMembership, setListMembership] = useState<Record<string, string[]>>(defaultListMembership);
  const [emailVerificationQueue, setEmailVerificationQueue] = useState<string[]>([]);
  const [crmStatusOverrides, setCrmStatusOverrides] = useState<Record<string, CrmStatus>>({});
  const [savedDiscoveryCandidates, setSavedDiscoveryCandidates] = useState<SavedDiscoveryCandidate[]>([]);
  const [convertedDiscoveryLeads, setConvertedDiscoveryLeads] = useState<ConvertedDiscoveryLead[]>([]);
  const [enrichedDecisionMakers, setEnrichedDecisionMakers] = useState<EnrichedDecisionMaker[]>([]);
  const [contactEnrichmentJobs, setContactEnrichmentJobs] = useState<DiscoveryQueueJob[]>([]);
  const [emailVerificationJobs, setEmailVerificationJobs] = useState<DiscoveryQueueJob[]>([]);
  const [savedSearchLibrary, setSavedSearchLibrary] = useState<SavedDiscoverySearch[]>(defaultSavedSearches);
  const [savedSearchQuery, setSavedSearchQuery] = useState("");
  const [candidateStageFilter, setCandidateStageFilter] = useState<CandidateStage | "All">("All");
  const [crmCountryFilter, setCrmCountryFilter] = useState("");
  const [crmProjectFilter, setCrmProjectFilter] = useState("");
  const [crmSignalFilter, setCrmSignalFilter] = useState("");
  const [crmRequirementFilter, setCrmRequirementFilter] = useState("");
  const [crmEmailFilter, setCrmEmailFilter] = useState<EmailPipelineStatus | "All">("All");
  const [crmMinConfidence, setCrmMinConfidence] = useState(0);
  const [crmSourceDateFilter, setCrmSourceDateFilter] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isRunningDiscovery, setIsRunningDiscovery] = useState(false);
  const [discoveryRun, setDiscoveryRun] = useState<DiscoveryRunResult | null>(null);
  const [runHealth, setRunHealth] = useState<RunHealth | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  useWorkspaceView("discoveryView.v1", { query, regions, keywords, selectedDiscoveryPlayId, jobTitles, industries, employees, emailStatuses, verifiedOnly, skipOwned, oneLeadPerCompany, sortMode }, (view) => {
    setQuery(view.query); setRegions(view.regions); setKeywords(view.keywords);
    setSelectedDiscoveryPlayId(view.selectedDiscoveryPlayId ?? "material_package");
    setJobTitles(view.jobTitles); setIndustries(view.industries); setEmployees(view.employees);
    setEmailStatuses(view.emailStatuses); setVerifiedOnly(view.verifiedOnly); setSkipOwned(view.skipOwned);
    setOneLeadPerCompany(view.oneLeadPerCompany); setSortMode(view.sortMode);
  });

  const selectedDiscoveryPlay = discoveryPlays.find((play) => play.id === selectedDiscoveryPlayId) ?? discoveryPlays[0];
  const activeRunPlayId = discoveryRun?.discoveryPlay?.id ?? selectedDiscoveryPlayId;
  const activeRunPlayLabel = discoveryRun?.discoveryPlay?.label ?? selectedDiscoveryPlay.label;
  const activeRunPlayOutput = discoveryRun?.discoveryPlay?.output ?? selectedDiscoveryPlay.output;
  const activeRunPlayRules = discoveryRun?.discoveryPlay?.evidenceRules ?? selectedDiscoveryPlay.rules;
  const activeRunCopy = playReviewCopy(activeRunPlayId);
  const allRows = useMemo(() => leadRows(opportunities), [opportunities]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rows = allRows
      .filter(({ opportunity, contact }) => {
        if (skipOwned && savedContactIds.includes(contact.id)) return false;
        if (verifiedOnly && opportunity.verificationStatus !== "Verified Lead") return false;
        if (!matchesAny(opportunity.company.country, regions) && !matchesAny(opportunity.company.region, regions)) return false;
        if (!matchesAny(opportunity.company.industry, industries) && !matchesAny(opportunity.company.subIndustry, industries)) return false;
        if (emailStatuses.length > 0 && !emailStatuses.includes(contact.emailStatus)) return false;
        if (jobTitles.length > 0 && !jobTitles.some((title) => `${contact.title} ${contact.department}`.toLowerCase().includes(title.toLowerCase().split(" ")[0]))) return false;
        if (keywords.length > 0 && !keywords.some((keyword) => `${opportunity.matchedQuery} ${(opportunity.intentKeywords ?? []).join(" ")}`.toLowerCase().includes(keyword.toLowerCase()))) return false;
        if (employees.length > 0 && !employees.includes(opportunity.company.employeeRange ?? "")) return false;
        if (!normalizedQuery) return true;

        return [
          contact.name,
          contact.title,
          contact.department,
          opportunity.company.canonicalName,
          opportunity.company.country,
          opportunity.company.region,
          opportunity.company.industry,
          opportunity.company.subIndustry,
          opportunity.matchedQuery,
          ...(opportunity.intentKeywords ?? []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (sortMode === "company") return a.opportunity.company.canonicalName.localeCompare(b.opportunity.company.canonicalName);
        if (sortMode === "contact") return a.contact.name.localeCompare(b.contact.name);
        return b.opportunity.score.score - a.opportunity.score.score;
      });

    if (!oneLeadPerCompany) return rows;

    const seen = new Set<string>();
    return rows.filter(({ opportunity }) => {
      if (seen.has(opportunity.company.id)) return false;
      seen.add(opportunity.company.id);
      return true;
    });
  }, [allRows, emailStatuses, employees, industries, jobTitles, keywords, oneLeadPerCompany, query, regions, sortMode, verifiedOnly, skipOwned, savedContactIds]);

  const selectedRows = filteredRows.filter((row) => selected.includes(row.contact.id));
  const selectedOnPage = filteredRows.length > 0 && filteredRows.every((row) => selected.includes(row.contact.id));
  const queuedOnPage = filteredRows.filter((row) => emailVerificationQueue.includes(row.contact.id)).length;
  const activeFilters = [
    ...regions,
    ...jobTitles,
    ...industries,
    ...keywords,
    ...employees,
    ...emailStatuses,
    verifiedOnly ? "Verified email only" : "",
    skipOwned ? "Exclude contacts in lists" : "",
    oneLeadPerCompany ? "One lead per company" : "",
  ].filter(Boolean);
  const liveLeadCards = discoveryLeadCards(discoveryRun);
  const processedSources = discoveryRun?.processed ?? [];
  const auditRows = discoveryAuditRows(discoveryRun);
  const saveableAuditRows = auditRows.filter((row) => row.decision === "Saveable").length;
  const rejectedAuditRows = auditRows.filter((row) => row.decision === "Rejected").length;
  const retryAuditRows = auditRows.filter((row) => row.decision === "Needs Retry").length;
  const acceptedSources = processedSources.filter((item) => ["CHECKED", "COMPLETED"].includes(item.status));
  const reviewSources = processedSources.filter((item) => !["CHECKED", "COMPLETED"].includes(item.status));
  const runCheckedCount = acceptedSources.length;
  const runSkippedCount = reviewSources.filter((item) => item.status === "SKIPPED").length;
  const runFailedCount = reviewSources.filter((item) => item.status === "FAILED").length;
  const runRetryCount = reviewSources.filter((item) => item.status === "NEEDS_RETRY").length;
  const runSaveableCandidateCount = liveLeadCards.length;
  const runSavedCandidateCount = liveLeadCards.filter((lead) =>
    savedDiscoveryCandidates.some((candidate) => candidate.id === stableCandidateId(lead.companyName, lead.projectName, lead.sourceUrl))
  ).length;
  const runCoverage = discoveryRun?.coverage;
  const runVerdict = discoveryRun?.runVerdict;
  const saveBlockedByWeakRun = runVerdict?.status === "weak";
  const runQualityStats = [
    { label: "Saveable", value: runSaveableCandidateCount, tone: "green" },
    { label: "Accepted sources", value: runCheckedCount, tone: "green" },
    { label: "Rejected", value: runSkippedCount + runFailedCount, tone: runSkippedCount + runFailedCount > 0 ? "amber" : "neutral" },
    { label: "Retry needed", value: runRetryCount, tone: runRetryCount > 0 ? "amber" : "neutral" },
    { label: "Saved exact", value: runSavedCandidateCount, tone: runSavedCandidateCount > 0 ? "green" : "neutral" },
  ];
  const noFreshLeadFound = Boolean(discoveryRun && !isRunningDiscovery && !discoveryRun.error && discoveryRun.processed?.length && runSaveableCandidateCount === 0);
  const recoveryPlan = weakRunRecovery({ run: discoveryRun, playId: activeRunPlayId, query, regions, keywords, saveableCount: runSaveableCandidateCount });
  const clientAudit = clientSafeAudit({
    run: discoveryRun,
    auditRows,
    saveableCount: runSaveableCandidateCount,
    savedCount: runSavedCandidateCount,
    recoveryReasons: recoveryPlan?.reasons ?? [],
  });
  const estimatedLiveQueryCount = estimateLiveDiscoveryQueryCount(query, regions, keywords);
  const liveDiscoveryConnected = Boolean(runHealth?.liveDiscoveryConfigured || discoveryRun?.ok || isRunningDiscovery);
  const clientReadySavedCandidates = savedDiscoveryCandidates.filter(isClientReadyCandidate);
  const clientReadyConvertedLeads = convertedDiscoveryLeads.filter(isClientReadyCandidate);
  const hiddenSavedCandidateCount = savedDiscoveryCandidates.length - clientReadySavedCandidates.length;
  const hiddenConvertedLeadCount = convertedDiscoveryLeads.length - clientReadyConvertedLeads.length;
  const filteredSavedCandidates = clientReadySavedCandidates.filter((candidate) => {
    if (candidateStageFilter !== "All" && candidate.stage !== candidateStageFilter) return false;
    if (crmCountryFilter && !candidate.country.toLowerCase().includes(crmCountryFilter.toLowerCase())) return false;
    if (crmProjectFilter && !candidate.projectName.toLowerCase().includes(crmProjectFilter.toLowerCase())) return false;
    if (crmSignalFilter && !candidate.signalType.toLowerCase().includes(crmSignalFilter.toLowerCase())) return false;
    if (crmRequirementFilter && !candidate.requirementSummary.toLowerCase().includes(crmRequirementFilter.toLowerCase())) return false;
    if (crmMinConfidence > 0 && Math.round((candidate.confidence ?? 0) * 100) < crmMinConfidence) return false;
    if (crmSourceDateFilter && candidate.savedAt.slice(0, 10) < crmSourceDateFilter) return false;
    return true;
  });
  const filteredConvertedLeads = clientReadyConvertedLeads.filter((lead) => {
    if (candidateStageFilter !== "All" && lead.crmStatus !== candidateStageFilter) return false;
    if (crmEmailFilter !== "All" && lead.emailStatus !== crmEmailFilter) return false;
    if (crmCountryFilter && !lead.country.toLowerCase().includes(crmCountryFilter.toLowerCase())) return false;
    if (crmProjectFilter && !lead.projectName.toLowerCase().includes(crmProjectFilter.toLowerCase())) return false;
    if (crmSignalFilter && !lead.signalType.toLowerCase().includes(crmSignalFilter.toLowerCase())) return false;
    if (crmRequirementFilter && !lead.requirementSummary.toLowerCase().includes(crmRequirementFilter.toLowerCase())) return false;
    if (crmMinConfidence > 0 && Math.round((lead.confidence ?? 0) * 100) < crmMinConfidence) return false;
    if (crmSourceDateFilter && lead.convertedAt.slice(0, 10) < crmSourceDateFilter) return false;
    return true;
  });
  const pendingContactJobs = contactEnrichmentJobs.filter((job) => !job.completedAt && !job.error);
  const pendingEmailJobs = emailVerificationJobs.filter((job) => !job.completedAt && !job.error);
  const latestQueueJobs = [...contactEnrichmentJobs, ...emailVerificationJobs]
    .sort((a, b) => (b.queuedAt ?? "").localeCompare(a.queuedAt ?? ""))
    .slice(0, 6);
  const enrichedDecisionMakerCounts = enrichedDecisionMakers.reduce<Record<string, number>>((counts, person) => {
    counts[person.leadId] = (counts[person.leadId] ?? 0) + 1;
    return counts;
  }, {});
  const filteredSavedSearches = savedSearchLibrary.filter((search) => {
    const searchable = [search.label, search.query, ...search.regions, ...search.keywords].join(" ").toLowerCase();
    return !savedSearchQuery.trim() || searchable.includes(savedSearchQuery.trim().toLowerCase());
  });
  const convertedLeadIds = new Set(convertedDiscoveryLeads.map((lead) => lead.id));
  const activeLead = filteredRows.find((row) => row.contact.id === selectedLeadId) ?? null;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(crmStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedCrmState>;
        setListMembership({ ...defaultListMembership, ...(parsed.listMembership ?? {}) });
        setEmailVerificationQueue(parsed.emailVerificationQueue ?? []);
        setCrmStatusOverrides(parsed.crmStatusOverrides ?? {});
        setSavedDiscoveryCandidates((parsed.savedDiscoveryCandidates ?? []).map(normalizeSavedCandidate));
        setConvertedDiscoveryLeads((parsed.convertedDiscoveryLeads ?? []).map(normalizeConvertedLead));
        setSavedSearchLibrary(parsed.savedSearchLibrary ?? defaultSavedSearches);
      }
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDatabaseState() {
      const response = await fetch("/api/discovery/crm").catch(() => null);
      if (!response?.ok) return;

      const payload = (await response.json()) as CrmSnapshotResponse;
      if (cancelled || !payload.ok || payload.mode !== "database") return;

      if (payload.savedSearches?.length) {
        setSavedSearchLibrary((current) => {
          const byId = new Map([...defaultSavedSearches, ...current].map((item) => [item.id, item]));
          payload.savedSearches!.forEach((search) => byId.set(search.id, search));
          return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        });
      }

      if (payload.candidates?.length) {
        setSavedDiscoveryCandidates((current) => {
          const byId = new Map(current.map((item) => [item.id, item]));
          payload.candidates!.map(normalizeSavedCandidate).forEach((candidate) => byId.set(candidate.id, candidate));
          return Array.from(byId.values()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
        });
      }

      if (payload.convertedLeads?.length) {
        setConvertedDiscoveryLeads((current) => {
          const byId = new Map(current.map((item) => [item.id, item]));
          payload.convertedLeads!.map(normalizeConvertedLead).forEach((lead) => byId.set(lead.id, lead));
          return Array.from(byId.values()).sort((a, b) => b.convertedAt.localeCompare(a.convertedAt));
        });
      }

      setEnrichedDecisionMakers(payload.decisionMakers ?? []);
      setContactEnrichmentJobs(payload.contactEnrichmentJobs ?? []);
      setEmailVerificationJobs(payload.emailVerificationJobs ?? []);
    }

    void loadDatabaseState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRunHealth() {
      const response = await fetch("/api/health").catch(() => null);
      if (!response?.ok) {
        if (!cancelled) setRunHealth({ ok: false, databaseConfigured: false });
        return;
      }

      const payload = (await response.json()) as RunHealth;
      if (!cancelled) setRunHealth(payload);
    }

    void loadRunHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const payload: PersistedCrmState = { listMembership, emailVerificationQueue, crmStatusOverrides, savedDiscoveryCandidates, convertedDiscoveryLeads, savedSearchLibrary };
    window.localStorage.setItem(crmStorageKey, mergeWorkspaceCache(window.localStorage.getItem(crmStorageKey), payload));
  }, [convertedDiscoveryLeads, crmStatusOverrides, emailVerificationQueue, isHydrated, listMembership, savedDiscoveryCandidates, savedSearchLibrary]);

  function clearFilters() {
    setQuery("");
    setCustomRegion("");
    setCustomKeyword("");
    setRegions([]);
    setJobTitles([]);
    setIndustries([]);
    setKeywords([]);
    setEmployees([]);
    setEmailStatuses([]);
    setVerifiedOnly(true);
    setSkipOwned(false);
    setOneLeadPerCompany(true);
    setSelected([]);
  }

  function toggleAllRows() {
    if (selectedOnPage) {
      setSelected((current) => current.filter((id) => !filteredRows.some((row) => row.contact.id === id)));
      return;
    }
    setSelected((current) => Array.from(new Set([...current, ...filteredRows.map((row) => row.contact.id)])));
  }

  function exportCsv() {
    const rowsToExport = rowsForAction(filteredRows, selected, (row) => row.contact.id);
    if (!rowsToExport.length) return;
    const header = ["name", "title", "company", "location", "email", "email_status", "source_url", "linkedin", "intent_keyword", "matched_query", "score"];
    const body = rowsToExport.map(({ opportunity, contact }) =>
      [
        contact.name,
        contact.title,
        opportunity.company.canonicalName,
        contact.location ?? opportunity.company.country,
        contact.emailStatus === "Verified" ? contact.email : "",
        contact.emailStatus,
        opportunity.sources[0]?.url,
        contact.linkedinUrl,
        opportunity.intentKeywords?.[0],
        opportunity.matchedQuery,
        opportunity.score.score,
      ]
        .map(csvEscape)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "industrial-discovery-leads.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function applySavedSearch(search: SavedDiscoverySearch) {
    setQuery(search.query);
    setRegions(search.regions);
    setKeywords(search.keywords);
    setSelectedDiscoveryPlayId(search.playId ?? "material_package");
    const filters = restoreSearchFilters(search.filters);
    setJobTitles(filters.jobTitles);
    setIndustries(filters.industries);
    setEmployees(filters.employees);
    setEmailStatuses(filters.emailStatuses);
    setVerifiedOnly(filters.verifiedOnly);
    setSkipOwned(filters.skipOwned);
    setOneLeadPerCompany(filters.oneLeadPerCompany);
    setSortMode(filters.sortMode);
    setSelected([]);
  }

  function applyDiscoveryPreset(preset: DiscoveryPreset, runNow = false) {
    setQuery(preset.query);
    setRegions(preset.regions);
    setKeywords(preset.keywords);
    setSelectedDiscoveryPlayId(preset.playId);
    setSelected([]);
    setDiscoveryRun(null);
    if (runNow) {
      void runLiveDiscovery({ query: preset.query, regions: preset.regions, keywords: preset.keywords, playId: preset.playId });
    }
  }

  function saveCurrentSearch() {
    const label = query.trim() || [...regions, ...keywords].join(" ") || "Custom discovery search";
    const search: SavedDiscoverySearch = {
      id: `search-${crypto.randomUUID()}`,
      label,
      query,
      regions,
      keywords,
      playId: selectedDiscoveryPlayId,
      createdAt: new Date().toISOString(),
      filters: { jobTitles, industries, employees, emailStatuses, verifiedOnly, skipOwned, oneLeadPerCompany, sortMode },
    };

    setSavedSearchLibrary((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      byId.set(search.id, search);
      return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
    void persistCrmPayload("saved-search", search as unknown as Record<string, unknown>);
  }

  function deleteSavedSearch(searchId: string) {
    setSavedSearchLibrary((current) => current.filter((search) => search.id !== searchId));
    void deleteCrmPayload("saved-search", searchId);
  }

  function exportSavedSearches() {
    const header = ["label", "play", "query", "regions", "keywords", "created_at"];
    const body = filteredSavedSearches.map((search) =>
      [search.label, search.playId ?? "material_package", search.query, search.regions.join("; "), search.keywords.join("; "), search.createdAt]
        .map(csvEscape)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "saved-discovery-searches.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function savedCandidateFromLead(lead: ReturnType<typeof discoveryLeadCards>[number], savedAt = new Date().toISOString()): SavedDiscoveryCandidate {
    return {
      id: stableCandidateId(lead.companyName, lead.projectName, lead.sourceUrl),
      companyName: lead.companyName,
      country: lead.country,
      projectName: lead.projectName,
      signalType: lead.signalType,
      confidence: lead.confidence,
      stage: "New",
      notes: "",
      requirementSummary: lead.requirementSummary,
      awardedContractors: lead.awardedContractors,
      sourceUrl: lead.sourceUrl,
      savedAt,
    };
  }

  function saveLiveCandidate(lead: ReturnType<typeof discoveryLeadCards>[number]) {
    if (saveBlockedByWeakRun) return;
    if (candidateSaveGate({ lead, run: discoveryRun, playId: activeRunPlayId }).locked) return;
    const candidate = savedCandidateFromLead(lead);
    setSavedDiscoveryCandidates((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      byId.set(candidate.id, candidate);
      return Array.from(byId.values()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    });
    void persistCrmPayload("candidate", candidate as unknown as Record<string, unknown>);
  }

  function isLiveCandidateSaved(lead: ReturnType<typeof discoveryLeadCards>[number]) {
    const id = stableCandidateId(lead.companyName, lead.projectName, lead.sourceUrl);
    return savedDiscoveryCandidates.some((candidate) => candidate.id === id);
  }

  function persistSavedCandidate(candidate: SavedDiscoveryCandidate) {
    void persistCrmPayload("candidate", candidate as unknown as Record<string, unknown>);
  }

  function persistConvertedLead(lead: ConvertedDiscoveryLead) {
    void persistCrmPayload("converted-lead", lead as unknown as Record<string, unknown>);
  }

  function persistContactEnrichmentJob(lead: ConvertedDiscoveryLead) {
    const job: DiscoveryQueueJob = {
      id: `contact-enrichment-${lead.id}`,
      leadId: lead.id,
      companyName: lead.companyName,
      projectName: lead.projectName,
      targetRoles: lead.targetRoles,
      status: "Queued",
      queuedAt: new Date().toISOString(),
    };
    setContactEnrichmentJobs((current) => upsertQueueJob(current, job));
    void persistCrmQueuePayload("contact-enrichment-job", { ...job, result: {} });
  }

  function persistEmailVerificationJob(lead: ConvertedDiscoveryLead) {
    const job: DiscoveryQueueJob = {
      id: `email-verification-${lead.id}`,
      leadId: lead.id,
      companyName: lead.companyName,
      projectName: lead.projectName,
      emailStatus: lead.emailStatus,
      status: "Queued",
      queuedAt: new Date().toISOString(),
    };
    setEmailVerificationJobs((current) => upsertQueueJob(current, job));
    void persistCrmQueuePayload("email-verification-job", { ...job, result: {} });
  }

  function updateCandidateStage(id: string, stage: CandidateStage) {
    setSavedDiscoveryCandidates((current) => {
      const updated = current.map((candidate) => (candidate.id === id ? { ...candidate, stage } : candidate));
      const changed = updated.find((candidate) => candidate.id === id);
      if (changed) persistSavedCandidate(changed);
      return updated;
    });
  }

  function updateCandidateNotes(id: string, notes: string) {
    setSavedDiscoveryCandidates((current) => {
      const updated = current.map((candidate) => (candidate.id === id ? { ...candidate, notes } : candidate));
      const changed = updated.find((candidate) => candidate.id === id);
      if (changed) persistSavedCandidate(changed);
      return updated;
    });
  }

  function convertCandidateToLead(candidate: SavedDiscoveryCandidate) {
    const convertedAt = new Date().toISOString();
    const lead: ConvertedDiscoveryLead = {
      ...candidate,
      stage: "Contact Needed",
      crmStatus: "Contact Needed",
      enrichmentStatus: "Not Started",
      emailStatus: "Email Not Found",
      targetRoles: targetDecisionMakerRoles,
      convertedAt,
    };

    setConvertedDiscoveryLeads((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      byId.set(lead.id, byId.has(lead.id) ? { ...byId.get(lead.id)!, ...lead } : lead);
      return Array.from(byId.values()).sort((a, b) => b.convertedAt.localeCompare(a.convertedAt));
    });
    persistConvertedLead(lead);
    updateCandidateStage(candidate.id, "Contact Needed");
  }

  function updateConvertedLeadStage(id: string, crmStatus: CandidateStage) {
    setConvertedDiscoveryLeads((current) => {
      const updated = current.map((lead) => (lead.id === id ? { ...lead, stage: crmStatus, crmStatus } : lead));
      const changed = updated.find((lead) => lead.id === id);
      if (changed) persistConvertedLead(changed);
      return updated;
    });
    updateCandidateStage(id, crmStatus);
  }

  function queueDecisionMakerSearch(id: string) {
    setConvertedDiscoveryLeads((current) => {
      const updated = current.map((lead) =>
        lead.id === id
          ? {
              ...lead,
              stage: lead.crmStatus === "New" ? "Researching" : lead.stage,
              enrichmentStatus: "Decision Maker Search Queued" as const,
              crmStatus: lead.crmStatus === "New" ? "Researching" : lead.crmStatus,
            }
          : lead,
      );
      const changed = updated.find((lead) => lead.id === id);
      if (changed) {
        persistConvertedLead(changed);
        persistContactEnrichmentJob(changed);
      }
      return updated;
    });
  }

  function queueLeadEmailVerification(id: string) {
    setConvertedDiscoveryLeads((current) => {
      const updated = current.map((lead) =>
        lead.id === id
          ? {
              ...lead,
              emailStatus: (lead.emailStatus === "Email Not Found" ? "Search Queued" : "Verification Pending") as EmailPipelineStatus,
            }
          : lead,
      );
      const changed = updated.find((lead) => lead.id === id);
      if (changed) {
        persistConvertedLead(changed);
        persistEmailVerificationJob(changed);
      }
      return updated;
    });
  }

  function exportSavedCandidates() {
    const rowsToExport = filteredSavedCandidates.length > 0 ? filteredSavedCandidates : clientReadySavedCandidates;
    const header = ["lead_type", "company", "parent_owner", "parent_project", "country", "project", "awarded_contractors", "signal_type", "stage", "notes", "requirement", "confidence", "source_url", "saved_at"];
    const body = rowsToExport.map((candidate) =>
      [
        candidate.leadType ?? "owner",
        candidate.companyName,
        candidate.parentCompanyName,
        candidate.parentProjectName,
        candidate.country,
        candidate.projectName,
        awardedContractorSummary(candidate.awardedContractors),
        candidate.signalType,
        candidate.stage,
        candidate.notes,
        candidate.requirementSummary,
        typeof candidate.confidence === "number" ? Math.round(candidate.confidence * 100) : undefined,
        candidate.sourceUrl,
        candidate.savedAt,
      ]
        .map(csvEscape)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "saved-discovery-candidates.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportConvertedLeads() {
    const header = ["lead_type", "company", "parent_owner", "parent_project", "country", "project", "awarded_contractors", "crm_status", "enrichment_status", "email_status", "target_roles", "requirement", "confidence", "source_url", "converted_at"];
    const body = convertedDiscoveryLeads.map((lead) =>
      [
        lead.leadType ?? "owner",
        lead.companyName,
        lead.parentCompanyName,
        lead.parentProjectName,
        lead.country,
        lead.projectName,
        awardedContractorSummary(lead.awardedContractors),
        lead.crmStatus,
        lead.enrichmentStatus,
        lead.emailStatus,
        lead.targetRoles.join("; "),
        lead.requirementSummary,
        typeof lead.confidence === "number" ? Math.round(lead.confidence * 100) : undefined,
        lead.sourceUrl,
        lead.convertedAt,
      ]
        .map(csvEscape)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "converted-crm-leads.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function runLiveDiscovery(overrides?: { query?: string; keywords?: string[]; regions?: string[]; playId?: DiscoveryPlayId }) {
    const nextQuery = overrides?.query ?? query;
    const nextKeywords = overrides?.keywords ?? keywords;
    const nextRegions = overrides?.regions ?? regions;
    const nextPlayId = overrides?.playId ?? selectedDiscoveryPlayId;
    if (overrides?.query !== undefined) setQuery(overrides.query);
    if (overrides?.keywords !== undefined) setKeywords(overrides.keywords);
    if (overrides?.regions !== undefined) setRegions(overrides.regions);
    if (overrides?.playId !== undefined) setSelectedDiscoveryPlayId(overrides.playId);
    setIsRunningDiscovery(true);
    setDiscoveryRun(null);
    try {
      const response = await fetch("/api/discovery/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: nextQuery, regions: nextRegions, keywords: nextKeywords, playId: nextPlayId }),
      });
      const payload = (await response.json()) as DiscoveryRunResult;
      setDiscoveryRun(payload);
    } catch {
      setDiscoveryRun({ ok: false, error: "Discovery run could not be completed from this browser session." });
    } finally {
      setIsRunningDiscovery(false);
    }
  }

  return (
    <section
      data-workspace-frame="discovery"
      className="flex flex-col gap-3"
    >
      <CrmSyncStatus sync={sync} />
      <FilterDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Search filters">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e4e7ec] bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={17} className="text-[#2563eb]" />
            <h2 className="font-bold text-[#101828]">Filters</h2>
            <span className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-xs font-bold text-[#1d4ed8]">{activeFilters.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setFiltersOpen((current) => !current)} className="btn-quiet focus-ring inline-flex h-8 min-h-8 items-center gap-1 rounded-md px-2 text-xs font-bold">
              {filtersOpen ? "Hide" : "Show"}
            </button>
            <button type="button" onClick={clearFilters} className="btn-quiet focus-ring inline-flex h-8 min-h-8 items-center gap-1 rounded-md px-2 text-xs font-bold">
              <X size={14} />
              Clear
            </button>
          </div>
        </div>

        <div className="grid gap-4 p-4">
          <Toggle label="Exclude contacts in lists" checked={skipOwned} onChange={setSkipOwned} />
          <Toggle label="Verified email only" checked={verifiedOnly} onChange={setVerifiedOnly} />
          <Toggle label="One lead per company" checked={oneLeadPerCompany} onChange={setOneLeadPerCompany} />
          <FilterGroup defaultOpen icon={BriefcaseBusiness} label="Job Titles" options={jobTitleOptions} selected={jobTitles} onToggle={(value) => setJobTitles((current) => toggleValue(current, value))} />
          <FilterGroup defaultOpen icon={MapPin} label="Location" options={regionOptions} selected={regions} onToggle={(value) => setRegions((current) => toggleValue(current, value))} />
          <CustomFilterInput
            label="Add custom location"
            value={customRegion}
            placeholder="Canada, Brazil, Kuwait..."
            onChange={setCustomRegion}
            onAdd={() => {
              const value = customRegion.trim();
              if (!value) return;
              setRegions((current) => Array.from(new Set([...current, value])));
              setCustomRegion("");
            }}
          />
          <FilterGroup icon={Building2} label="Industries" options={industryOptions} selected={industries} onToggle={(value) => setIndustries((current) => toggleValue(current, value))} />
          <FilterGroup defaultOpen icon={Search} label="Keywords" options={keywordOptions} selected={keywords} onToggle={(value) => setKeywords((current) => toggleValue(current, value))} />
          <CustomFilterInput
            label="Add custom keyword"
            value={customKeyword}
            placeholder="desalination pipeline tender..."
            onChange={setCustomKeyword}
            onAdd={() => {
              const value = customKeyword.trim();
              if (!value) return;
              setKeywords((current) => Array.from(new Set([...current, value])));
              setCustomKeyword("");
            }}
          />
          <FilterGroup icon={Users} label="Employees" options={employeeOptions} selected={employees} onToggle={(value) => setEmployees((current) => toggleValue(current, value))} />
          <FilterGroup icon={Mail} label="Email Status" options={emailOptions} selected={emailStatuses} onToggle={(value) => setEmailStatuses((current) => toggleValue(current, value))} />
        </div>
      </FilterDrawer>

      <div
        data-workspace-pane="results"
        className="order-1 flex min-w-0 flex-col gap-4"
      >
        <section className="surface order-0 shrink-0 overflow-hidden rounded-xl">
          <div className="grid gap-2 border-b border-[#e4e7ec] bg-white p-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="flex h-12 min-w-0 items-center gap-3 rounded-lg border border-[#cfd7e4] bg-white px-4 shadow-sm transition-colors focus-within:border-[#2563eb] focus-within:ring-2 focus-within:ring-[#2563eb]/10">
              <Search size={18} className="text-[#667085]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full bg-transparent text-base font-medium text-[#101828] outline-none placeholder:text-[#98a2b3]"
                aria-label="Search companies, projects, or keywords"
                placeholder="Search company, project, tender, or material requirement"
              />
            </label>
            <button type="button" onClick={() => setFiltersOpen((current) => !current)} className="btn-quiet focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold">
              <SlidersHorizontal size={17} />
              Filters{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => runLiveDiscovery()}
              disabled={isRunningDiscovery}
              className="btn-primary focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-lg px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRunningDiscovery ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
              {isRunningDiscovery ? "Searching" : "Live search"}
            </button>
          </div>

          <div className="border-b border-[#e4e7ec] bg-[#fbfcff] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-[#101828]">Discovery Plays</div>
                <div className="mt-1 text-xs text-[#667085]">Choose the job. Search can explore broadly, but only evidence-backed matches become saveable.</div>
              </div>
              <Badge tone="green">{selectedDiscoveryPlay.label}</Badge>
            </div>
            <div className="grid gap-2 lg:grid-cols-5">
              {discoveryPlays.map((play) => {
                const active = play.id === selectedDiscoveryPlayId;
                return (
                  <button
                    key={play.id}
                    type="button"
                    onClick={() => setSelectedDiscoveryPlayId(play.id)}
                    className={`focus-ring min-h-[118px] rounded-lg border p-3 text-left transition ${active ? "border-[#2563eb] bg-white shadow-sm ring-2 ring-[#2563eb]/10" : "border-[#d0d5dd] bg-white/70 hover:border-[#98a2b3] hover:bg-white"}`}
                  >
                    <div className="text-[11px] font-bold uppercase text-[#667085]">{play.eyebrow}</div>
                    <div className="mt-1 text-sm font-bold text-[#101828]">{play.label}</div>
                    <div className="mt-1 text-xs leading-5 text-[#475467]">{play.output}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {play.rules.slice(0, 3).map((rule) => (
                        <span key={rule} className="rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-1.5 py-0.5 text-[10px] font-bold text-[#1d4ed8]">{rule}</span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-b border-[#e4e7ec] bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-[#101828]">Client-safe starting plays</div>
                <div className="mt-1 text-xs text-[#667085]">Use these when a client review or operator needs strong buyer-action searches instead of broad generic keywords.</div>
              </div>
              <Badge tone="neutral">{clientSafeDiscoveryPresets.length} presets</Badge>
            </div>
            <div className="grid gap-2 xl:grid-cols-5">
              {clientSafeDiscoveryPresets.map((preset) => {
                const active = preset.playId === selectedDiscoveryPlayId && preset.query === query;
                return (
                  <div key={preset.id} className={`rounded-lg border p-3 ${active ? "border-[#2563eb] bg-[#eff6ff]" : "border-[#d0d5dd] bg-[#fbfcfe]"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-bold uppercase text-[#667085]">{preset.strength}</div>
                        <div className="mt-1 text-sm font-bold text-[#101828]">{preset.label}</div>
                      </div>
                      <Badge tone={preset.playId === selectedDiscoveryPlayId ? "green" : "neutral"}>{discoveryPlays.find((play) => play.id === preset.playId)?.label ?? preset.playId}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[#475467]">{preset.output}</p>
                    <div className="mt-2 rounded-md border border-[#e4e7ec] bg-white p-2 text-[11px] font-semibold leading-4 text-[#667085]">{preset.why}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {preset.keywords.slice(0, 3).map((keyword) => (
                        <span key={`${preset.id}-${keyword}`} className="rounded border border-[#bfdbfe] bg-white px-2 py-0.5 text-[11px] font-bold text-[#1d4ed8]">{keyword}</span>
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => applyDiscoveryPreset(preset)}
                        className="focus-ring inline-flex h-8 items-center justify-center rounded-md border border-[#d0d5dd] bg-white px-2 text-xs font-bold text-[#344054] hover:bg-[#f8fafc]"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => applyDiscoveryPreset(preset, true)}
                        disabled={isRunningDiscovery}
                        className="focus-ring inline-flex h-8 items-center justify-center gap-1 rounded-md bg-[#2563eb] px-2 text-xs font-bold text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#98a2b3]"
                      >
                        <Play size={13} />
                        Run
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="hidden border-b border-[#e4e7ec] bg-[#fbfcff] p-3">
            <div className="grid gap-3 2xl:grid-cols-[minmax(220px,1fr)_360px_minmax(360px,1fr)] 2xl:items-center">
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#101828]">Control Panel / Run Health</div>
                <div className="mt-1 text-xs text-[#667085]">Client-safe runtime status. Internal integration names stay hidden.</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <HealthPill
                  icon={Database}
                  label="Database persistence"
                  connected={Boolean(runHealth?.databaseConnected)}
                  connectedText="Connected"
                  disconnectedText={runHealth === null ? "Checking" : runHealth?.databaseConfigured ? "Setup pending" : "Browser backup"}
                />
                <HealthPill
                  icon={Wifi}
                  label="Live discovery"
                  connected={liveDiscoveryConnected}
                  connectedText={isRunningDiscovery ? "Running" : "Connected"}
                  disconnectedText={discoveryRun?.error ? "Needs review" : "Ready to test"}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <RunHealthMetric label="Checked" value={runCheckedCount} />
                <RunHealthMetric label="Needs retry" value={runRetryCount} />
                <RunHealthMetric label="Skipped" value={runSkippedCount} />
                <RunHealthMetric label="Failed" value={runFailedCount} />
                <RunHealthMetric label="Saveable" value={runSaveableCandidateCount} />
                <RunHealthMetric label="Saved exact" value={runSavedCandidateCount} />
              </div>
            </div>
          </div>

          <details className="overflow-hidden border-b border-[#e4e7ec] bg-[#fbfcfe]">
            <summary className="grid cursor-pointer list-none gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <div className="text-sm font-bold text-[#101828]">Saved Search Library</div>
                <div className="mt-1 text-xs text-[#667085]">
                  {filteredSavedSearches.length} shown / {savedSearchLibrary.length} saved search{savedSearchLibrary.length === 1 ? "" : "es"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); saveCurrentSearch(); }} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-[#d0d5dd] bg-white px-3 text-xs font-bold text-[#344054] hover:bg-[#f8fafc]">
                  <Check size={14} />
                  Save search
                </button>
                <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); exportSavedSearches(); }} aria-label="Export saved searches" title="Export saved searches" className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#d0d5dd] bg-white text-[#344054] hover:bg-[#f8fafc]">
                  <Download size={14} />
                </button>
                <span className="rounded-md border border-[#d0d5dd] bg-white px-3 py-2 text-xs font-bold text-[#475467]">Open library</span>
              </div>
            </summary>
            <div className="border-t border-[#e4e7ec] p-3">
              <label className="flex h-9 min-w-[260px] items-center gap-2 rounded-md border border-[#d0d5dd] bg-white px-3">
                <Search size={14} className="text-[#667085]" />
                <input
                  value={savedSearchQuery}
                  onChange={(event) => setSavedSearchQuery(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                  placeholder="Filter saved searches"
                />
              </label>

            <div className="list-table-container mt-3">
              <table className="list-data-table saved-search-table w-full text-left text-sm">
                <thead className="bg-white text-xs uppercase text-[#667085]">
                  <tr>
                    <th className="px-3 py-2">Search</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Keywords</th>
                    <th className="px-3 py-2">Saved</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSavedSearches.map((search) => (
                    <tr key={search.id} className="border-t border-[#e4e7ec] align-top">
                      <td className="px-3 py-3">
                        <div className="font-bold text-[#101828]">{search.label}</div>
                        <div className="mt-1 max-w-[320px] text-xs leading-5 text-[#667085]">{search.query || "No free-text query"}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-[220px] flex-wrap gap-1">
                          {(search.regions.length ? search.regions : ["Any"]).map((region) => (
                            <span key={region} className="rounded-md border border-[#d0d5dd] bg-white px-2 py-1 text-xs font-semibold text-[#475467]">{region}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-[240px] flex-wrap gap-1">
                          {(search.keywords.length ? search.keywords : ["Any"]).map((keyword) => (
                            <span key={keyword} className="rounded-md border border-[#d0d5dd] bg-white px-2 py-1 text-xs font-semibold text-[#475467]">{keyword}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-[#667085]">{formatDateTime(search.createdAt)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => applySavedSearch(search)} className="focus-ring inline-flex h-8 items-center gap-1 rounded-md bg-[#2563eb] px-2 text-xs font-bold text-white hover:bg-[#1d4ed8]">
                            <Play size={13} />
                            Apply
                          </button>
                          <button type="button" onClick={() => deleteSavedSearch(search.id)} className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-red-200 bg-white px-2 text-xs font-bold text-red-700 hover:bg-red-50">
                            <X size={13} />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredSavedSearches.length === 0 ? (
              <div className="mt-3 rounded-md border border-[#e4e7ec] bg-white p-5 text-center text-sm text-[#667085]">No saved searches match this filter.</div>
            ) : null}
            </div>
          </details>

          {isRunningDiscovery || discoveryRun ? (
            <div className="order-2 mt-4 rounded-md border border-[#d0d5dd] bg-[#fbfcfe] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-[#101828]">Live Discovery Run</div>
                  <div className="mt-1 text-xs text-[#667085]">
                    {isRunningDiscovery
                      ? `${activeRunPlayLabel}: searching ${estimatedLiveQueryCount} focused quer${estimatedLiveQueryCount === 1 ? "y" : "ies"}, ranking sources, and extracting evidence.`
                      : discoveryRun?.error ?? `${activeRunPlayLabel}: ${discoveryRun?.discovered ?? 0} results found / ${discoveryRun?.attempted ?? 0} URLs checked${discoveryRun?.autoRecovery?.recoveryCandidateCount ? ` / ${discoveryRun.autoRecovery.recoveryCandidateCount} recovery checks` : ""}`}
                  </div>
                  {discoveryRun?.queries?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {discoveryRun.queries.map((item) => (
                        <span key={item} className="rounded border border-[#d0d5dd] bg-white px-2 py-1 text-[11px] font-semibold text-[#475467]">
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 rounded-md border border-[#dbeafe] bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="green">{activeRunPlayLabel}</Badge>
                      <span className="text-[11px] font-bold uppercase text-[#667085]">Play output</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[#475467]">{activeRunPlayOutput}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {activeRunPlayRules.slice(0, 6).map((rule) => (
                        <span key={`play-rule-${rule}`} className="rounded border border-[#bfdbfe] bg-[#eff6ff] px-2 py-0.5 text-[11px] font-bold text-[#1d4ed8]">
                          Evidence: {rule}
                        </span>
                      ))}
                    </div>
                  </div>
                  {discoveryRun?.intentClassification ? (
                    <div className="mt-3 rounded-md border border-[#dbeafe] bg-white p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={discoveryRun.intentClassification.strictness === "strict" ? "green" : discoveryRun.intentClassification.strictness === "balanced" ? "amber" : "neutral"}>
                          {discoveryRun.intentClassification.label}
                        </Badge>
                        <span className="text-[11px] font-bold uppercase text-[#667085]">{discoveryRun.intentClassification.strictness} matching</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-[#475467]">{discoveryRun.intentClassification.explanation}</p>
                      {discoveryRun.intentClassification.requiredTerms.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {discoveryRun.intentClassification.requiredTerms.slice(0, 8).map((term) => (
                            <span key={`intent-${term}`} className="rounded border border-[#bfdbfe] bg-[#eff6ff] px-2 py-0.5 text-[11px] font-bold text-[#1d4ed8]">
                              Must match: {term}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <Badge tone={isRunningDiscovery ? "amber" : discoveryRun?.ok ? "green" : "amber"}>{isRunningDiscovery ? "Running" : discoveryRun?.ok ? "Completed" : "Needs Review"}</Badge>
              </div>
              {isRunningDiscovery ? (
                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  {activeRunCopy.loadingSteps.map((step, index) => (
                    <div key={step} className="rounded-md border border-[#dbeafe] bg-white p-3">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#1d4ed8]">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[#2563eb]" style={{ animationDelay: `${index * 150}ms` }} />
                        {step}
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eff6ff]">
                        <div className="h-full w-2/3 animate-pulse rounded-full bg-[#93c5fd]" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {!isRunningDiscovery && discoveryRun && !discoveryRun.error ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  {runQualityStats.map((stat) => (
                    <div key={stat.label} className={`rounded-md border p-3 ${stat.tone === "green" ? "border-[#abefc6] bg-[#ecfdf3]" : stat.tone === "amber" ? "border-amber-200 bg-amber-50" : "border-[#e4e7ec] bg-white"}`}>
                      <div className="text-[11px] font-bold uppercase text-[#667085]">{stat.label}</div>
                      <div className="mt-1 text-lg font-bold text-[#101828]">{stat.value}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {clientAudit ? (
                <div className={`mt-3 rounded-md border p-3 ${
                  clientAudit.status === "ready"
                    ? "border-[#abefc6] bg-[#ecfdf3]"
                    : clientAudit.status === "blocked"
                      ? "border-red-200 bg-red-50"
                      : "border-amber-200 bg-amber-50"
                }`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className={`text-[11px] font-bold uppercase ${
                        clientAudit.status === "ready"
                          ? "text-[#067647]"
                          : clientAudit.status === "blocked"
                            ? "text-red-900"
                            : "text-amber-900"
                      }`}>
                        Client-safe audit
                      </div>
                      <div className="mt-1 text-base font-bold text-[#101828]">{clientAudit.label}</div>
                      <p className="mt-1 text-xs leading-5 text-[#475467]">{clientAudit.nextStep}</p>
                    </div>
                    <Badge tone={clientAudit.status === "ready" ? "green" : clientAudit.status === "blocked" ? "red" : "amber"}>{clientAudit.label}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {clientAudit.metrics.map((metric) => (
                      <div key={`client-audit-${metric.label}`} className="rounded-md border border-white/70 bg-white/80 p-2">
                        <div className="text-[11px] font-bold uppercase text-[#667085]">{metric.label}</div>
                        <div className="mt-1 text-xl font-bold text-[#101828]">{metric.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-md border border-[#abefc6] bg-white p-2">
                      <div className="text-[11px] font-bold uppercase text-[#067647]">What passed</div>
                      {clientAudit.passes.length ? (
                        <ul className="mt-2 space-y-1 text-xs leading-5 text-[#475467]">
                          {clientAudit.passes.map((item) => <li key={`client-audit-pass-${item}`}>- {item}</li>)}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs leading-5 text-[#667085]">No strong pass signals yet.</p>
                      )}
                    </div>
                    <div className="rounded-md border border-amber-200 bg-white p-2">
                      <div className="text-[11px] font-bold uppercase text-amber-900">What needs attention</div>
                      {clientAudit.failures.length ? (
                        <ul className="mt-2 space-y-1 text-xs leading-5 text-[#475467]">
                          {clientAudit.failures.map((item) => <li key={`client-audit-fail-${item}`}>- {item}</li>)}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs leading-5 text-[#667085]">No major blockers detected.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {runVerdict ? (
                <div className={`mt-3 rounded-md border p-3 ${runVerdict.status === "client_safe" ? "border-[#abefc6] bg-[#ecfdf3]" : runVerdict.status === "review" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase text-[#667085]">Run verdict</div>
                      <div className="mt-1 text-sm font-bold text-[#101828]">{runVerdict.label}</div>
                      <p className="mt-1 text-xs leading-5 text-[#475467]">Best match {runVerdict.bestScore}/100. {runVerdict.acceptedCount} accepted candidate{runVerdict.acceptedCount === 1 ? "" : "s"}. Minimum gate {runVerdict.minimumScore}/100.</p>
                    </div>
                    <Badge tone={runVerdict.status === "client_safe" ? "green" : runVerdict.status === "review" ? "amber" : "neutral"}>{runVerdict.label}</Badge>
                  </div>
                  {runVerdict.reasons.length ? (
                    <ul className="mt-3 grid gap-1 text-xs leading-5 text-[#344054] md:grid-cols-2">
                      {runVerdict.reasons.map((reason) => <li key={reason}>- {reason}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : null}              {runCoverage ? (
                <div className="mt-3 rounded-md border border-[#d0d5dd] bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold uppercase text-[#667085]">Search coverage</div>
                      <div className="mt-1 text-xs text-[#667085]">Source diversity and evidence health for this run.</div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={runCoverage.sourceDiversity >= 70 ? "green" : runCoverage.sourceDiversity >= 40 ? "amber" : "neutral"}>{runCoverage.sourceDiversity}/100 diversity</Badge>
                      <Badge tone={runCoverage.evidenceStrength >= 70 ? "green" : runCoverage.evidenceStrength >= 40 ? "amber" : "neutral"}>{runCoverage.evidenceStrength}/100 evidence</Badge>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <MiniMetric label="Domains checked" value={runCoverage.domainsChecked} />
                    <MiniMetric label="Source classes" value={runCoverage.sourceCategories.length} />
                    <MiniMetric label="Retry pressure" value={`${runCoverage.retryPressure}%`} />
                    <MiniMetric label="Rejected pressure" value={`${runCoverage.rejectionPressure}%`} />
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-2">
                      <div className="text-[11px] font-bold uppercase text-[#667085]">Source classes seen</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {runCoverage.sourceCategories.length ? runCoverage.sourceCategories.map((category) => (
                          <span key={`source-category-${category}`} className="rounded border border-[#d0d5dd] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#475467]">{category}</span>
                        )) : <span className="text-xs text-[#667085]">No source class passed ranking.</span>}
                      </div>
                    </div>
                    <div className="rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-2">
                      <div className="text-[11px] font-bold uppercase text-[#667085]">Evidence signals seen</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {runCoverage.evidenceSignals.length ? runCoverage.evidenceSignals.slice(0, 12).map((signal) => (
                          <span key={`evidence-signal-${signal}`} className="rounded border border-[#bfdbfe] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">{signal}</span>
                        )) : <span className="text-xs text-[#667085]">No evidence signals passed ranking.</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              {recoveryPlan ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-amber-950">Improve this search</div>
                      <p className="mt-1 text-xs leading-5 text-amber-900">This run needs a stronger follow-up before it is client-safe.</p>
                    </div>
                    <button type="button" onClick={() => runLiveDiscovery()} disabled={isRunningDiscovery} className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-amber-300 bg-white px-2 text-xs font-bold text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60">
                      <RefreshCw size={13} />
                      Retry same
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-md border border-amber-200 bg-white p-2">
                      <div className="text-[11px] font-bold uppercase text-amber-900">Why this run was weak</div>
                      <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-950">
                        {recoveryPlan.reasons.map((reason) => <li key={reason}>- {reason}</li>)}
                      </ul>
                    </div>
                    <div className="rounded-md border border-amber-200 bg-white p-2">
                      <div className="text-[11px] font-bold uppercase text-amber-900">One-click stronger reruns</div>
                      <div className="mt-2 grid gap-2">
                        {recoveryPlan.suggestedActions.map((suggestion) => (
                          <button
                            key={`${suggestion.query}-${suggestion.playId ?? activeRunPlayId}`}
                            type="button"
                            onClick={() => runLiveDiscovery({ query: suggestion.query, playId: suggestion.playId ?? activeRunPlayId })}
                            disabled={isRunningDiscovery}
                            className="focus-ring rounded-md border border-[#bfdbfe] bg-[#eff6ff] p-2 text-left hover:bg-[#dbeafe] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-[#1d4ed8]">{suggestion.label}</span>
                              {suggestion.playId && suggestion.playId !== activeRunPlayId ? <Badge tone="neutral">switch play</Badge> : null}
                            </div>
                            <div className="mt-1 text-[11px] font-semibold leading-4 text-[#344054]">{suggestion.query}</div>
                            <div className="mt-1 text-[11px] leading-4 text-[#667085]">{suggestion.why}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              {auditRows.length > 0 ? (
                <details className="mt-3 overflow-hidden rounded-md border border-[#d0d5dd] bg-white" open={retryAuditRows > 0 || saveableAuditRows === 0}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-3 text-xs font-bold text-[#344054]">
                    <span>Accuracy QA</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={saveableAuditRows > 0 ? "green" : "neutral"}>{saveableAuditRows} saveable</Badge>
                      <Badge tone={rejectedAuditRows > 0 ? "amber" : "neutral"}>{rejectedAuditRows} rejected</Badge>
                      <Badge tone={retryAuditRows > 0 ? "amber" : "neutral"}>{retryAuditRows} retry</Badge>
                      {retryAuditRows > 0 ? (
                        <button type="button" onClick={() => runLiveDiscovery()} disabled={isRunningDiscovery} className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60">
                          <RefreshCw size={13} />
                          Retry run
                        </button>
                      ) : null}
                    </span>
                  </summary>
                  <div className="border-t border-[#e4e7ec] bg-[#fbfcfe] p-3">
                    <p className="text-xs leading-5 text-[#667085]">
                      {activeRunCopy.qaText}
                    </p>
                    <div className="mt-3 grid gap-2">
                      {auditRows.map((row) => (
                        <div key={`audit-${row.item.url}`} className="rounded-md border border-[#e4e7ec] bg-white p-3">
                          <div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="max-w-[720px] truncate text-xs font-bold text-[#101828]">{row.item.title ?? row.item.url}</div>
                                <Badge tone={row.decisionTone}>{row.decision}</Badge>
                                {row.item.matchScore ? <Badge tone={row.item.matchScore.total >= 70 ? "green" : "amber"}>{row.item.matchScore.total}/100 match</Badge> : null}
                              </div>
                              <div className="mt-1 truncate text-xs text-[#667085]">{row.item.url}</div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <span className="rounded border border-[#d0d5dd] bg-[#f8fafc] px-2 py-0.5 text-[11px] font-bold text-[#475467]">{row.sourceQuality}</span>
                              <span className="rounded border border-[#d0d5dd] bg-[#f8fafc] px-2 py-0.5 text-[11px] font-bold text-[#475467]">Freshness: {row.freshness}</span>
                              <span className="rounded border border-[#d0d5dd] bg-[#f8fafc] px-2 py-0.5 text-[11px] font-bold text-[#475467]">Region: {row.regionStatus}</span>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            <div className="rounded-md border border-[#d1fadf] bg-[#f6fef9] p-2">
                              <div className="text-[11px] font-bold uppercase text-[#067647]">Matched terms</div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {row.matchedTerms.length > 0 ? row.matchedTerms.slice(0, 8).map((term) => (
                                  <span key={`${row.item.url}-matched-${term}`} className="rounded border border-[#abefc6] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#067647]">{term}</span>
                                )) : <span className="text-xs text-[#667085]">No required term match recorded.</span>}
                              </div>
                            </div>
                            <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
                              <div className="text-[11px] font-bold uppercase text-amber-900">Missing / weak terms</div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {row.missingTerms.length > 0 ? row.missingTerms.slice(0, 8).map((term) => (
                                  <span key={`${row.item.url}-missing-${term}`} className="rounded border border-amber-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900">{term}</span>
                                )) : <span className="text-xs text-[#667085]">No missing required terms.</span>}
                              </div>
                            </div>
                          </div>
                          {(row.item.reason || row.item.error) ? <div className="mt-2 text-xs leading-5 text-[#667085]">{row.item.error ?? row.item.reason}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              ) : null}
              {liveLeadCards.length > 0 ? (
                <div className="mt-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold uppercase text-[#667085]">{activeRunCopy.resultTitle}</div>
                      <div className="mt-1 text-xs text-[#667085]">{activeRunCopy.resultSubtitle}</div>
                    </div>
                    {discoveryRun?.queryMode ? <Badge tone={discoveryRun.queryMode === "project" ? "green" : "neutral"}>{discoveryRun.queryMode === "project" ? "Exact project mode" : "Broad keyword mode"}</Badge> : null}
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {liveLeadCards.map((lead) => {
                      const saveGate = candidateSaveGate({ lead, run: discoveryRun, playId: activeRunPlayId });
                      const saveDisabled = isLiveCandidateSaved(lead) || saveBlockedByWeakRun || saveGate.locked;
                      const saveTitle = saveBlockedByWeakRun
                        ? "Improve this search before saving candidates from a weak run."
                        : saveGate.locked
                          ? saveGate.reasons.join(" ")
                          : undefined;

                      return (
                      <div key={`${lead.sourceUrl}-${lead.companyName}`} className="rounded-md border border-[#d0d5dd] bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-[#101828]">{lead.companyName}</div>
                            <div className="mt-1 text-xs text-[#667085]">{lead.country}</div>
                          </div>
                          <Badge tone="green">{lead.signalType}</Badge>
                        </div>
                        <div className="mt-3 grid gap-2 rounded-md border border-[#dbeafe] bg-[#eff6ff] p-2 text-xs sm:grid-cols-[140px_minmax(0,1fr)]">
                          <div>
                            <div className="font-bold uppercase text-[#1d4ed8]">This will save as</div>
                            <div className="mt-1 font-bold text-[#101828]">Owner / buyer candidate</div>
                          </div>
                          <div className="leading-5 text-[#344054]">
                            Save creates one source-backed candidate for <strong>{lead.companyName}</strong> on <strong>{lead.projectName}</strong>. Awarded contractors below stay linked as the contractor layer; convert them from the detail page when you want contractor CRM leads.
                          </div>
                        </div>
                        <div className="mt-3 rounded-md bg-[#f8fafc] p-2">
                          <div className="text-xs font-bold uppercase text-[#667085]">{activeRunCopy.primaryBlockLabel}</div>
                          <div className="mt-1 text-sm font-semibold text-[#344054]">{lead.projectName}</div>
                        </div>
                        {lead.matchScore ? (
                          <div className="mt-3 rounded-md border border-[#dbeafe] bg-[#eff6ff] p-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-xs font-bold uppercase text-[#1d4ed8]">Match score</div>
                              <span className="rounded-md border border-[#bfdbfe] bg-white px-2 py-1 text-xs font-bold text-[#1d4ed8]">{lead.matchScore.total}/100</span>
                            </div>
                            {lead.matchScore.reasons.length ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {lead.matchScore.reasons.slice(0, 4).map((reason) => (
                                  <span key={`${lead.sourceUrl}-${reason}`} className="rounded border border-[#bfdbfe] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#344054]">
                                    {reason}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="mt-3 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-2">
                          <div className="text-xs font-bold uppercase text-[#667085]">Play evidence checklist</div>
                          <div className="mt-2 grid gap-1 sm:grid-cols-2">
                            {playCandidateEvidence(activeRunPlayId, lead).map((item) => (
                              <div key={`${lead.sourceUrl}-${item.label}`} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold ${item.passed ? "border-[#abefc6] bg-[#ecfdf3] text-[#067647]" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                                {item.passed ? <Check size={12} /> : <CircleSlash size={12} />}
                                {item.label}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className={`mt-3 rounded-md border p-2 ${saveGate.locked ? "border-amber-200 bg-amber-50" : "border-[#abefc6] bg-[#ecfdf3]"}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className={`text-xs font-bold uppercase ${saveGate.locked ? "text-amber-900" : "text-[#067647]"}`}>
                              Save lock
                            </div>
                            <Badge tone={saveGate.locked ? "amber" : "green"}>{saveGate.locked ? "Blocked from save" : "Save locked to search"}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {saveGate.badges.map((badge) => (
                              <span key={`${lead.sourceUrl}-save-gate-${badge.label}`} className={`rounded border px-2 py-0.5 text-[11px] font-bold ${badge.passed ? "border-[#abefc6] bg-white text-[#067647]" : "border-amber-200 bg-white text-amber-900"}`}>
                                {badge.label}
                              </span>
                            ))}
                          </div>
                          {saveGate.matchedTerms.length ? (
                            <div className="mt-2 text-[11px] font-semibold text-[#475467]">Matched search terms: {saveGate.matchedTerms.slice(0, 5).join(", ")}</div>
                          ) : null}
                          {saveGate.locked ? (
                            <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-4 text-amber-950">
                              {saveGate.reasons.slice(0, 3).map((reason) => <li key={`${lead.sourceUrl}-save-lock-${reason}`}>{reason}</li>)}
                            </ul>
                          ) : null}
                        </div>
                        <details className="mt-3 overflow-hidden rounded-md border border-[#d0d5dd] bg-white">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-2 text-xs font-bold text-[#344054]">
                            <span>Proof trail</span>
                            <span className="text-[11px] font-semibold text-[#667085]">Source-backed</span>
                          </summary>
                          <div className="border-t border-[#e4e7ec] bg-[#fbfcfe] p-2">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="rounded-md border border-[#e4e7ec] bg-white p-2">
                                <div className="text-[11px] font-bold uppercase text-[#667085]">Source class</div>
                                <div className="mt-1 text-xs font-bold text-[#101828]">{lead.sourceQuality?.category ?? "Source classified"}</div>
                                {lead.sourceReason ? <div className="mt-1 text-[11px] leading-4 text-[#667085]">{lead.sourceReason}</div> : null}
                              </div>
                              <div className="rounded-md border border-[#e4e7ec] bg-white p-2">
                                <div className="text-[11px] font-bold uppercase text-[#667085]">Matched signals</div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {(lead.sourceQuality?.matchedSignals ?? []).slice(0, 6).map((signal) => (
                                    <span key={`${lead.sourceUrl}-signal-${signal}`} className="rounded border border-[#bfdbfe] bg-[#eff6ff] px-2 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">{signal}</span>
                                  ))}
                                  {lead.sourceQuality?.matchedSignals?.length ? null : <span className="text-[11px] text-[#667085]">Signals inferred from source and score.</span>}
                                </div>
                              </div>
                            </div>
                            {lead.matchScore ? (
                              <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
                                {matchScoreBreakdown(lead).map((scoreItem) => (
                                  <div key={`${lead.sourceUrl}-score-${scoreItem.label}`} className="rounded-md border border-[#e4e7ec] bg-white p-2">
                                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-[#475467]"><span>{scoreItem.label}</span><span>{scoreItem.value}/{scoreItem.max}</span></div>
                                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef2f6]"><div className="h-full rounded-full bg-[#2563eb]" style={{ width: Math.min(100, Math.round((scoreItem.value / scoreItem.max) * 100)) + "%" }} /></div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </details>
                        <div className="mt-3 rounded-md border border-[#e4e7ec] bg-white p-2">
                          <div className="text-xs font-bold uppercase text-[#667085]">{activeRunCopy.packageBlockLabel}</div>
                          <div className="mt-2 space-y-2">
                            {lead.awardedContractors.length > 0 ? (
                              lead.awardedContractors.slice(0, 3).map((contractor) => (
                                <div key={`${lead.sourceUrl}-${contractor.name}`} className="rounded-md bg-[#f8fafc] px-2 py-1.5">
                                  <div className="text-xs font-bold text-[#101828]">{contractor.name}</div>
                                  <div className="mt-0.5 text-[11px] leading-4 text-[#667085]">{[contractor.role, contractor.scope, contractor.packageHint].filter(Boolean).join(" / ") || "Scope stated in source"}</div>
                                </div>
                              ))
                            ) : (
                              <div className="text-xs leading-5 text-[#667085]">Not extracted from this source yet. Open detail or source before outreach.</div>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {lead.requirements.length > 0 ? (
                            lead.requirements.slice(0, 3).map((requirement, index) => (
                              <span key={`${lead.companyName}-requirement-${index}`} className="rounded-md border border-[#d0d5dd] bg-[#fbfcfe] px-2 py-1 text-xs font-semibold text-[#475467]">
                                {[requirement.productCategory, requirement.productType, requirement.standard, requirement.grade, requirement.diameter, requirement.quantity ? `${requirement.quantity} ${requirement.unit ?? ""}` : ""]
                                  .filter(Boolean)
                                  .join(" / ")}
                              </span>
                            ))
                          ) : (
                            <span className="rounded-md border border-amber-700/20 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">Product details pending</span>
                          )}
                          <span className="rounded-md border border-[#d0d5dd] bg-[#fbfcfe] px-2 py-1 text-xs font-semibold text-[#475467]">Contact enrichment needed</span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-xs text-[#667085]">
                            Confidence {typeof lead.confidence === "number" ? `${Math.round(lead.confidence * 100)}%` : "pending"}
                          </span>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => saveLiveCandidate(lead)}
                              disabled={saveDisabled}
                              title={saveTitle}
                              className="focus-ring inline-flex h-8 items-center gap-1 rounded-md bg-[#2563eb] px-3 text-xs font-bold text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#98a2b3]"
                            >
                              <ListPlus size={13} />
                              {isLiveCandidateSaved(lead) ? "Saved" : saveBlockedByWeakRun ? "Improve first" : saveGate.locked ? "Locked by gate" : runVerdict?.status === "review" ? "Review & save" : "Save exact lead"}
                            </button>
                            <a href={lead.sourceUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-[#bfdbfe] bg-white px-2 text-xs font-bold text-[#1d4ed8] hover:bg-[#eff6ff]">
                              <ExternalLink size={13} />
                              Source
                            </a>
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {noFreshLeadFound ? (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
                  <div className="text-sm font-bold text-amber-950">No fresh matching lead found</div>
                  <p className="mt-1 text-xs leading-5 text-amber-900">
                    {activeRunCopy.emptyText} Nothing was saved automatically.
                  </p>
                  {discoveryRun?.requiredMatchTerms?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {discoveryRun.requiredMatchTerms.map((term) => (
                        <span key={term} className="rounded-md border border-amber-200 bg-white px-2 py-1 text-[11px] font-bold text-amber-900">
                          Required: {term}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {processedSources.length ? (
                <details className="mt-3 overflow-hidden rounded-md border border-[#e4e7ec] bg-white">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-[#344054]">
                    <span>Source review log</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={acceptedSources.length > 0 ? "green" : "neutral"}>{acceptedSources.length} accepted</Badge>
                      <Badge tone={reviewSources.length > 0 ? "amber" : "neutral"}>{reviewSources.length} rejected / retry</Badge>
                    </span>
                  </summary>
                  <div className="border-t border-[#e4e7ec] bg-[#fbfcfe] p-3">
                    <p className="text-xs leading-5 text-[#667085]">
                      Candidates above are the only saveable results. This log is kept for audit so skipped, stale, unsupported, or retry-needed sources do not look like leads.
                    </p>
                    {acceptedSources.length ? (
                      <div className="mt-3">
                        <div className="mb-2 text-[11px] font-bold uppercase text-[#667085]">Accepted evidence sources</div>
                        <div className="grid gap-2">
                          {acceptedSources.map((item) => (
                            <div key={item.url} className="flex flex-col gap-2 rounded-md border border-[#d1fadf] bg-white p-3 text-xs md:flex-row md:items-center md:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="max-w-[640px] truncate font-semibold text-[#344054]">{item.title ?? item.url}</div>
                                  {item.sourceQuality ? <span className="rounded border border-[#d0d5dd] bg-[#f8fafc] px-2 py-0.5 font-bold text-[#475467]">{item.sourceQuality.category}</span> : null}
                                  {item.matchScore ? <span className="rounded border border-[#bfdbfe] bg-[#eff6ff] px-2 py-0.5 font-bold text-[#1d4ed8]">{item.matchScore.total}/100 match</span> : null}
                                </div>
                                <div className="mt-1 truncate text-[#667085]">{item.url}</div>
                                {item.reason || item.error ? <div className="mt-1 text-[#667085]">{item.error ?? item.reason}</div> : null}
                              </div>
                              <Badge tone={discoveryStatusTone(item, savedDiscoveryCandidates)}>{discoveryStatusLabel(item, savedDiscoveryCandidates)}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {reviewSources.length ? (
                      <div className="mt-3">
                        <div className="mb-2 text-[11px] font-bold uppercase text-[#667085]">Rejected / retry sources</div>
                        <div className="grid gap-2">
                          {reviewSources.map((item) => (
                            <div key={item.url} className="flex flex-col gap-2 rounded-md border border-[#e4e7ec] bg-white p-3 text-xs md:flex-row md:items-center md:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="max-w-[640px] truncate font-semibold text-[#344054]">{item.title ?? item.url}</div>
                                  {item.sourceQuality ? <span className="rounded border border-[#d0d5dd] bg-[#f8fafc] px-2 py-0.5 font-bold text-[#475467]">{item.sourceQuality.category}</span> : null}
                                  {item.matchScore ? <span className="rounded border border-[#bfdbfe] bg-[#eff6ff] px-2 py-0.5 font-bold text-[#1d4ed8]">{item.matchScore.total}/100 match</span> : null}
                                </div>
                                <div className="mt-1 truncate text-[#667085]">{item.url}</div>
                                {item.reason || item.error ? <div className="mt-1 text-[#667085]">{item.error ?? item.reason}</div> : null}
                                {item.sourceQuality?.matchedSignals.length ? (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {item.sourceQuality.matchedSignals.slice(0, 6).map((signal) => (
                                      <span key={`${item.url}-${signal}`} className="rounded border border-[#d0d5dd] bg-[#fbfcfe] px-2 py-0.5 font-semibold text-[#475467]">{signal}</span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              <Badge tone={discoveryStatusTone(item, savedDiscoveryCandidates)}>{discoveryStatusLabel(item, savedDiscoveryCandidates)}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </section>

        {(clientReadySavedCandidates.length > 0 || clientReadyConvertedLeads.length > 0) ? (
          <details className="surface order-3 shrink-0 overflow-hidden rounded-lg">
            <summary className="flex cursor-pointer list-none flex-col justify-between gap-3 px-4 py-4 md:flex-row md:items-center">
              <div className="flex flex-col gap-1">
              <h2 className="font-bold">Advanced CRM Filters</h2>
              <p className="text-sm text-[#667085]">Filter saved candidates and converted leads by source-backed CRM fields.</p>
              </div>
              <span className="rounded-md border border-[#d0d5dd] bg-[#f8fafc] px-2.5 py-1 text-xs font-bold text-[#475467]">Open advanced filters</span>
            </summary>
            <div className="border-t border-[#e4e7ec] p-4">
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <CrmFilterInput label="Country / Region" value={crmCountryFilter} placeholder="Saudi, GCC, Canada..." onChange={setCrmCountryFilter} />
              <CrmFilterInput label="Project Type / Name" value={crmProjectFilter} placeholder="LNG, water, pipeline..." onChange={setCrmProjectFilter} />
              <CrmFilterInput label="Signal Type" value={crmSignalFilter} placeholder="EPC award, tender..." onChange={setCrmSignalFilter} />
              <CrmFilterInput label="Product Requirement" value={crmRequirementFilter} placeholder="API 5L, gas pipeline..." onChange={setCrmRequirementFilter} />
              <label className="block">
                <span className="text-xs font-bold uppercase text-[#667085]">Stage</span>
                <select value={candidateStageFilter} onChange={(event) => setCandidateStageFilter(event.target.value as CandidateStage | "All")} className="focus-ring mt-2 h-10 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-sm font-semibold text-[#344054]">
                  <option value="All">All stages</option>
                  {candidateStages.map((stage) => (
                    <option key={stage} value={stage}>{stage}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase text-[#667085]">Email Status</span>
                <select value={crmEmailFilter} onChange={(event) => setCrmEmailFilter(event.target.value as EmailPipelineStatus | "All")} className="focus-ring mt-2 h-10 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-sm font-semibold text-[#344054]">
                  <option value="All">All email statuses</option>
                  {emailPipelineStatuses.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase text-[#667085]">Min Confidence</span>
                <input type="number" min="0" max="100" value={crmMinConfidence} onChange={(event) => setCrmMinConfidence(Number(event.target.value))} className="focus-ring mt-2 h-10 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-sm outline-none" />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase text-[#667085]">Source Date From</span>
                <input type="date" value={crmSourceDateFilter} onChange={(event) => setCrmSourceDateFilter(event.target.value)} className="focus-ring mt-2 h-10 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-sm outline-none" />
              </label>
            </div>
            </div>
          </details>
        ) : null}

        {clientReadySavedCandidates.length > 0 ? (
          <details className="order-4 shrink-0 overflow-hidden rounded-lg border border-[#e4e7ec] bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none flex-col justify-between gap-3 px-4 py-4 md:flex-row md:items-center">
              <div>
                <h2 className="font-bold">Saved Discovery Candidates</h2>
                <p className="mt-1 text-sm text-[#667085]">
                  {filteredSavedCandidates.length} shown / {clientReadySavedCandidates.length} client-ready saved candidate{clientReadySavedCandidates.length === 1 ? "" : "s"}.
                </p>
                {hiddenSavedCandidateCount > 0 ? <p className="mt-1 text-xs text-[#667085]">{hiddenSavedCandidateCount} low-confidence saved row{hiddenSavedCandidateCount === 1 ? "" : "s"} hidden from client view.</p> : null}
              </div>
              <span className="rounded-md border border-[#d0d5dd] bg-[#f8fafc] px-2.5 py-1 text-xs font-bold text-[#475467]">Open candidates</span>
            </summary>
            <div className="border-t border-[#e4e7ec] p-4">
            <div className="flex flex-wrap justify-end gap-2">
                <select
                  value={candidateStageFilter}
                  onChange={(event) => setCandidateStageFilter(event.target.value as CandidateStage | "All")}
                  className="focus-ring h-9 rounded-md border border-[#d0d5dd] bg-white px-3 text-sm font-semibold text-[#344054]"
                >
                  <option value="All">All stages</option>
                  {candidateStages.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={exportSavedCandidates} className="focus-ring inline-flex h-9 w-fit items-center gap-2 rounded-md border border-[#d0d5dd] bg-white px-3 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]">
                  <Download size={15} />
                  Export Saved
                </button>
              </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {candidateStages.map((stage) => {
                const count = savedDiscoveryCandidates.filter((candidate) => candidate.stage === stage).length;
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => setCandidateStageFilter(stage)}
                    className={`focus-ring rounded-md border p-3 text-left ${
                      candidateStageFilter === stage ? "border-[#2563eb] bg-[#eff6ff]" : "border-[#d0d5dd] bg-[#fbfcfe] hover:bg-white"
                    }`}
                  >
                    <div className="text-xs font-bold uppercase text-[#667085]">{stage}</div>
                    <div className="mt-1 text-xl font-bold text-[#101828]">{count}</div>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 overflow-x-auto">
              <ResponsiveTable className="min-w-[1320px] w-full text-left text-sm">
                <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
                  <tr>
                    <th className="w-[180px] px-3 py-2">Company</th>
                    <th className="w-[250px] px-3 py-2">Relationship</th>
                    <th className="w-[220px] px-3 py-2">Project</th>
                    <th className="w-[240px] px-3 py-2">Awarded EPC / Contractors</th>
                    <th className="w-[220px] px-3 py-2">Requirement</th>
                    <th className="w-[150px] px-3 py-2">Signal</th>
                    <th className="w-[150px] px-3 py-2">Status</th>
                    <th className="w-[190px] px-3 py-2">Notes</th>
                    <th className="w-[150px] px-3 py-2">Lead</th>
                    <th className="w-[110px] px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSavedCandidates.map((candidate) => (
                    <tr key={candidate.id} className="border-t border-[#e4e7ec] align-top">
                      <td className="px-3 py-3">
                        <div className="font-bold text-[#101828]">{candidate.companyName}</div>
                        <div className="mt-1 text-xs text-[#667085]">{candidate.country}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={isContractorRecord(candidate) ? "green" : "neutral"}>{leadRelationshipLabel(candidate)}</Badge>
                        <div className="mt-2 max-w-[250px] text-xs leading-5 text-[#667085]">{leadRelationshipSummary(candidate)}</div>
                      </td>
                      <td className="max-w-[230px] px-3 py-3 text-[#344054]">{candidate.projectName}</td>
                      <td className="max-w-[260px] px-3 py-3 text-xs leading-5 text-[#475467]">{awardedContractorSummary(candidate.awardedContractors)}</td>
                      <td className="max-w-[230px] px-3 py-3 text-[#344054]">{candidate.requirementSummary}</td>
                      <td className="px-3 py-3">
                        <Badge tone="green">{candidate.signalType}</Badge>
                        <div className="mt-1 text-xs text-[#667085]">
                          Confidence {typeof candidate.confidence === "number" ? `${Math.round(candidate.confidence * 100)}%` : "pending"}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={candidate.stage}
                          onChange={(event) => updateCandidateStage(candidate.id, event.target.value as CandidateStage)}
                          className="focus-ring h-9 rounded-md border border-[#d0d5dd] bg-white px-2 text-xs font-bold text-[#344054]"
                        >
                          {candidateStages.map((stage) => (
                            <option key={stage} value={stage}>
                              {stage}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <input
                          value={candidate.notes ?? ""}
                          onChange={(event) => updateCandidateNotes(candidate.id, event.target.value)}
                          className="focus-ring h-9 w-full rounded-md border border-[#d0d5dd] bg-white px-2 text-xs outline-none"
                          placeholder="Owner, next step, package notes..."
                        />
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => convertCandidateToLead(candidate)}
                          className="focus-ring inline-flex min-h-9 min-w-[132px] items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-[#2563eb] px-3 py-2 text-xs font-bold leading-4 text-white hover:bg-[#1d4ed8]"
                          title={convertedLeadIds.has(candidate.id) ? "This evidence candidate is already a CRM lead." : `Convert this ${isContractorRecord(candidate) ? "contractor" : "owner/buyer"} candidate into the CRM pipeline.`}
                        >
                          <ListPlus size={13} className="shrink-0" />
                          <span>{convertedLeadIds.has(candidate.id) ? "Converted" : "Convert to Lead"}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-2">
                          <Link href={`/legacy/discovery/leads/${candidate.id}`} className="focus-ring inline-flex h-8 min-w-[82px] items-center justify-center gap-1 rounded-md bg-[#2563eb] px-2 text-xs font-bold text-white hover:bg-[#1d4ed8] whitespace-nowrap">
                            <ExternalLink size={13} />
                            Detail
                          </Link>
                          <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex h-8 min-w-[82px] items-center justify-center gap-1 rounded-md border border-[#bfdbfe] bg-white px-2 text-xs font-bold text-[#1d4ed8] hover:bg-[#eff6ff] whitespace-nowrap">
                            <ExternalLink size={13} />
                            Source
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
            {filteredSavedCandidates.length === 0 ? (
              <div className="mt-4 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-6 text-center text-sm text-[#667085]">
                No saved candidates in this stage yet.
              </div>
            ) : null}
            </div>
          </details>
        ) : null}

        {(contactEnrichmentJobs.length > 0 || emailVerificationJobs.length > 0) ? (
          <section className="order-5 shrink-0 rounded-lg border border-[#d0d5dd] bg-white p-4 shadow-sm">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <h2 className="font-bold">Enrichment Queues</h2>
                <p className="mt-1 text-sm text-[#667085]">
                  {pendingContactJobs.length} decision-maker job{pendingContactJobs.length === 1 ? "" : "s"} and {pendingEmailJobs.length} email job{pendingEmailJobs.length === 1 ? "" : "s"} waiting.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="amber">{contactEnrichmentJobs.length} contact jobs</Badge>
                <Badge tone="amber">{emailVerificationJobs.length} email jobs</Badge>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <ResponsiveTable className="w-full text-left text-sm">
                <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
                  <tr>
                    <th className="px-3 py-2">Queue</th>
                    <th className="px-3 py-2">Company / Project</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Queued</th>
                    <th className="px-3 py-2">Lead</th>
                  </tr>
                </thead>
                <tbody>
                  {latestQueueJobs.map((job) => (
                    <tr key={job.id} className="border-t border-[#e4e7ec] align-top">
                      <td className="px-3 py-3">
                        <Badge tone={job.id.startsWith("contact-enrichment") ? "green" : "amber"}>
                          {job.id.startsWith("contact-enrichment") ? "Decision Makers" : "Email Verify"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-bold text-[#101828]">{job.companyName}</div>
                        <div className="mt-1 max-w-[320px] text-xs leading-5 text-[#667085]">{job.projectName ?? "Project name pending"}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={job.error ? "red" : job.completedAt ? "green" : "amber"}>{job.error ? "Failed" : job.completedAt ? "Completed" : job.status}</Badge>
                      </td>
                      <td className="px-3 py-3 text-xs text-[#667085]">
                        {formatDateTime(job.queuedAt)}
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/legacy/discovery/leads/${job.leadId}`} className="focus-ring inline-flex h-8 min-w-[82px] items-center justify-center gap-1 rounded-md border border-[#bfdbfe] bg-white px-2 text-xs font-bold text-[#1d4ed8] hover:bg-[#eff6ff] whitespace-nowrap">
                          <ExternalLink size={13} />
                          Detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
          </section>
        ) : null}

        {clientReadyConvertedLeads.length > 0 ? (
          <section className="order-6 shrink-0 rounded-lg border border-[#d0d5dd] bg-white p-4 shadow-sm">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <h2 className="font-bold">Converted CRM Leads</h2>
                <p className="mt-1 text-sm text-[#667085]">
                  {filteredConvertedLeads.length} shown / {clientReadyConvertedLeads.length} client-ready converted company/project lead{clientReadyConvertedLeads.length === 1 ? "" : "s"}.
                </p>
                {hiddenConvertedLeadCount > 0 ? <p className="mt-1 text-xs text-[#667085]">{hiddenConvertedLeadCount} low-confidence converted row{hiddenConvertedLeadCount === 1 ? "" : "s"} hidden from client view.</p> : null}
              </div>
              <button type="button" onClick={exportConvertedLeads} className="control focus-ring inline-flex h-10 w-fit items-center gap-2 px-3 text-sm font-semibold">
                <Download size={15} />
                Export Leads
              </button>
            </div>

          <div className="mt-4 overflow-x-auto rounded-md border border-[#e4e7ec]">
              <ResponsiveTable className="min-w-[1220px] w-full text-left text-sm">
                <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
                  <tr>
                    <th className="w-[220px] px-3 py-2">Company / Project</th>
                    <th className="w-[250px] px-3 py-2">CRM Relationship</th>
                    <th className="w-[230px] px-3 py-2">Awarded EPC / Contractors</th>
                    <th className="w-[180px] px-3 py-2">CRM Stage</th>
                    <th className="w-[210px] px-3 py-2">Find Decision Makers</th>
                    <th className="w-[230px] px-3 py-2">Target Roles</th>
                    <th className="w-[190px] px-3 py-2">Email Verification</th>
                    <th className="w-[210px] px-3 py-2">Requirement</th>
                    <th className="w-[120px] px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredConvertedLeads.map((lead) => (
                    <tr key={lead.id} className="border-t border-[#e4e7ec] align-top">
                      <td className="px-3 py-3">
                        <div className="font-bold text-[#101828]">{lead.companyName}</div>
                        <div className="mt-1 max-w-[260px] text-xs leading-5 text-[#667085]">{lead.projectName}</div>
                        <div className="mt-2">
                          <Badge tone="green">{lead.signalType}</Badge>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={isContractorRecord(lead) ? "green" : "neutral"}>{leadRelationshipLabel(lead)}</Badge>
                        <div className="mt-2 max-w-[250px] text-xs leading-5 text-[#667085]">{leadRelationshipSummary(lead)}</div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-5 text-[#475467]">{awardedContractorSummary(lead.awardedContractors)}</td>
                      <td className="px-3 py-3">
                        <select
                          value={lead.crmStatus}
                          onChange={(event) => updateConvertedLeadStage(lead.id, event.target.value as CandidateStage)}
                          className="focus-ring h-9 min-w-[150px] rounded-md border border-[#d0d5dd] bg-white px-2 text-xs font-bold text-[#344054]"
                        >
                          {candidateStages.map((stage) => (
                            <option key={stage} value={stage}>
                              {stage}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-2">
                          <Badge tone={lead.enrichmentStatus === "Not Started" ? "neutral" : "amber"}>{lead.enrichmentStatus}</Badge>
                          {enrichedDecisionMakerCounts[lead.id] ? (
                            <Badge tone="green">{enrichedDecisionMakerCounts[lead.id]} contact{enrichedDecisionMakerCounts[lead.id] === 1 ? "" : "s"} saved</Badge>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => queueDecisionMakerSearch(lead.id)}
                            title={`Queue contact discovery for ${leadRelationshipLabel(lead).toLowerCase()}: ${lead.companyName}`}
                            className="focus-ring inline-flex h-8 min-w-[158px] items-center justify-center gap-1 rounded-md border border-[#bfdbfe] bg-white px-2 text-xs font-bold text-[#1d4ed8] hover:bg-[#eff6ff] whitespace-nowrap"
                          >
                            <Users size={13} />
                            Find Decision Makers
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-[250px] flex-wrap gap-1">
                          {lead.targetRoles.map((role) => (
                            <span key={role} className="rounded-md border border-[#d0d5dd] bg-[#fbfcfe] px-2 py-1 text-xs font-semibold text-[#475467]">
                              {role}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-2">
                          <Badge tone={emailTone(lead.emailStatus)} title="Updated by the email verification pipeline">{lead.emailStatus}</Badge>
                          <button
                            type="button"
                            onClick={() => queueLeadEmailVerification(lead.id)}
                            className="focus-ring inline-flex h-8 min-w-[118px] items-center justify-center gap-1 rounded-md bg-[#2563eb] px-2 text-xs font-bold text-white hover:bg-[#1d4ed8] whitespace-nowrap"
                          >
                            <MailCheck size={13} />
                            Queue Verify
                          </button>
                        </div>
                      </td>
                      <td className="max-w-[220px] px-3 py-3 text-[#344054]">{lead.requirementSummary}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-2">
                          <Link href={`/legacy/discovery/leads/${lead.id}`} className="focus-ring inline-flex h-8 min-w-[82px] items-center justify-center gap-1 rounded-md bg-[#2563eb] px-2 text-xs font-bold text-white hover:bg-[#1d4ed8] whitespace-nowrap">
                            <ExternalLink size={13} />
                            Detail
                          </Link>
                          <a href={lead.sourceUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex h-8 min-w-[82px] items-center justify-center gap-1 rounded-md border border-[#bfdbfe] bg-white px-2 text-xs font-bold text-[#1d4ed8] hover:bg-[#eff6ff] whitespace-nowrap">
                            <ExternalLink size={13} />
                            Source
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
            {filteredConvertedLeads.length === 0 ? (
              <div className="mt-4 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-6 text-center text-sm text-[#667085]">
                No converted leads match these CRM filters.
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="surface order-1 shrink-0 overflow-hidden rounded-xl">
          <div className="workspace-toolbar">
            <div className="grid gap-3">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-[#101828]">Search results</h2>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase text-[#667085]">
                    <span><strong className="text-[#101828]">{filteredRows.length}</strong> contacts / role targets</span>
                    <span><strong className="text-[#101828]">{selectedRows.length}</strong> selected</span>
                    {queuedOnPage ? <span>{queuedOnPage} review marks</span> : null}
                  </div>
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="control focus-ring h-10 w-full min-w-0 px-3 text-sm font-semibold sm:w-[180px]">
                    <option value="score">Sort by score</option>
                    <option value="company">Sort by company</option>
                    <option value="contact">Sort by contact</option>
                </select>
                {selectedRows.length > 0 ? <AddToLeadList contacts={selectedRows.map(({ contact, opportunity }) => ({ contactId: contact.id, leadId: opportunity.company.id }))} /> : null}
                {selectedRows.length > 0 ? <button type="button" disabled className="btn-quiet inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60" title="Email verification is not connected for research contacts">
                    <MailCheck size={15} />
                    Verification unavailable
                </button> : null}
                <button type="button" onClick={exportCsv} disabled={!rowsForAction(filteredRows, selected, (row) => row.contact.id).length} title="Research CSV; email addresses included only when verified" className="btn-quiet focus-ring inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-semibold disabled:opacity-50">
                    <Download size={15} />
                    Export {selected.length ? `selected (${selectedRows.length})` : `results (${filteredRows.length})`}
                </button>
                </div>
              </div>

              <div className="flex max-w-full flex-wrap items-center gap-1.5 border-t border-[#eef2f6] pt-3">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedOnPage} onChange={toggleAllRows} />Select visible results</label>
                  {selected.length > 0 ? <button type="button" onClick={() => setSelected([])} className="btn-quiet focus-ring rounded-md px-2 py-1 text-xs">Clear selection ({selected.length - selectedRows.length} hidden)</button> : null}
                  {activeFilters.slice(0, 7).map((filter) => (
                    <span key={filter} className="shrink-0 rounded-md border border-[#dbeafe] bg-[#eff6ff] px-2 py-1 text-xs font-bold text-[#1d4ed8]">
                      {filter}
                    </span>
                  ))}
                  {activeFilters.length > 7 ? (
                    <span className="shrink-0 rounded-md border border-[#e4e7ec] bg-white px-2 py-1 text-xs font-bold text-[#667085]">+{activeFilters.length - 7} more</span>
                  ) : null}
              </div>

            </div>
          </div>

          {activeResultTab === "results" ? (
            <>
          <div
            data-results-body="discovery"
            className="min-w-0"
          >
            <div data-results-pane="table" className="lead-table-container">
              <table className="lead-data-table discovery-data-table w-full border-collapse text-left text-sm">
                <thead className="table-head sticky top-0 z-10 text-[11px] uppercase">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <span className="sr-only">Selection</span>
                    </th>
                    <th className="px-3 py-2.5">Contact / Role target</th>
                    <th className="px-3 py-2.5">Company</th>
                    <th className="px-3 py-2.5">Email</th>
                    <th className="px-3 py-2.5">Intent Signal</th>
                    <th className="px-3 py-2.5">Score</th>
                    <th className="px-3 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(({ opportunity, contact }, index) => {
                    const isActive = activeLead?.contact.id === contact.id;
                    return (
                      <tr
                        key={contact.id}
                        onClick={() => setSelectedLeadId(contact.id)}
                        className={`cursor-pointer border-t border-[#eef2f6] align-middle transition-colors ${isActive ? "bg-[#eff6ff]" : "hover:bg-[#f8fafc]"}`}
                      >
                        <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                          <input type="checkbox" aria-label={`Select ${contact.name}`} checked={selected.includes(contact.id)} onChange={() => setSelected((current) => toggleValue(current, contact.id))} />
                        </td>
                        <td className="max-w-[230px] px-3 py-3">
                          <button type="button" onClick={() => setSelectedLeadId(contact.id)} className="focus-ring block w-full truncate text-left font-bold text-[#101828]" title={`Inspect ${contact.name}`}>{contact.name}</button>
                          <div className="mt-0.5 truncate text-xs text-[#667085]">{contact.title}</div>
                          <div className="mt-1 text-[11px] font-semibold uppercase text-[#98a2b3]">Result {index + 1} / {contact.department}</div>
                        </td>
                        <td className="max-w-[220px] px-3 py-3">
                          <div className="truncate font-bold text-[#101828]">{opportunity.company.canonicalName}</div>
                          <div className="mt-0.5 truncate text-xs text-[#667085]">{contact.location ?? opportunity.company.country} / {opportunity.company.industry}</div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={emailTone(contact.emailStatus)}>{contact.emailStatus}</Badge>
                          <div className="mt-1 max-w-[180px] truncate text-xs text-[#667085]">{contact.email ?? "Email not found"}</div>
                        </td>
                        <td className="max-w-[220px] px-3 py-3">
                          <div className="truncate font-semibold text-[#101828]">{opportunity.intentKeywords?.[0] ?? "Matched signal"}</div>
                          <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-[#667085]">{opportunity.matchedQuery}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="inline-flex h-8 min-w-10 items-center justify-center rounded-md border border-[#e4e7ec] bg-white px-2 text-xs font-bold text-[#101828]">
                            {opportunity.score.score}
                          </div>
                        </td>
                        <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                          <Link className="btn-primary focus-ring inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-bold" href={`/legacy/companies/${opportunity.company.id}`}>
                            <ExternalLink size={13} />
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <FilterDrawer open={Boolean(activeLead)} onClose={() => setSelectedLeadId(null)} title="Lead evidence">
              {activeLead ? (
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold uppercase text-[#667085]">Selected Account</div>
                      <h3 className="mt-1 truncate text-lg font-bold text-[#101828]">{activeLead.opportunity.company.canonicalName}</h3>
                      <p className="mt-1 text-sm leading-5 text-[#667085]">{activeLead.contact.title}</p>
                    </div>
                    <Badge tone={emailTone(activeLead.contact.emailStatus)}>{activeLead.contact.emailStatus}</Badge>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <MiniMetric label="Score" value={activeLead.opportunity.score.score} />
                    <MiniMetric label="Confidence" value={activeLead.opportunity.score.confidence} />
                  </div>

                  <div className="mt-4 rounded-md border border-[#e4e7ec] bg-white p-3">
                    <div className="text-xs font-bold uppercase text-[#667085]">Contact / Role target</div>
                    <div className="mt-2 font-bold text-[#101828]">{activeLead.contact.name}</div>
                    <div className="mt-1 text-sm text-[#667085]">{activeLead.contact.department} / {activeLead.contact.location ?? activeLead.opportunity.company.country}</div>
                    <div className="mt-3 flex gap-2">
                      {activeLead.contact.linkedinUrl ? (
                        <a className="btn-quiet focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-bold" href={activeLead.contact.linkedinUrl} target="_blank" rel="noreferrer">
                          <LinkIcon size={13} />
                          LinkedIn
                        </a>
                      ) : null}
                      <button
                        type="button"
                        disabled title="Email verification is not connected for research contacts"
                        className="btn-primary focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-bold"
                      >
                        <MailCheck size={13} />
                        Verification unavailable
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-md border border-[#e4e7ec] bg-white p-3">
                    <div className="text-xs font-bold uppercase text-[#667085]">Intent evidence</div>
                    <div className="mt-2 text-sm font-bold text-[#101828]">{activeLead.opportunity.intentKeywords?.[0] ?? "Matched signal"}</div>
                    <p className="mt-1 text-sm leading-5 text-[#667085]">{activeLead.opportunity.latestSignal.summary}</p>
                    <div className="mt-3 text-xs text-[#667085]">Matched query: <span className="font-semibold text-[#344054]">{activeLead.opportunity.matchedQuery}</span></div>
                  </div>

                  <div className="mt-3 rounded-md border border-[#e4e7ec] bg-white p-3">
                    <div className="text-xs font-bold uppercase text-[#667085]">Likely requirement</div>
                    <p className="mt-2 text-sm leading-5 text-[#344054]">{activeLead.opportunity.potentialProduct}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {activeLead.opportunity.requirements.slice(0, 4).map((requirement) => (
                        <span key={`${activeLead.opportunity.company.id}-${activeLead.contact.id}-${requirement.id}`} className="rounded-md border border-[#e4e7ec] bg-[#f8fafc] px-2 py-1 text-xs font-semibold text-[#475467]">
                          {requirement.productType}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 rounded-md border border-[#e4e7ec] bg-white p-3">
                    <div className="text-xs font-bold uppercase text-[#667085]">Buying committee</div>
                    <div className="mt-2 space-y-2">
                      {(activeLead.opportunity.decisionMakers ?? []).slice(0, 4).map((person) => (
                        <div key={person.id} className="flex items-center justify-between gap-2 rounded-md bg-[#f8fafc] px-2.5 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-bold text-[#101828]">{person.name}</div>
                            <div className="truncate text-[11px] text-[#667085]">{person.department} / {person.seniority}</div>
                          </div>
                          <Badge tone={emailTone(person.emailStatus)}>{person.emailStatus}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 rounded-md border border-[#dbeafe] bg-[#eff6ff] p-3">
                    <div className="text-xs font-bold uppercase text-[#1d4ed8]">Recommended next action</div>
                    <p className="mt-2 text-sm leading-5 text-[#1e3a8a]">Add the account to a focused list, then queue decision-maker verification before export.</p>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-sm text-[#667085]">Select a lead to inspect account evidence.</div>
              )}
            </FilterDrawer>
          </div>

          {filteredRows.length === 0 ? (
            <div className="border-t border-[#e4e7ec] p-8 text-center text-sm text-[#667085]">
              No discovery results match these filters. Clear filters or broaden the search.
            </div>
          ) : null}
            </>
          ) : (
            <LeadListWorkspace
              lists={leadLists}
              membership={listMembership}
              rows={allRows}
              selectedListId={selectedListId}
              onSelectList={setSelectedListId}
            />
          )}
        </section>
      </div>
    </section>
  );
}

function LeadListWorkspace({
  lists,
  membership,
  rows,
  selectedListId,
  onSelectList,
}: {
  lists: typeof leadLists;
  membership: Record<string, string[]>;
  rows: LeadRow[];
  selectedListId: string;
  onSelectList: (id: string) => void;
}) {
  const activeList = lists.find((list) => list.id === selectedListId) ?? lists[0];
  const knownContactIds = new Set(rows.map((row) => row.contact.id));
  const activeIds = new Set(visibleListIds(activeList.id, membership, knownContactIds));
  const listRows = rows.filter((row) => activeIds.has(row.contact.id));

  return (
    <div className="grid min-h-[520px] border-t border-[#e4e7ec] xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-b border-[#e4e7ec] bg-[#fbfcff] p-3 xl:border-b-0 xl:border-r">
        <div className="text-xs font-bold uppercase text-[#667085]">Saved Lists</div>
        <div className="mt-3 space-y-2">
          {lists.map((list) => {
            const count = visibleListIds(list.id, membership, knownContactIds).length;
            const active = list.id === activeList.id;
            return (
              <button
                key={list.id}
                type="button"
                onClick={() => onSelectList(list.id)}
                className={`focus-ring flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  active ? "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]" : "border-[#e4e7ec] bg-white text-[#344054] hover:bg-[#f8fafc]"
                }`}
              >
                <span className="font-bold">{list.name}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-[#667085]">{count}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="min-w-0 bg-white">
        <div className="flex flex-col justify-between gap-3 border-b border-[#e4e7ec] px-4 py-3 md:flex-row md:items-center">
          <div>
            <h3 className="font-bold text-[#101828]">{activeList.name}</h3>
            <p className="mt-1 text-sm text-[#667085]">{listRows.length} saved contact{listRows.length === 1 ? "" : "s"} ready for enrichment, verification, or export.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-md border border-[#dbeafe] bg-[#eff6ff] px-2 py-1 text-xs font-bold text-[#1d4ed8]">CRM-ready</span>
            <span className="rounded-md border border-[#e4e7ec] bg-[#f8fafc] px-2 py-1 text-xs font-bold text-[#475467]">Verified email scope</span>
          </div>
        </div>

        {listRows.length > 0 ? (
          <div className="overflow-x-auto">
            <ResponsiveTable className="w-full border-collapse text-left text-sm">
              <thead className="table-head text-[11px] uppercase">
                <tr>
                  <th className="px-4 py-2.5">Contact</th>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">Region</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Intent Signal</th>
                  <th className="px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map(({ opportunity, contact }) => (
                  <tr key={`${activeList.id}-${contact.id}`} className="border-t border-[#eef2f6] hover:bg-[#f8fafc]">
                    <td className="max-w-[220px] px-4 py-3">
                      <div className="truncate font-bold text-[#101828]">{contact.name}</div>
                      <div className="mt-0.5 truncate text-xs text-[#667085]">{contact.title}</div>
                    </td>
                    <td className="max-w-[220px] px-4 py-3">
                      <div className="truncate font-bold text-[#101828]">{opportunity.company.canonicalName}</div>
                      <div className="mt-0.5 truncate text-xs text-[#667085]">{opportunity.company.industry}</div>
                    </td>
                    <td className="px-4 py-3 text-[#344054]">{opportunity.company.region ?? opportunity.company.country}</td>
                    <td className="px-4 py-3">
                      <Badge tone={emailTone(contact.emailStatus)}>{contact.emailStatus}</Badge>
                    </td>
                    <td className="max-w-[220px] px-4 py-3">
                      <div className="truncate font-semibold text-[#101828]">{opportunity.intentKeywords?.[0] ?? "Matched signal"}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-[#667085]">{opportunity.matchedQuery}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link className="btn-primary focus-ring inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-bold" href={`/legacy/companies/${opportunity.company.id}`}>
                        <ExternalLink size={13} />
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-[#667085]">No leads are saved in this list yet. Select rows from Search Results, then use Add.</div>
        )}
      </div>
    </div>
  );
}

function FilterGroup({
  icon: Icon,
  label,
  options,
  selected,
  onToggle,
  defaultOpen = false,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group border-t border-[#e4e7ec] pt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-1 text-sm font-bold text-[#344054]">
        <span className="flex items-center gap-2">
          <Icon size={16} className="text-[#667085]" />
          {label}
        </span>
        <span className="text-xs font-semibold text-[#98a2b3]">{selected.length ? selected.length : "Any"}</span>
      </summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              className={`focus-ring rounded-md border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                active ? "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]" : "border-[#d0d5dd] bg-white text-[#475467] hover:bg-[#f8fafc]"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </details>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="focus-ring flex w-full items-center justify-between rounded-md px-1 py-1 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]">
      <span>{label}</span>
      <span className={`relative inline-flex h-6 w-11 items-center rounded-full ${checked ? "bg-[#2563eb]" : "bg-[#d0d5dd]"}`}>
        <span className={`h-4 w-4 rounded-full bg-white shadow-sm ${checked ? "ml-6" : "ml-1"}`} />
      </span>
    </button>
  );
}

function CustomFilterInput({
  label,
  value,
  placeholder,
  onChange,
  onAdd,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase text-[#667085]">{label}</span>
      <span className="mt-2 flex min-h-10 items-center overflow-hidden rounded-md border border-[#d0d5dd] bg-white">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          }}
          className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
          placeholder={placeholder}
        />
        <button type="button" onClick={onAdd} className="btn-primary focus-ring mr-1 inline-flex h-8 items-center rounded-md px-3 text-xs font-bold">
          Add
        </button>
      </span>
    </label>
  );
}

function CrmFilterInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase text-[#667085]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="focus-ring mt-2 h-10 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-sm outline-none"
        placeholder={placeholder}
      />
    </label>
  );
}

function HealthPill({
  icon: Icon,
  label,
  connected,
  connectedText,
  disconnectedText,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  connected: boolean;
  connectedText: string;
  disconnectedText: string;
}) {
  const StatusIcon = connected ? CircleCheck : CircleSlash;

  return (
    <div className="flex min-h-10 items-center gap-2 rounded-md border border-[#d0d5dd] bg-white px-3 py-2">
      <Icon size={15} className="text-[#667085]" />
      <div>
        <div className="text-[11px] font-bold uppercase text-[#667085]">{label}</div>
        <Badge tone={runHealthTone(connected)}>
          <StatusIcon size={12} />
          {connected ? connectedText : disconnectedText}
        </Badge>
      </div>
    </div>
  );
}

function RunHealthMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[118px] rounded-md border border-[#e4e7ec] bg-white px-3 py-2">
      <div className="text-[11px] font-bold uppercase text-[#667085]">{label}</div>
      <div className="mt-1 text-lg font-bold text-[#101828]">{value}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-[#e4e7ec] bg-white p-3">
      <div className="text-[11px] font-bold uppercase text-[#667085]">{label}</div>
      <div className="mt-1 truncate text-base font-bold text-[#101828]">{value}</div>
    </div>
  );
}
