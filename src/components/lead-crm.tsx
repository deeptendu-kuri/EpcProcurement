"use client";

import Link from "next/link";
import { useWorkspaceView } from "@/components/workspace-view";
import { ResponsiveTable } from "@/components/responsive-table";
import { mergeWorkspaceCache, rowsForAction } from "@/lib/crm-workspace";
import { FilterDrawer } from "@/components/filter-drawer";
import { AddToLeadList } from "@/components/add-to-lead-list";
import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Filter,
  LinkIcon,
  MailCheck,
  Search,
  UserCheck,
  X,
} from "lucide-react";
import { Badge } from "@/components/badge";
import { Metric } from "@/components/metric";
import type { BuyerOpportunity, CrmStatus, DecisionMaker, EmailVerificationStatus } from "@/types/domain";

interface LeadCrmProps {
  opportunities: BuyerOpportunity[];
}

interface LeadRow {
  opportunity: BuyerOpportunity;
  contact: DecisionMaker;
}

type SortMode = "score" | "company" | "contact";
type CandidateStage = "New" | "Researching" | "Contact Needed" | "Qualified" | "Rejected";
type EmailPipelineStatus = "Email Not Found" | "Search Queued" | "Verification Pending" | "Verified" | "Risky";

interface PersistedCrmState {
  listMembership: Record<string, string[]>;
  emailVerificationQueue: string[];
  crmStatusOverrides: Record<string, CrmStatus>;
  savedDiscoveryCandidates?: SavedDiscoveryCandidate[];
  convertedDiscoveryLeads?: ConvertedDiscoveryLead[];
}

interface CrmSnapshotResponse {
  ok: boolean;
  mode?: string;
  candidates?: SavedDiscoveryCandidate[];
  convertedLeads?: ConvertedDiscoveryLead[];
  decisionMakers?: EnrichedDecisionMaker[];
}

interface EnrichedDecisionMaker {
  id: string;
  leadId: string;
  companyName: string;
  name: string;
  title: string;
  department?: string;
  seniority?: string;
  location?: string;
  emailStatus: EmailPipelineStatus;
  email?: string;
  linkedinUrl?: string;
  phone?: string;
  phoneStatus?: string;
  linkedinStatus?: string;
  dataSourceType?: string;
  confidence?: number;
  evidenceSignals?: string[];
  evidenceNotes?: string;
  emailCandidateType?: string;
  verificationSource?: string;
  sourceUrl?: string;
  createdAt?: string;
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

const regionOptions = ["Mexico", "GCC", "Saudi Arabia", "UAE", "USA", "North America"];
const departmentOptions = ["Procurement", "Projects", "Engineering", "Supply Chain", "Operations", "Executive"];
const industryOptions = ["Oil & Gas", "EPC", "Utilities", "Infrastructure"];
const keywordOptions = ["Sierra Madre Pipeline", "pipeline EPC", "API 5L", "gas pipeline materials", "tender"];
const emailOptions: EmailVerificationStatus[] = ["Verified", "Unknown", "Risky", "Not Found"];
const crmStorageKey = "industrialBuyerCrmState.v1";
const defaultListMembership: Record<string, string[]> = {
  "priority-pipeline": ["contact-mexico-pacific-nelly-molina", "contact-mexico-pacific-faith-parker", "contact-mexico-pacific-percival-cleetus"],
  procurement: ["contact-mexico-pacific-procurement-target"],
  "project-owners": ["contact-mexico-pacific-percival-cleetus"],
};

const candidateStages: CandidateStage[] = ["New", "Researching", "Contact Needed", "Qualified", "Rejected"];
const emailPipelineStatuses: EmailPipelineStatus[] = ["Email Not Found", "Search Queued", "Verification Pending", "Verified", "Risky"];
const targetDecisionMakerRoles = ["Procurement Head", "Project Director", "Supply Chain Manager", "Engineering Manager", "CEO / Managing Director"];

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
  if (status === "Not Found" || status === "Email Not Found") return "red";
  return "neutral";
}

function contactTrustLabel(person: EnrichedDecisionMaker) {
  if (person.emailStatus === "Verified" || person.phoneStatus === "Verified") return "Verified contact";
  if (person.email || person.phone) return "Direct contact candidate";
  if (person.linkedinUrl) return "Profile-backed candidate";
  return "Source-backed candidate";
}

function contactTrustTone(person: EnrichedDecisionMaker) {
  if (person.emailStatus === "Verified" || person.phoneStatus === "Verified") return "green";
  if (person.email || person.phone || person.linkedinUrl) return "amber";
  return "neutral";
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function matchesAny(value: string | undefined, selected: string[]) {
  if (selected.length === 0) return true;
  return selected.some((item) => value?.toLowerCase().includes(item.toLowerCase()));
}

function csvEscape(value: string | number | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function normalizeSavedCandidate(candidate: SavedDiscoveryCandidate): SavedDiscoveryCandidate {
  return {
    ...candidate,
    leadType: candidate.leadType ?? (candidate.parentCompanyName ? "contractor" : "owner"),
    stage: candidateStages.includes(candidate.stage) ? candidate.stage : "New",
    notes: candidate.notes ?? "",
  };
}

function normalizeConvertedLead(lead: ConvertedDiscoveryLead): ConvertedDiscoveryLead {
  return {
    ...normalizeSavedCandidate(lead),
    crmStatus: candidateStages.includes(lead.crmStatus) ? lead.crmStatus : "Contact Needed",
    enrichmentStatus: lead.enrichmentStatus ?? "Not Started",
    emailStatus: emailPipelineStatuses.includes(lead.emailStatus) ? lead.emailStatus : "Email Not Found",
    targetRoles: Array.isArray(lead.targetRoles) && lead.targetRoles.length > 0 ? lead.targetRoles : targetDecisionMakerRoles,
    convertedAt: lead.convertedAt ?? lead.savedAt,
  };
}

export function LeadCrm({ opportunities }: LeadCrmProps) {
  const [query, setQuery] = useState("");
  const [regions, setRegions] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [emailStatuses, setEmailStatuses] = useState<string[]>([]);
  const [confidence, setConfidence] = useState("");
  const [minScore, setMinScore] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [hasLinkedIn, setHasLinkedIn] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [oneLeadPerCompany, setOneLeadPerCompany] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const [selected, setSelected] = useState<string[]>([]);
  const [listMembership, setListMembership] = useState<Record<string, string[]>>(defaultListMembership);
  const [emailVerificationQueue, setEmailVerificationQueue] = useState<string[]>([]);
  const [crmStatusOverrides, setCrmStatusOverrides] = useState<Record<string, CrmStatus>>({});
  const [savedDiscoveryCandidates, setSavedDiscoveryCandidates] = useState<SavedDiscoveryCandidate[]>([]);
  const [convertedDiscoveryLeads, setConvertedDiscoveryLeads] = useState<ConvertedDiscoveryLead[]>([]);
  const [enrichedDecisionMakers, setEnrichedDecisionMakers] = useState<EnrichedDecisionMaker[]>([]);
  const [enrichedContactQuery, setEnrichedContactQuery] = useState("");
  const [enrichedContactEmailFilter, setEnrichedContactEmailFilter] = useState<EmailPipelineStatus | "All">("All");
  const [enrichedContactRoleFilter, setEnrichedContactRoleFilter] = useState("");
  const [enrichedContactsWithLinkedIn, setEnrichedContactsWithLinkedIn] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useWorkspaceView("crmView.v1", { query, regions, departments, industries, keywords, emailStatuses, confidence, minScore, verifiedOnly, hasLinkedIn, emailVerified, oneLeadPerCompany, sortMode }, (view) => {
    setQuery(view.query); setRegions(view.regions); setDepartments(view.departments);
    setIndustries(view.industries); setKeywords(view.keywords); setEmailStatuses(view.emailStatuses);
    setConfidence(view.confidence); setMinScore(view.minScore); setVerifiedOnly(view.verifiedOnly);
    setHasLinkedIn(view.hasLinkedIn); setEmailVerified(view.emailVerified); setOneLeadPerCompany(view.oneLeadPerCompany); setSortMode(view.sortMode);
  });

  const allRows = useMemo(() => leadRows(opportunities), [opportunities]);

  const rowsWithOverrides = useMemo(
    () =>
      allRows.map(({ opportunity, contact }) => ({
        opportunity,
        contact: {
          ...contact,
          emailStatus: contact.emailStatus,
        },
        crmStatus: crmStatusOverrides[contact.id] ?? opportunity.crmStatus ?? "New",
      })),
    [allRows, crmStatusOverrides],
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rows = rowsWithOverrides
      .filter(({ opportunity, contact }) => {
        if (verifiedOnly && opportunity.verificationStatus !== "Verified Lead") return false;
        if (hasLinkedIn && !contact.linkedinUrl) return false;
        if (emailVerified && contact.emailStatus !== "Verified") return false;
        if (confidence && opportunity.score.confidence !== confidence) return false;
        if (minScore && opportunity.score.score < Number(minScore)) return false;
        if (!matchesAny(opportunity.company.country, regions) && !matchesAny(opportunity.company.region, regions)) return false;
        if (!matchesAny(contact.department, departments)) return false;
        if (!matchesAny(opportunity.company.industry, industries) && !matchesAny(opportunity.company.subIndustry, industries)) return false;
        if (emailStatuses.length > 0 && !emailStatuses.includes(contact.emailStatus)) return false;
        if (keywords.length > 0 && !keywords.some((keyword) => (opportunity.intentKeywords ?? []).join(" ").toLowerCase().includes(keyword.toLowerCase()))) return false;
        if (!normalizedQuery) return true;

        return [
          contact.name,
          contact.title,
          contact.department,
          opportunity.company.canonicalName,
          opportunity.company.industry,
          opportunity.company.subIndustry,
          opportunity.company.country,
          opportunity.company.region,
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
  }, [confidence, departments, emailStatuses, emailVerified, hasLinkedIn, industries, keywords, minScore, oneLeadPerCompany, query, regions, rowsWithOverrides, sortMode, verifiedOnly]);

  const selectedRows = filteredRows.filter((row) => selected.includes(row.contact.id));
  const selectedOnPage = filteredRows.length > 0 && filteredRows.every((row) => selected.includes(row.contact.id));
  const enrichedContacts = rowsWithOverrides.filter((row) => row.contact.emailStatus === "Verified").length;
  const queuedContacts = emailVerificationQueue.length;
  const discoveryEmailQueued = convertedDiscoveryLeads.filter((lead) => ["Search Queued", "Verification Pending"].includes(lead.emailStatus)).length;
  const enrichedVerifiedEmails = enrichedDecisionMakers.filter((person) => person.emailStatus === "Verified").length;
  const verifiedPipelineTotal = new Set([
    ...opportunities.map((opportunity) => opportunity.company.canonicalName),
    ...convertedDiscoveryLeads.map((lead) => lead.companyName),
  ].map((name) => name.trim().toLowerCase())).size;
  const convertedLeadById = new Map(convertedDiscoveryLeads.map((lead) => [lead.id, lead]));
  const filteredEnrichedDecisionMakers = enrichedDecisionMakers.filter((person) => {
    const parentLead = convertedLeadById.get(person.leadId);
    const searchable = [
      person.name,
      person.title,
      person.department,
      person.seniority,
      person.companyName,
      parentLead?.projectName,
      parentLead?.country,
      person.location,
      person.verificationSource,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (enrichedContactQuery.trim() && !searchable.includes(enrichedContactQuery.trim().toLowerCase())) return false;
    if (enrichedContactEmailFilter !== "All" && person.emailStatus !== enrichedContactEmailFilter) return false;
    if (enrichedContactRoleFilter.trim() && !`${person.title} ${person.department} ${person.seniority}`.toLowerCase().includes(enrichedContactRoleFilter.trim().toLowerCase())) return false;
    if (enrichedContactsWithLinkedIn && !person.linkedinUrl) return false;
    return true;
  });

  const activeFilters = [
    ...regions,
    ...departments,
    ...industries,
    ...keywords,
    ...emailStatuses,
    confidence ? `${confidence} confidence` : "",
    minScore ? `${minScore}+ score` : "",
    hasLinkedIn ? "Has LinkedIn" : "",
    emailVerified ? "Email Verified" : "",
    oneLeadPerCompany ? "One Lead Per Company" : "",
  ].filter(Boolean);

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
    }

    void loadDatabaseState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const payload: PersistedCrmState = { listMembership, emailVerificationQueue, crmStatusOverrides, savedDiscoveryCandidates, convertedDiscoveryLeads };
    window.localStorage.setItem(crmStorageKey, mergeWorkspaceCache(window.localStorage.getItem(crmStorageKey), payload));
  }, [convertedDiscoveryLeads, crmStatusOverrides, emailVerificationQueue, isHydrated, listMembership, savedDiscoveryCandidates]);

  function clearFilters() {
    setQuery("");
    setRegions([]);
    setDepartments([]);
    setIndustries([]);
    setKeywords([]);
    setEmailStatuses([]);
    setConfidence("");
    setMinScore("");
    setHasLinkedIn(false);
    setEmailVerified(false);
    setOneLeadPerCompany(false);
    setSelected([]);
    setVerifiedOnly(true);
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
    const header = ["name", "title", "company", "location", "email", "email_status", "source_url", "linkedin", "intent_keyword", "matched_query", "score", "crm_status"];
    const body = rowsToExport.map(({ opportunity, contact, crmStatus }) =>
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
        crmStatus,
      ]
        .map(csvEscape)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "industrial-buyer-leads.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportEnrichedContacts() {
    const header = ["name", "title", "department", "seniority", "company", "project", "location", "email", "email_status", "email_candidate_type", "linkedin", "linkedin_status", "phone", "phone_status", "data_source", "confidence", "verification_source", "source_url", "evidence_notes"];
    const body = filteredEnrichedDecisionMakers.map((person) => {
      const parentLead = convertedLeadById.get(person.leadId);
      return [
        person.name,
        person.title,
        person.department,
        person.seniority,
        person.companyName,
        parentLead?.projectName,
        person.location,
        person.email,
        person.emailStatus,
        person.emailCandidateType,
        person.linkedinUrl,
        person.linkedinStatus,
        person.phone,
        person.phoneStatus,
        person.dataSourceType,
        person.confidence,
        person.verificationSource,
        person.sourceUrl,
        person.evidenceNotes,
      ]
        .map(csvEscape)
        .join(",");
    });
    const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "enriched-decision-makers.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function updateStatus(contactId: string, status: CrmStatus) {
    setCrmStatusOverrides((current) => ({ ...current, [contactId]: status }));
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Pipeline accounts" value={verifiedPipelineTotal} detail="Verified + converted" />
        <Metric label="Contacts / roles" value={filteredRows.length} detail="Named contacts and research targets" />
        <Metric label="Email review" value={discoveryEmailQueued} detail="Unverified discovered leads" />
        <Metric label="Verified emails" value={enrichedContacts + enrichedVerifiedEmails} detail="No fabricated emails" />
      </section>

      {enrichedDecisionMakers.length > 0 ? (
        <section className="surface rounded-xl p-4">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
            <div>
              <h2 className="font-bold text-[#101828]">Found Decision Makers</h2>
              <p className="mt-1 text-sm text-[#667085]">
                {filteredEnrichedDecisionMakers.length} shown / {enrichedDecisionMakers.length} saved contacts from converted discovery leads.
              </p>
            </div>
            <button type="button" onClick={exportEnrichedContacts} className="btn-quiet focus-ring inline-flex h-9 w-fit items-center gap-2 rounded-md px-3 text-sm font-semibold">
              <Download size={15} />
              Export Contacts
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="block">
              <span className="text-xs font-bold uppercase text-[#667085]">Search Contacts</span>
              <input value={enrichedContactQuery} onChange={(event) => setEnrichedContactQuery(event.target.value)} className="focus-ring mt-2 h-10 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-sm outline-none" placeholder="Name, company, project" />
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase text-[#667085]">Role Contains</span>
              <input value={enrichedContactRoleFilter} onChange={(event) => setEnrichedContactRoleFilter(event.target.value)} className="focus-ring mt-2 h-10 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-sm outline-none" placeholder="Procurement, director, CEO" />
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase text-[#667085]">Email Status</span>
              <select value={enrichedContactEmailFilter} onChange={(event) => setEnrichedContactEmailFilter(event.target.value as EmailPipelineStatus | "All")} className="focus-ring mt-2 h-10 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-sm outline-none">
                <option value="All">All statuses</option>
                {emailPipelineStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
            <div className="flex items-end">
              <Toggle label="Has LinkedIn" checked={enrichedContactsWithLinkedIn} onChange={setEnrichedContactsWithLinkedIn} />
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <ResponsiveTable className="w-full text-left text-sm">
              <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
                <tr>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Account / Project</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">LinkedIn</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Lead</th>
                </tr>
              </thead>
              <tbody>
                {filteredEnrichedDecisionMakers.slice(0, 12).map((person) => {
                  const parentLead = convertedLeadById.get(person.leadId);
                  return (
                    <tr key={person.id} className="border-t border-[#e4e7ec] align-top">
                      <td className="px-3 py-3">
                        <div className="font-bold text-[#101828]">{person.name}</div>
                        <div className="mt-1 text-xs text-[#667085]">{person.location ?? parentLead?.country ?? "Location pending"}</div>
                        <div className="mt-2">
                          <Badge tone={contactTrustTone(person)}>{contactTrustLabel(person)}</Badge>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-[#344054]">{person.title}</div>
                        <div className="mt-1 text-xs text-[#667085]">{person.department ?? "Department pending"} / {person.seniority ?? "Seniority pending"}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-bold text-[#101828]">{person.companyName}</div>
                        <div className="mt-1 max-w-[260px] text-xs leading-5 text-[#667085]">{parentLead?.projectName ?? "Project pending"}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={emailTone(person.emailStatus)}>{person.emailStatus}</Badge>
                        <div className="mt-1 text-xs text-[#667085]">{person.email ?? "No email displayed"}</div>
                        <div className="mt-1 text-xs text-[#667085]">{person.phone ?? "No phone found"}</div>
                      </td>
                      <td className="px-3 py-3">
                        {person.linkedinUrl ? (
                          <a href={person.linkedinUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d5dd] bg-white px-2 text-xs font-bold text-[#0b66c3] hover:bg-[#f8fafc]">
                            <LinkIcon size={13} />
                            Open
                          </a>
                        ) : <span className="text-xs text-[#667085]">Not found</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-xs font-semibold text-[#344054]">{person.verificationSource ?? "Source pending"}</div>
                        <div className="mt-1 text-xs text-[#667085]">{person.dataSourceType ?? "Manual research"} · {person.confidence ?? 50}% confidence</div>
                        {person.evidenceSignals?.length ? (
                          <div className="mt-2 flex max-w-[260px] flex-wrap gap-1">
                            {person.evidenceSignals.slice(0, 3).map((signal) => (
                              <span key={`${person.id}-${signal}`} className="rounded border border-[#d0d5dd] bg-[#f8fafc] px-2 py-0.5 text-[11px] font-semibold text-[#475467]">{signal}</span>
                            ))}
                          </div>
                        ) : null}
                        {person.sourceUrl ? <a href={person.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-[#2563eb]">Evidence</a> : null}
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/legacy/discovery/leads/${person.leadId}`} className="focus-ring inline-flex h-8 items-center gap-1 rounded-md bg-[#2563eb] px-2 text-xs font-bold text-white hover:bg-[#1d4ed8]">
                          <ExternalLink size={13} />
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </ResponsiveTable>
          </div>
          {filteredEnrichedDecisionMakers.length === 0 ? (
            <div className="mt-4 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-5 text-center text-sm text-[#667085]">No enriched contacts match these filters.</div>
          ) : null}
        </section>
      ) : null}

      {convertedDiscoveryLeads.length > 0 ? (
        <details className="surface group rounded-xl">
          <summary className="flex cursor-pointer list-none flex-col justify-between gap-3 p-4 md:flex-row md:items-center">
            <div>
              <h2 className="font-bold text-[#101828]">Recent Converted Discovery Leads</h2>
              <p className="mt-1 text-sm text-[#667085]">Owner and contractor CRM leads created from live discovery. Contractor rows stay linked to their parent project for enrichment work.</p>
            </div>
            <span className="text-xs font-bold uppercase text-[#2563eb] group-open:hidden">Show {convertedDiscoveryLeads.length} leads</span>
            <span className="hidden text-xs font-bold uppercase text-[#2563eb] group-open:inline">Hide leads</span>
          </summary>
          <div className="overflow-x-auto border-t border-[#e4e7ec]">
            <ResponsiveTable className="w-full text-left text-sm">
              <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
                <tr>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Relationship</th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Enrichment</th>
                  <th className="px-3 py-2">Contacts</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Requirement</th>
                  <th className="px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {convertedDiscoveryLeads.slice(0, 5).map((lead) => (
                  <tr key={lead.id} className="border-t border-[#e4e7ec] align-top">
                    <td className="px-3 py-3">
                      <div className="font-bold text-[#101828]">{lead.companyName}</div>
                      <div className="mt-1 text-xs text-[#667085]">{lead.country}</div>
                    </td>
                    <td className="max-w-[230px] px-3 py-3">
                      <Badge tone={lead.leadType === "contractor" || lead.parentCompanyName ? "green" : "neutral"}>
                        {lead.leadType === "contractor" || lead.parentCompanyName ? "Contractor CRM lead" : "Owner / buyer lead"}
                      </Badge>
                      {lead.parentCompanyName ? (
                        <div className="mt-2 text-xs leading-5 text-[#667085]">
                          Parent owner: {lead.parentCompanyName}
                          <br />
                          Parent project: {lead.parentProjectName ?? lead.projectName}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs leading-5 text-[#667085]">Parent project record. Create contractor leads from awarded EPC evidence.</div>
                      )}
                    </td>
                    <td className="max-w-[220px] px-3 py-3 text-[#344054]">{lead.projectName}</td>
                    <td className="px-3 py-3"><Badge tone={lead.crmStatus === "Qualified" ? "green" : "amber"}>{lead.crmStatus}</Badge></td>
                    <td className="px-3 py-3"><Badge tone={lead.enrichmentStatus === "Decision Maker Search Queued" ? "amber" : "neutral"}>{lead.enrichmentStatus}</Badge></td>
                    <td className="px-3 py-3"><Badge tone={enrichedDecisionMakers.some((person) => person.leadId === lead.id) ? "green" : "neutral"}>{enrichedDecisionMakers.filter((person) => person.leadId === lead.id).length} saved</Badge></td>
                    <td className="px-3 py-3"><Badge tone={lead.emailStatus === "Verified" ? "green" : lead.emailStatus === "Risky" ? "red" : "neutral"}>{lead.emailStatus}</Badge></td>
                    <td className="max-w-[220px] px-3 py-3 text-[#344054]">{lead.requirementSummary}</td>
                    <td className="px-3 py-3">
                      <Link href={`/legacy/discovery/leads/${lead.id}`} className="btn-primary focus-ring inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-bold">
                        <ExternalLink size={13} />
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </div>
        </details>
      ) : null}

      <section
        data-workspace-frame="leads"
        className="flex flex-col gap-3"
      >
        <FilterDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Pipeline filters">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e4e7ec] bg-white px-4 py-4">
            <div className="flex items-center gap-2">
              <Filter size={17} className="text-[#2563eb]" />
              <h2 className="font-bold text-[#101828]">Pipeline Filters</h2>
            </div>
            <button type="button" onClick={clearFilters} className="btn-quiet focus-ring inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-bold">
              <X size={14} />
              Clear
            </button>
          </div>

          <div className="grid gap-5 p-4">
            <label className="block">
              <span className="text-xs font-bold uppercase text-[#667085]">Search</span>
              <span className="mt-2 flex min-h-11 items-center gap-2 rounded-md border border-[#d7dde6] bg-white px-3 shadow-sm">
                <Search size={16} className="text-[#667085]" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, title, keyword" className="w-full bg-transparent text-sm outline-none" />
              </span>
            </label>

            <FilterGroup label="Region" options={regionOptions} selected={regions} onToggle={(value) => setRegions((current) => toggleValue(current, value))} />
            <FilterGroup label="Department" options={departmentOptions} selected={departments} onToggle={(value) => setDepartments((current) => toggleValue(current, value))} />
            <FilterGroup label="Industry" options={industryOptions} selected={industries} onToggle={(value) => setIndustries((current) => toggleValue(current, value))} />
            <FilterGroup label="Intent Keywords" options={keywordOptions} selected={keywords} onToggle={(value) => setKeywords((current) => toggleValue(current, value))} />
            <FilterGroup label="Email Status" options={emailOptions} selected={emailStatuses} onToggle={(value) => setEmailStatuses((current) => toggleValue(current, value))} />

            <label className="block">
              <span className="text-xs font-bold uppercase text-[#667085]">Confidence</span>
              <select value={confidence} onChange={(event) => setConfidence(event.target.value)} className="control focus-ring mt-2 min-h-11 w-full px-3 text-sm outline-none">
                <option value="">Any confidence</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold uppercase text-[#667085]">Minimum score</span>
              <select value={minScore} onChange={(event) => setMinScore(event.target.value)} className="control focus-ring mt-2 min-h-11 w-full px-3 text-sm outline-none">
                <option value="">Any score</option>
                <option value="80">80+</option>
                <option value="70">70+</option>
                <option value="50">50+</option>
              </select>
            </label>

            <div className="space-y-2 border-t border-[#e4e7ec] pt-4">
              <Toggle label="Verified Lead" checked={verifiedOnly} onChange={setVerifiedOnly} />
              <Toggle label="Has LinkedIn" checked={hasLinkedIn} onChange={setHasLinkedIn} />
              <Toggle label="Email Verified" checked={emailVerified} onChange={setEmailVerified} />
              <Toggle label="One Lead Per Company" checked={oneLeadPerCompany} onChange={setOneLeadPerCompany} />
            </div>
          </div>
        </FilterDrawer>

        <section
          data-workspace-pane="results"
          className="surface order-1 min-w-0 overflow-hidden rounded-xl"
        >
          <div className="shrink-0 border-b border-[#e4e7ec] bg-white">
            <div className="workspace-toolbar">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-[#101828]">Lead pipeline</h2>
                    <p className="mt-0.5 text-xs font-medium normal-case text-[#667085]">Manage stages, enrichment, and contact readiness</p>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs font-bold uppercase tracking-normal text-[#667085]">
                    <span className="whitespace-nowrap">{filteredRows.length} contacts / role targets</span>
                    <span className="whitespace-nowrap text-[#667085]">{selected.length} selected{queuedContacts ? ` / ${queuedContacts} legacy review marks` : ""}</span>
                  </div>
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setFiltersOpen((current) => !current)} className="btn-quiet focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold">
                    <Filter size={15} />
                    Filters{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
                  </button>
                  <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="control focus-ring h-10 w-full min-w-0 px-3 text-sm font-semibold sm:w-[170px] sm:flex-none">
                    <option value="score">Sort by score</option>
                    <option value="company">Sort by company</option>
                    <option value="contact">Sort by contact</option>
                  </select>
                  {selectedRows.length > 0 ? <AddToLeadList contacts={selectedRows.map(({ contact, opportunity }) => ({ contactId: contact.id, leadId: opportunity.company.id }))} /> : null}
                  {selectedRows.length > 0 ? <button type="button" disabled title="Email verification is not connected for research contacts" className="btn-quiet inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                    <MailCheck size={15} />
                    Verification unavailable
                  </button> : null}
                  <button type="button" onClick={exportCsv} disabled={!rowsForAction(filteredRows, selected, (row) => row.contact.id).length} title="Research CSV; email addresses included only when verified" className="control focus-ring inline-flex h-10 min-w-[88px] flex-1 items-center justify-center gap-2 px-3 text-sm font-semibold disabled:opacity-50 sm:flex-none">
                    <Download size={15} />
                    Export {selected.length ? `selected (${selectedRows.length})` : `results (${filteredRows.length})`}
                  </button>
                </div>
              </div>

            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-[#e4e7ec] px-4 py-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedOnPage} onChange={toggleAllRows} />Select visible results</label>
              {selected.length > 0 ? <button type="button" onClick={() => setSelected([])} className="btn-quiet focus-ring rounded-md px-2 py-1 text-xs">Clear selection ({selected.length - selectedRows.length} hidden)</button> : null}
              {activeFilters.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {activeFilters.map((filter) => (
                    <span key={filter} className="rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-2 py-1 text-xs font-bold text-[#1d4ed8]">
                      {filter}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="lead-table-container">
            <table className="lead-data-table crm-data-table w-full border-collapse text-left text-sm">
              <thead className="table-head sticky top-0 z-10 text-xs uppercase">
                <tr>
                  <th className="w-12 px-4 py-3">
                    <span className="sr-only">Selection</span>
                  </th>
                  <th className="px-4 py-3">Contact / Role target</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Buying Signal</th>
                  <th className="px-4 py-3">Stage / Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ opportunity, contact, crmStatus }) => (
                    <tr key={contact.id} className="data-table-row align-top">
                    <td className="px-4 py-4">
                      <input type="checkbox" aria-label={`Select ${contact.name}`} checked={selected.includes(contact.id)} onChange={() => setSelected((current) => toggleValue(current, contact.id))} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#eff6ff] text-[#2563eb] 2xl:flex"><UserCheck size={17} /></div>
                        <div>
                          <div className="line-clamp-2 font-bold text-[#101828]" title={contact.name}>{contact.name}</div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#667085]" title={contact.title}>{contact.title}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-bold text-[#101828]">{opportunity.company.canonicalName}</div>
                      <div className="mt-1 text-xs text-[#667085]">{contact.location ?? opportunity.company.country}</div>
                    </td>
                    <td className="px-4 py-4">
                      <Badge tone={emailTone(contact.emailStatus)}>{contact.emailStatus}</Badge>
                      <div className="mt-1 text-xs text-[#667085]">{contact.email ?? "Email not found"}</div>
                    </td>
                    <td className="max-w-[250px] px-4 py-4">
                      <div className="font-semibold text-[#101828]">{opportunity.intentKeywords?.[0] ?? "Matched signal"}</div>
                      <div className="mt-1 text-xs text-[#667085]">Score {opportunity.score.score} / 100</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <select value={crmStatus} onChange={(event) => updateStatus(contact.id, event.target.value as CrmStatus)} aria-label={`Update ${contact.name} stage`} className="control focus-ring h-9 min-w-[116px] px-2 text-xs font-bold">
                          {(["New", "Reviewed", "Qualified", "Contacted", "Replied", "Not Fit"] as CrmStatus[]).map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
                        <Link className="btn-primary focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md" title={`View ${contact.name}`} aria-label={`View ${contact.name}`} href={`/legacy/companies/${opportunity.company.id}`}><ExternalLink size={14} aria-hidden="true" /></Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredRows.length === 0 ? (
            <div className="border-t border-[#e4e7ec] p-8 text-center text-sm text-[#667085]">No verified leads match these filters. Clear filters or broaden the search.</div>
          ) : null}
        </section>
      </section>
    </div>
  );
}

function FilterGroup({ label, options, selected, onToggle }: { label: string; options: readonly string[]; selected: string[]; onToggle: (value: string) => void }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase text-[#667085]">{label}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button key={option} type="button" onClick={() => onToggle(option)} className={`focus-ring rounded-md border px-2.5 py-1.5 text-xs font-bold transition-colors ${active ? "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]" : "border-[#d0d5dd] bg-white text-[#475467] hover:bg-[#f8fafc]"}`}>
              {option}
            </button>
          );
        })}
      </div>
    </div>
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
