"use client";
import { CrmSyncStatus, useCrmSync } from "@/components/crm-sync";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Building2, Download, ExternalLink, ListPlus, Search, SearchCheck, Trash2, UserCheck } from "lucide-react";
import { Badge } from "@/components/badge";
import { formatDateTime } from "@/lib/date-format";
import { mergeListMembers } from "@/lib/lead-list-members";
import type { BuyerOpportunity, DecisionMaker } from "@/types/domain";

interface LeadListsProps {
  opportunities: BuyerOpportunity[];
  listId?: string;
}

type EmailPipelineStatus = "Email Not Found" | "Search Queued" | "Verification Pending" | "Verified" | "Risky";
type MemberType = "converted-lead" | "decision-maker";
type ContactEnrichmentStatus = "Not Started" | "Search Queued" | "Reviewing Sources" | "Contacts Found" | "No Verified Contact" | "Needs Retry";

interface ConvertedDiscoveryLead {
  id: string;
  companyName: string;
  country: string;
  projectName: string;
  signalType: string;
  crmStatus: string;
  enrichmentStatus: string;
  emailStatus: EmailPipelineStatus;
  targetRoles: string[];
  confidence?: number;
  requirementSummary: string;
  sourceUrl: string;
  convertedAt: string;
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
  confidenceBreakdown?: {
    base?: number;
    professionalProfile?: number;
    directContact?: number;
    sourcePage?: number;
  };
  evidenceSignals?: string[];
  evidenceNotes?: string;
  emailCandidateType?: string;
  verificationSource?: string;
  sourceUrl?: string;
  createdAt?: string;
}

interface LeadList {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
}

interface LeadListMember {
  id: string;
  listId: string;
  memberType: MemberType;
  leadId?: string;
  contactId?: string;
  addedAt: string;
}

interface CrmSnapshotResponse {
  ok: boolean;
  mode?: string;
  convertedLeads?: ConvertedDiscoveryLead[];
  decisionMakers?: EnrichedDecisionMaker[];
  leadLists?: LeadList[];
  leadListMembers?: LeadListMember[];
  contactEnrichmentJobs?: ContactEnrichmentJob[];
}

interface ContactSearchResponse {
  ok: boolean;
  contacts?: EnrichedDecisionMaker[];
  sourcesRead?: number;
  errors?: string[];
  error?: string;
}

interface ContactEnrichmentJob {
  id: string;
  listId?: string;
  leadId: string;
  companyName: string;
  projectName?: string;
  targetRoles?: string[];
  status: ContactEnrichmentStatus;
  queuedAt?: string;
  completedAt?: string;
  error?: string;
}

interface ListableContact {
  id: string;
  leadId: string;
  companyName: string;
  projectName: string;
  country: string;
  name: string;
  title: string;
  department?: string;
  email?: string;
  emailStatus: string;
  linkedinUrl?: string;
  phone?: string;
  phoneStatus?: string;
  dataSourceType?: string;
  confidence?: number;
  confidenceBreakdown?: {
    base?: number;
    professionalProfile?: number;
    directContact?: number;
    sourcePage?: number;
  };
  evidenceSignals?: string[];
  evidenceNotes?: string;
  emailCandidateType?: string;
  sourceUrl?: string;
  evidenceType: string;
  verificationSource?: string;
  source: "verified" | "discovered";
}

const storageKey = "industrialBuyerLeadLists.v1";
export const defaultLists: LeadList[] = [
  {
    id: "gcc-epc-buyers",
    name: "GCC EPC Buyers",
    description: "Pipeline and infrastructure accounts grouped for near-term EPC outreach.",
    createdAt: "2026-09-04T00:00:00.000Z",
  },
  {
    id: "saudi-water-tenders",
    name: "Saudi Water Tenders",
    description: "Water transmission and utility buyers to monitor for tender and procurement activity.",
    createdAt: "2026-09-04T00:00:00.000Z",
  },
  {
    id: "canada-lng-procurement",
    name: "Canada LNG Procurement",
    description: "LNG project procurement contacts and company-level opportunities.",
    createdAt: "2026-09-04T00:00:00.000Z",
  },
];

const defaultMembers: LeadListMember[] = [];
const targetDecisionMakerRoles = ["Procurement Head", "Project Director", "Supply Chain Manager", "Engineering Manager", "CEO / Managing Director"];

function csvEscape(value: string | number | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function emailTone(status: string) {
  if (status === "Verified") return "green";
  if (status === "Risky") return "amber";
  if (status === "Not Found" || status === "Email Not Found") return "red";
  return "neutral";
}

function enrichmentTone(status: ContactEnrichmentStatus) {
  if (status === "Contacts Found") return "green";
  if (status === "No Verified Contact") return "red";
  if (status === "Search Queued" || status === "Reviewing Sources" || status === "Needs Retry") return "amber";
  return "neutral";
}

function sourceEvidenceType(source?: string, linkedinUrl?: string, sourceUrl?: string) {
  const value = `${source ?? ""} ${linkedinUrl ?? ""} ${sourceUrl ?? ""}`.toLowerCase();
  if (value.includes("linkedin.com")) return "Professional profile";
  if (value.includes("press") || value.includes("announcement") || value.includes("news release")) return "Press release";
  if (value.includes("company") || value.includes("official")) return "Company site";
  if (value.includes("manual")) return "Manual research";
  return "Source evidence";
}

function contactTrustLabel(contact: ListableContact) {
  if (contact.emailStatus === "Verified" || contact.phoneStatus === "Verified") return "Verified contact";
  if (contact.email || contact.phone) return "Direct contact candidate";
  if (contact.linkedinUrl) return "Profile-backed candidate";
  return "Source-backed candidate";
}

function contactTrustTone(contact: ListableContact) {
  if (contact.emailStatus === "Verified" || contact.phoneStatus === "Verified") return "green";
  if (contact.email || contact.phone || contact.linkedinUrl) return "amber";
  return "neutral";
}

function confidenceBasis(contact: ListableContact) {
  const basis = contact.confidenceBreakdown;
  if (!basis || Object.keys(basis).length === 0) return "";
  return `base ${basis.base ?? 0}; profile ${basis.professionalProfile ?? 0}; direct ${basis.directContact ?? 0}; source ${basis.sourcePage ?? 0}`;
}

function mergeById<T extends { id: string }>(base: T[], incoming: T[]) {
  const byId = new Map(base.map((item) => [item.id, item]));
  incoming.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values());
}

function contactsFromOpportunities(opportunities: BuyerOpportunity[]): ListableContact[] {
  return opportunities.flatMap((opportunity) =>
    (opportunity.decisionMakers ?? []).map((contact: DecisionMaker) => ({
      id: contact.id,
      leadId: opportunity.company.id,
      companyName: opportunity.company.canonicalName,
      projectName: opportunity.project?.name ?? opportunity.tender?.title ?? "Project evidence pending",
      country: opportunity.company.country,
      name: contact.name,
      title: contact.title,
      department: contact.department,
      email: contact.email,
      emailStatus: contact.emailStatus,
      linkedinUrl: contact.linkedinUrl,
      sourceUrl: opportunity.sources[0]?.url,
      evidenceSignals: contact.linkedinUrl ? ["LinkedIn/profile evidence", "Verified dataset contact"] : ["Verified dataset contact"],
      evidenceType: contact.linkedinUrl ? "Professional profile" : "Company/source evidence",
      verificationSource: contact.source,
      source: "verified" as const,
    })),
  );
}

export function LeadLists({ opportunities, listId }: LeadListsProps) {
  const router = useRouter();
  const sync = useCrmSync();
  const [listError, setListError] = useState("");
  const persistCrmPayload = (type: string, payload: Record<string, unknown>) => sync.write({ type, payload });
  const [lists, setLists] = useState<LeadList[]>(defaultLists);
  const [members, setMembers] = useState<LeadListMember[]>(defaultMembers);
  const [convertedLeads, setConvertedLeads] = useState<ConvertedDiscoveryLead[]>([]);
  const [decisionMakers, setDecisionMakers] = useState<EnrichedDecisionMaker[]>([]);
  const [contactEnrichmentJobs, setContactEnrichmentJobs] = useState<ContactEnrichmentJob[]>([]);
  const [selectedListId, setSelectedListId] = useState(listId ?? defaultLists[0].id);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [newListName, setNewListName] = useState("");
  const [newListDescription, setNewListDescription] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);

  const verifiedContacts = useMemo(() => contactsFromOpportunities(opportunities), [opportunities]);
  const discoveredContacts = useMemo<ListableContact[]>(
    () =>
      decisionMakers.map((person) => {
        const lead = convertedLeads.find((item) => item.id === person.leadId);
        return {
          id: person.id,
          leadId: person.leadId,
          companyName: person.companyName,
          projectName: lead?.projectName ?? "Project evidence pending",
          country: lead?.country ?? person.location ?? "Location pending",
          name: person.name,
          title: person.title,
          department: person.department,
          email: person.email,
          emailStatus: person.emailStatus,
          linkedinUrl: person.linkedinUrl,
          phone: person.phone,
          phoneStatus: person.phoneStatus,
          dataSourceType: person.dataSourceType,
          confidence: person.confidence,
          confidenceBreakdown: person.confidenceBreakdown,
          evidenceSignals: person.evidenceSignals,
          evidenceNotes: person.evidenceNotes,
          emailCandidateType: person.emailCandidateType,
          sourceUrl: person.sourceUrl ?? lead?.sourceUrl,
          evidenceType: sourceEvidenceType(person.verificationSource, person.linkedinUrl, person.sourceUrl),
          verificationSource: person.verificationSource,
          source: "discovered" as const,
        };
      }),
    [convertedLeads, decisionMakers],
  );
  const allContacts = useMemo(() => mergeById(verifiedContacts, discoveredContacts), [discoveredContacts, verifiedContacts]);
  const selectedList = lists.find((list) => list.id === selectedListId) ?? lists[0];
  const activeListId = selectedList?.id ?? selectedListId;
  const listMembers = members.filter((member) => member.listId === activeListId);
  const listContactIds = new Set(listMembers.map((member) => member.contactId).filter(Boolean));
  const listLeadIds = new Set(listMembers.map((member) => member.leadId).filter(Boolean));
  const listContacts = allContacts.filter((contact) => listContactIds.has(contact.id));
  const listLeads = convertedLeads.filter((lead) => listLeadIds.has(lead.id));
  const normalizedMemberQuery = memberQuery.trim().toLowerCase();
  const visibleListContacts = normalizedMemberQuery
    ? listContacts.filter((contact) => [contact.name, contact.title, contact.companyName, contact.projectName, contact.country, contact.department, contact.emailStatus, contact.linkedinUrl, contact.phone].join(" ").toLowerCase().includes(normalizedMemberQuery))
    : listContacts;
  const visibleListLeads = normalizedMemberQuery
    ? listLeads.filter((lead) => [lead.companyName, lead.projectName, lead.country, lead.signalType, lead.requirementSummary, lead.emailStatus, lead.targetRoles.join(" ")].join(" ").toLowerCase().includes(normalizedMemberQuery))
    : listLeads;
  const normalizedQuery = query.trim().toLowerCase();
  const availableContacts = allContacts.filter((contact) =>
    [contact.name, contact.title, contact.companyName, contact.projectName, contact.country, contact.department, contact.emailStatus].join(" ").toLowerCase().includes(normalizedQuery),
  );
  const availableLeads = convertedLeads.filter((lead) =>
    [lead.companyName, lead.projectName, lead.country, lead.signalType, lead.requirementSummary, lead.emailStatus].join(" ").toLowerCase().includes(normalizedQuery),
  );
  const selectedListStats = getListStats(activeListId, members, allContacts, convertedLeads);
  const listMode = Boolean(listId);
  const filteredLists = lists.filter((list) =>
    [list.name, list.description].join(" ").toLowerCase().includes(listQuery.trim().toLowerCase()),
  );
  const canExportSelectedList = listMembers.length > 0;
  const selectedListReadiness = selectedListStats.verifiedEmails > 0 ? "Campaign export ready" : canExportSelectedList ? "Review before export" : "Build contact coverage";
  const campaignSteps = [
    { label: "Account scope", value: selectedListStats.companies, detail: "Target companies selected", complete: selectedListStats.companies > 0 },
    { label: "People coverage", value: selectedListStats.contacts, detail: "Named decision makers added", complete: selectedListStats.contacts > 0 },
    { label: "Verified export", value: selectedListStats.verifiedEmails, detail: "Verified emails available", complete: selectedListStats.verifiedEmails > 0 },
  ];

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { lists?: LeadList[]; members?: LeadListMember[]; contactEnrichmentJobs?: ContactEnrichmentJob[] };
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser storage can only be hydrated after the server render.
        setLists((current) => mergeById(current, parsed.lists ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        setMembers((current) => mergeListMembers(current, parsed.members ?? []));
        setContactEnrichmentJobs((current) => mergeById(current, parsed.contactEnrichmentJobs ?? []));
      }
    } catch {
      setListError("Saved browser data could not be read. Database records will still be loaded.");
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
      if (cancelled || !payload.ok) return;

      setConvertedLeads(payload.convertedLeads ?? []);
      setDecisionMakers(payload.decisionMakers ?? []);
      setContactEnrichmentJobs(payload.contactEnrichmentJobs ?? []);
      if (payload.leadLists?.length) {
        setLists((current) => mergeById(current, payload.leadLists!).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      }
      if (payload.leadListMembers?.length) {
        setMembers((current) => mergeListMembers(current, payload.leadListMembers!));
      }
    }

    void loadDatabaseState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    window.localStorage.setItem(storageKey, JSON.stringify({ lists, members, contactEnrichmentJobs }));
  }, [contactEnrichmentJobs, isHydrated, lists, members]);

  function createList() {
    const name = newListName.trim();
    if (!name) return;
    if (lists.some((list) => list.name.toLowerCase() === name.toLowerCase())) {
      setListError("A list with this name already exists. Choose a different name.");
      return;
    }
    setListError("");
    const now = new Date().toISOString();
    const list: LeadList = {
      id: `list-${crypto.randomUUID()}`,
      name,
      description: newListDescription.trim() || "Custom lead list for targeted outreach.",
      createdAt: now,
      updatedAt: now,
    };
    setLists((current) => mergeById([list], current).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setSelectedListId(list.id);
    setNewListName("");
    setNewListDescription("");
    void persistCrmPayload("lead-list", list as unknown as Record<string, unknown>);
  }

  function addMember(memberType: MemberType, id: string, leadId?: string) {
    const list = selectedList;
    if (!list) return;
    const member: LeadListMember = {
      id: `${list.id}-${memberType}-${id}`,
      listId: list.id,
      memberType,
      leadId: memberType === "converted-lead" ? id : leadId,
      contactId: memberType === "decision-maker" ? id : undefined,
      addedAt: new Date().toISOString(),
    };

    setLists((current) => mergeById(current, [list]));
    setMembers((current) => mergeListMembers(current, [member]));
    void persistCrmPayload("lead-list", list as unknown as Record<string, unknown>);
    void persistCrmPayload("lead-list-member", member as unknown as Record<string, unknown>);
  }

  function removeMember(memberId: string) {
    if (!window.confirm("Remove this member from the list? The contact itself will not be deleted.")) return;
    setMembers((current) => current.filter((member) => member.id !== memberId));
    void sync.write({ type: "lead-list-member", id: memberId }, "DELETE");
  }

  function removeMembers(memberIds: string[]) {
    const uniqueIds = Array.from(new Set(memberIds));
    if (uniqueIds.length === 0) return false;
    if (!window.confirm(`Remove ${uniqueIds.length} selected member${uniqueIds.length === 1 ? "" : "s"} from this list? The underlying leads and contacts will stay in CRM.`)) return false;
    setMembers((current) => current.filter((member) => !uniqueIds.includes(member.id)));
    uniqueIds.forEach((memberId) => void sync.write({ type: "lead-list-member", id: memberId }, "DELETE"));
    return true;
  }

  function addSelectedMembers() {
    selectedMembers.forEach((value) => {
      const [memberType, ...rest] = value.split(":");
      const id = rest.join(":");
      if (memberType === "converted-lead") addMember("converted-lead", id);
      if (memberType === "decision-maker") {
        const contact = allContacts.find((item) => item.id === id);
        addMember("decision-maker", id, contact?.leadId);
      }
    });
    setSelectedMembers([]);
  }

  function exportSelectedList() {
    if (!canExportSelectedList) {
      setListError("Add at least one account or decision maker before exporting this campaign list.");
      return;
    }
    setListError("");
    const header = ["list", "type", "name", "title_or_project", "company", "country", "trust_status", "email", "email_status", "email_candidate_type", "linkedin", "phone", "phone_status", "data_source", "confidence", "confidence_basis", "source_type", "source_note", "source_url", "evidence_signals", "evidence_notes"];
    const leadRows = listLeads.map((lead) => [
      selectedList?.name,
      "company/project",
      lead.companyName,
      lead.projectName,
      lead.companyName,
      lead.country,
      "Account candidate",
      "",
      lead.emailStatus,
      "",
      "",
      "",
      "",
      "Discovery source",
      lead.confidence ? Math.round(lead.confidence * 100) : "",
      "",
      lead.signalType,
      lead.requirementSummary,
      lead.sourceUrl,
      "",
      lead.targetRoles.join("; "),
    ]);
    const contactRows = listContacts.map((contact) => [selectedList?.name, "decision-maker", contact.name, contact.title, contact.companyName, contact.country, contactTrustLabel(contact), contact.emailStatus === "Verified" ? contact.email : "", contact.emailStatus, contact.emailCandidateType, contact.linkedinUrl, contact.phone, contact.phoneStatus, contact.dataSourceType, contact.confidence, confidenceBasis(contact), contact.evidenceType, contact.verificationSource, contact.sourceUrl, contact.evidenceSignals?.join("; "), contact.evidenceNotes]);
    const body = [...leadRows, ...contactRows].map((row) => row.map(csvEscape).join(","));
    const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedList?.id ?? "lead-list"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function queueDecisionMakerSearch(lead: ConvertedDiscoveryLead) {
    const now = new Date().toISOString();
    const jobId = `${activeListId}-${lead.id}-decision-maker-search`;
    const queuedJob: ContactEnrichmentJob = {
      id: jobId,
      listId: activeListId,
      leadId: lead.id,
      companyName: lead.companyName,
      projectName: lead.projectName,
      targetRoles: targetDecisionMakerRoles,
      status: "Reviewing Sources",
      queuedAt: now,
    };

    setContactEnrichmentJobs((current) => mergeById(current, [queuedJob]).sort((a, b) => (b.queuedAt ?? "").localeCompare(a.queuedAt ?? "")));
    void persistCrmPayload("contact-enrichment-job", {
      ...queuedJob,
      result: {
        listId: activeListId,
        sourcePlan: ["company leadership page", "professional profile", "procurement/tender document", "public contact evidence"],
      },
    } as unknown as Record<string, unknown>);

    const response = await fetch("/api/discovery/contact-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId: lead.id,
        ownerCompany: lead.companyName,
        parentProjectName: lead.projectName,
        sourceUrl: lead.sourceUrl,
        contractor: {
          name: lead.companyName,
          country: lead.country,
          role: lead.signalType,
          scope: lead.requirementSummary,
          packageHint: lead.requirementSummary,
        },
        targetRoles: targetDecisionMakerRoles,
      }),
    }).catch(() => null);

    const payload = response ? ((await response.json().catch(() => null)) as ContactSearchResponse | null) : null;
    const foundContacts = payload?.ok ? (payload.contacts ?? []) : [];
    const status: ContactEnrichmentStatus = foundContacts.length > 0 ? "Contacts Found" : payload && !payload.ok ? "Needs Retry" : "No Verified Contact";
    const completedAt = new Date().toISOString();
    const job: ContactEnrichmentJob = {
      id: `${activeListId}-${lead.id}-decision-maker-search`,
      listId: activeListId,
      leadId: lead.id,
      companyName: lead.companyName,
      projectName: lead.projectName,
      targetRoles: targetDecisionMakerRoles,
      status,
      queuedAt: now,
      completedAt,
      error: payload?.error,
    };

    const updatedLead: ConvertedDiscoveryLead = {
      ...lead,
      enrichmentStatus: status === "Contacts Found" ? "Decision Makers Found" : "Decision Maker Search Queued",
      emailStatus: foundContacts.some((person) => person.emailStatus === "Verification Pending") ? "Verification Pending" : lead.emailStatus,
    };

    if (foundContacts.length > 0) {
      setDecisionMakers((current) => mergeById(current, foundContacts));
      foundContacts.forEach((person) => {
        void persistCrmPayload("decision-maker", person as unknown as Record<string, unknown>);
        addMember("decision-maker", person.id, person.leadId);
      });
    }

    setConvertedLeads((current) => mergeById(current, [updatedLead]));
    setContactEnrichmentJobs((current) => mergeById(current, [job]).sort((a, b) => (b.queuedAt ?? "").localeCompare(a.queuedAt ?? "")));
    void persistCrmPayload("converted-lead", updatedLead as unknown as Record<string, unknown>);
    void persistCrmPayload("contact-enrichment-job", {
      ...job,
      result: {
        listId: activeListId,
        sourcePlan: ["company leadership page", "professional profile", "procurement/tender document", "public contact evidence"],
        sourcesRead: payload?.sourcesRead ?? 0,
        contactsFound: foundContacts.length,
        errors: payload?.errors ?? [],
      },
    } as unknown as Record<string, unknown>);
  }

  function selectList(id: string) {
    setSelectedListId(id);
    if (listMode) router.push(`/legacy/lead-lists/${id}`);
  }

  function removeCompanyMember(leadId: string) {
    const member = members.find((item) => item.listId === activeListId && item.leadId === leadId && item.memberType === "converted-lead");
    if (member) removeMember(member.id);
  }

  return (
    <div className="flex flex-col gap-5">
      <CrmSyncStatus sync={sync} />
      {listError ? <p role="alert" className="text-sm text-[#b42318]">{listError}</p> : null}
      <section data-workspace-frame="lead-lists" className="grid items-start gap-4">
        <section data-workspace-pane="segments" className="surface overflow-hidden rounded-xl">
          <div className="flex flex-col gap-3 border-b border-[#e4e7ec] bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-bold text-[#101828]">{listMode ? "Switch campaign list" : "Campaign list library"}</h2>
              <p className="mt-1 text-sm text-[#667085]">Campaign-ready account and contact segments with evidence, verification state, and export scope.</p>
            </div>
            <label className="flex h-10 w-full max-w-sm items-center gap-2 rounded-md border border-[#d0d5dd] bg-white px-3">
              <Search size={15} className="text-[#667085]" />
              <input value={listQuery} onChange={(event) => setListQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search lists" />
            </label>
          </div>
          <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredLists.map((list) => {
              const stats = getListStats(list.id, members, allContacts, convertedLeads);
              const active = list.id === selectedListId;
              return (
                <div key={list.id} className={`rounded-lg border p-3 transition-colors ${active ? "border-[#b9c9ea] bg-[#f4f7fb]" : "border-[#e4e7ec] bg-white hover:border-[#cfd7e4] hover:bg-[#fbfcfe]"}`}>
                  <button type="button" onClick={() => selectList(list.id)} className="focus-ring block w-full rounded text-left">
                    <span className="block truncate text-sm font-bold text-[#101828]">{list.name}</span>
                    <span className="mt-1 line-clamp-1 block text-xs leading-5 text-[#667085]">{list.description}</span>
                  </button>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold text-[#475467]">
                      <span>{stats.companies} companies</span>
                      <span>{stats.contacts} contacts</span>
                      <span>{stats.verifiedEmails} verified</span>
                    </div>
                    <Link href={`/legacy/lead-lists/${list.id}`} className="btn-quiet focus-ring inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs font-bold">
                      <ExternalLink size={14} />
                      Detail
                    </Link>
                  </div>
                </div>
              );
            })}
            {filteredLists.length === 0 ? <div className="rounded-md border border-[#e4e7ec] p-6 text-center text-sm text-[#667085] lg:col-span-3">No lists match this search.</div> : null}
          </div>
          {!listMode ? (
            <details className="border-t border-[#e4e7ec] bg-[#fbfcff]">
              <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-[#2563eb]">
                <ListPlus size={16} />
                Create list
              </summary>
              <div className="grid gap-3 px-4 pb-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] lg:items-end">
                <label className="block">
                  <span className="text-xs font-bold uppercase text-[#667085]">New List</span>
                  <input value={newListName} onChange={(event) => setNewListName(event.target.value)} className="control focus-ring mt-2 h-10 w-full px-3 text-sm outline-none" placeholder="Saudi pipeline EPC" />
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase text-[#667085]">Purpose</span>
                  <input value={newListDescription} onChange={(event) => setNewListDescription(event.target.value)} className="control focus-ring mt-2 h-10 w-full px-3 text-sm outline-none" placeholder="Short purpose for this list" />
                </label>
                <button type="button" onClick={createList} className="btn-primary focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-bold">
                  <ListPlus size={16} />
                  Create
                </button>
              </div>
            </details>
          ) : null}
        </section>

        <section data-workspace-pane="list-content" className="surface min-w-0 overflow-hidden rounded-xl">
          <div className="flex flex-col justify-between gap-4 border-b border-[#e4e7ec] bg-white p-5 lg:flex-row lg:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-[#101828]">{selectedList?.name ?? "Lead list"}</h2>
                <Badge tone={selectedListStats.verifiedEmails > 0 ? "green" : "neutral"}>{selectedListReadiness}</Badge>
              </div>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-[#667085]">{selectedList?.description ?? "Prepare verified contacts and account context for campaign export."}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!listMode ? (
                <Link href={`/legacy/lead-lists/${activeListId}`} className="btn-quiet focus-ring inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold">
                  <ExternalLink size={15} />
                  Open Detail
                </Link>
              ) : (
                <Link href="/legacy/lead-lists" className="btn-quiet focus-ring inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold">All Lists</Link>
              )}
              <button type="button" onClick={exportSelectedList} disabled={!canExportSelectedList} title={canExportSelectedList ? "Export this campaign list" : "Add at least one member before exporting"} className="btn-primary focus-ring inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">
                <Download size={15} />
                Export List
              </button>
            </div>
          </div>

          <div className="border-b border-[#e4e7ec] bg-[#fbfcfe] p-4">
            <div className="grid gap-3 lg:grid-cols-3">
              {campaignSteps.map((step, index) => (
                <div key={step.label} className={`rounded-lg border p-3 ${step.complete ? "border-[#bbf7d0] bg-white" : "border-[#e4e7ec] bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase text-[#667085]">Step {index + 1}</div>
                      <div className="mt-1 font-bold text-[#101828]">{step.label}</div>
                    </div>
                    <Badge tone={step.complete ? "green" : "neutral"}>{step.complete ? "Ready" : "Open"}</Badge>
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-[#101828]">{step.value}</span>
                    <span className="text-xs font-medium text-[#667085]">{step.detail}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ListStat label="Members" value={listMembers.length} detail="Accounts and contacts in scope" />
              <ListStat label="Companies" value={selectedListStats.companies} detail="Unique buying accounts" />
              <ListStat label="Verified Emails" value={selectedListStats.verifiedEmails} detail="Allowed in export" />
              <ListStat label="Needs Review" value={selectedListStats.riskyOrUnknown} detail="Risky or unknown contacts" />
            </div>
          </div>

          <details className="border-b border-[#e4e7ec]">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-[#1d4ed8]">
              <span className="inline-flex items-center gap-2"><ListPlus size={16} />Add companies or contacts</span>
              <span className="text-xs font-semibold text-[#667085]">{availableLeads.length} accounts / {availableContacts.length} people available</span>
            </summary>
            <div className="border-b border-[#e4e7ec] bg-[#fbfcff] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <label className="block flex-1">
                  <span className="text-xs font-bold uppercase text-[#667085]">Find Companies Or Contacts</span>
                  <span className="mt-2 flex h-10 items-center gap-2 rounded-md border border-[#d0d5dd] bg-white px-3">
                    <Search size={15} className="text-[#667085]" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search by company, role, project, country, email status" />
                  </span>
                </label>
                <button type="button" onClick={addSelectedMembers} disabled={selectedMembers.length === 0} className="btn-primary focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">
                  <ListPlus size={16} />
                  Add Selected
                </button>
              </div>
            </div>
            <AddableTable
              leads={availableLeads}
              contacts={availableContacts}
              selectedMembers={selectedMembers}
              setSelectedMembers={setSelectedMembers}
              listLeadIds={listLeadIds}
              listContactIds={listContactIds}
              onAddMember={addMember}
            />
          </details>

          <div className="border-b border-[#e4e7ec] bg-white px-4 py-3">
            <label className="flex h-10 max-w-xl items-center gap-2 rounded-md border border-[#d0d5dd] bg-white px-3">
              <Search size={15} className="text-[#667085]" />
              <input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search members by account, contact, project, role, email, phone" />
            </label>
          </div>
          <EnrichmentJobs jobs={contactEnrichmentJobs.filter((job) => job.listId === activeListId || listLeadIds.has(job.leadId))} />
          <ListDetailTables contacts={visibleListContacts} leads={visibleListLeads} members={listMembers} enrichmentJobs={contactEnrichmentJobs} filterActive={Boolean(normalizedMemberQuery)} onQueueDecisionMakerSearch={queueDecisionMakerSearch} onRemoveMember={removeMember} onRemoveMembers={removeMembers} onRemoveLead={removeCompanyMember} />
        </section>
      </section>
    </div>
  );
}

function getListStats(listId: string, members: LeadListMember[], contacts: ListableContact[], leads: ConvertedDiscoveryLead[]) {
  const scoped = members.filter((member) => member.listId === listId);
  const contactIds = new Set(scoped.map((member) => member.contactId).filter(Boolean));
  const leadIds = new Set(scoped.map((member) => member.leadId).filter(Boolean));
  const scopedContacts = contacts.filter((contact) => contactIds.has(contact.id));
  const scopedLeads = leads.filter((lead) => leadIds.has(lead.id));
  return {
    companies: new Set([...scopedLeads.map((lead) => lead.companyName), ...scopedContacts.map((contact) => contact.companyName)]).size,
    contacts: scopedContacts.length,
    verifiedEmails: scopedContacts.filter((contact) => contact.emailStatus === "Verified").length,
    riskyOrUnknown: scopedContacts.filter((contact) => ["Risky", "Unknown", "Email Not Found", "Not Found"].includes(contact.emailStatus)).length,
  };
}

function ListStat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-lg border border-[#e4e7ec] bg-white p-3">
      <div className="text-[11px] font-bold uppercase text-[#667085]">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-[#101828]">{value}</span>
        <span className="text-xs font-medium text-[#667085]">{detail}</span>
      </div>
    </div>
  );
}

function AddableTable({
  leads,
  contacts,
  selectedMembers,
  setSelectedMembers,
  listLeadIds,
  listContactIds,
  onAddMember,
}: {
  leads: ConvertedDiscoveryLead[];
  contacts: ListableContact[];
  selectedMembers: string[];
  setSelectedMembers: React.Dispatch<React.SetStateAction<string[]>>;
  listLeadIds: Set<string | undefined>;
  listContactIds: Set<string | undefined>;
  onAddMember: (memberType: MemberType, id: string, leadId?: string) => void;
}) {
  const rows = [
    ...leads.map((lead) => ({ id: lead.id, value: `converted-lead:${lead.id}`, type: "Account / Project", name: lead.companyName, title: lead.projectName, company: lead.companyName, country: lead.country, status: lead.emailStatus, inList: listLeadIds.has(lead.id), sourceUrl: lead.sourceUrl, memberType: "converted-lead" as const, leadId: lead.id })),
    ...contacts.map((contact) => ({ id: contact.id, value: `decision-maker:${contact.id}`, type: "Decision Maker", name: contact.name, title: contact.title, company: contact.companyName, country: contact.country, status: contact.emailStatus, inList: listContactIds.has(contact.id), sourceUrl: contact.sourceUrl, memberType: "decision-maker" as const, leadId: contact.leadId })),
  ];

  function toggle(value: string) {
    setSelectedMembers((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  return (
    <div className="list-table-container border-b border-[#e4e7ec]">
      <table className="list-data-table list-picker-table min-w-[980px] w-full text-left text-sm">
        <thead className="table-head text-xs uppercase">
          <tr>
            <th className="w-12 px-4 py-3">Select</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Country</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.value} className="border-t border-[#eef2f6] align-top hover:bg-[#f8fafc]">
              <td className="px-4 py-3"><input type="checkbox" checked={selectedMembers.includes(row.value)} onChange={() => toggle(row.value)} disabled={row.inList} aria-label={`Select ${row.name}`} /></td>
              <td className="px-4 py-3"><Badge tone={row.memberType === "converted-lead" ? "green" : "neutral"}>{row.type}</Badge></td>
              <td className="px-4 py-3">
                <div className="font-bold text-[#101828]">{row.name}</div>
                <div className="mt-1 text-xs text-[#667085]">{row.title}</div>
              </td>
              <td className="px-4 py-3 text-[#344054]">{row.company}</td>
              <td className="px-4 py-3 text-[#344054]">{row.country}</td>
              <td className="px-4 py-3"><Badge tone={emailTone(row.status)}>{row.status}</Badge></td>
              <td className="px-4 py-3">
                {row.inList ? (
                  <span className="text-xs font-semibold text-[#667085]">Already in list</span>
                ) : (
                  <button type="button" onClick={() => onAddMember(row.memberType, row.id, row.leadId)} className="btn-quiet focus-ring inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-bold">
                    <ListPlus size={14} />
                    Add
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <div className="p-8 text-center text-sm text-[#667085]">No companies or contacts match this search yet.</div> : null}
    </div>
  );
}

function EnrichmentJobs({ jobs }: { jobs: ContactEnrichmentJob[] }) {
  if (jobs.length === 0) return null;

  return (
    <div className="border-b border-[#e4e7ec] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-[#101828]">
        <SearchCheck size={16} />
        Enrichment activity
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {jobs.map((job) => (
          <div key={job.id} className="rounded-md border border-[#e4e7ec] bg-[#fbfcff] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-bold text-[#101828]">{job.companyName}</div>
                <div className="mt-1 text-xs text-[#667085]">{job.projectName ?? "Project context pending"}</div>
              </div>
              <Badge tone={enrichmentTone(job.status)}>{job.status}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {(job.targetRoles?.length ? job.targetRoles : targetDecisionMakerRoles).map((role) => (
                <span key={`${job.id}-${role}`} className="rounded-md border border-[#e4e7ec] bg-white px-2 py-1 text-xs font-semibold text-[#475467]">{role}</span>
              ))}
            </div>
            <div className="mt-3 text-xs text-[#667085]">
              {job.error ?? (job.completedAt ? `Completed ${formatDateTime(job.completedAt)}` : `Search requested ${formatDateTime(job.queuedAt)}`)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListDetailTables({
  contacts,
  leads,
  members,
  enrichmentJobs,
  onQueueDecisionMakerSearch,
  onRemoveMember,
  onRemoveMembers,
  onRemoveLead,
  filterActive,
}: {
  contacts: ListableContact[];
  leads: ConvertedDiscoveryLead[];
  members: LeadListMember[];
  enrichmentJobs: ContactEnrichmentJob[];
  filterActive: boolean;
  onQueueDecisionMakerSearch: (lead: ConvertedDiscoveryLead) => void;
  onRemoveMember: (memberId: string) => void;
  onRemoveMembers: (memberIds: string[]) => boolean;
  onRemoveLead: (leadId: string) => void;
}) {
  const [selectedListMemberIds, setSelectedListMemberIds] = useState<string[]>([]);
  const leadMemberIds = leads
    .map((lead) => members.find((member) => member.leadId === lead.id && member.memberType === "converted-lead")?.id)
    .filter(Boolean) as string[];
  const contactMemberIds = contacts
    .map((contact) => members.find((member) => member.contactId === contact.id)?.id)
    .filter(Boolean) as string[];
  const visibleMemberIds = [...leadMemberIds, ...contactMemberIds];
  const selectedVisibleMemberIds = selectedListMemberIds.filter((memberId) => visibleMemberIds.includes(memberId));
  const allVisibleSelected = visibleMemberIds.length > 0 && visibleMemberIds.every((memberId) => selectedListMemberIds.includes(memberId));

  function toggleListMember(memberId: string) {
    setSelectedListMemberIds((current) => (current.includes(memberId) ? current.filter((item) => item !== memberId) : [...current, memberId]));
  }

  function toggleAllVisibleMembers() {
    setSelectedListMemberIds((current) => {
      if (allVisibleSelected) return current.filter((memberId) => !visibleMemberIds.includes(memberId));
      return Array.from(new Set([...current, ...visibleMemberIds]));
    });
  }

  function removeSelectedVisibleMembers() {
    const removed = onRemoveMembers(selectedVisibleMemberIds);
    if (removed) setSelectedListMemberIds((current) => current.filter((memberId) => !selectedVisibleMemberIds.includes(memberId)));
  }

  return (
    <div className="space-y-5 p-4">
      {visibleMemberIds.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] px-3 py-2">
          <label className="inline-flex items-center gap-2 text-xs font-bold text-[#344054]">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisibleMembers} />
            Select visible members
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={selectedVisibleMemberIds.length > 0 ? "amber" : "neutral"}>{selectedVisibleMemberIds.length} selected</Badge>
            <button type="button" onClick={removeSelectedVisibleMembers} disabled={selectedVisibleMemberIds.length === 0} className="focus-ring inline-flex h-8 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
              <Trash2 size={14} />
              Remove selected
            </button>
          </div>
        </div>
      ) : null}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-bold text-[#101828]"><Building2 size={16} />Account scope</div><Badge tone={leads.length > 0 ? "green" : "neutral"}>{leads.length} account{leads.length === 1 ? "" : "s"}</Badge></div>
        <div className="list-table-container rounded-md border border-[#e4e7ec]">
          <table className="list-data-table list-company-table min-w-[1120px] w-full text-left text-sm">
            <thead className="table-head text-xs uppercase">
              <tr>
                <th className="w-12 px-4 py-3">Select</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Requirement</th>
                <th className="px-4 py-3">Email Stage</th>
                <th className="px-4 py-3">Enrichment</th>
                <th className="px-4 py-3">Evidence</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const job = enrichmentJobs.find((item) => item.leadId === lead.id);
                const leadMemberId = members.find((member) => member.leadId === lead.id && member.memberType === "converted-lead")?.id;
                const status = (job?.status ?? (lead.enrichmentStatus === "Decision Makers Found" ? "Contacts Found" : lead.enrichmentStatus === "Decision Maker Search Queued" ? "Search Queued" : "Not Started")) as ContactEnrichmentStatus;
                return (
                  <tr key={lead.id} className="border-t border-[#eef2f6] align-top hover:bg-[#f8fafc]">
                    <td className="px-4 py-3">
                      {leadMemberId ? (
                        <input
                          type="checkbox"
                          checked={selectedListMemberIds.includes(leadMemberId)}
                          onChange={() => toggleListMember(leadMemberId)}
                          aria-label={`Select ${lead.companyName}`}
                        />
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-bold text-[#101828]">{lead.companyName}</td>
                    <td className="px-4 py-3 text-[#344054]">{lead.projectName}</td>
                    <td className="max-w-[300px] px-4 py-3 text-[#667085]">{lead.requirementSummary}</td>
                    <td className="px-4 py-3"><Badge tone={emailTone(lead.emailStatus)}>{lead.emailStatus}</Badge></td>
                    <td className="px-4 py-3">
                      <Badge tone={enrichmentTone(status)}>{status}</Badge>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {targetDecisionMakerRoles.slice(0, 3).map((role) => (
                          <span key={`${lead.id}-${role}`} className="rounded border border-[#e4e7ec] bg-[#f8fafc] px-2 py-0.5 text-[11px] font-semibold text-[#475467]">{role}</span>
                        ))}
                      </div>
                      <button type="button" onClick={() => onQueueDecisionMakerSearch(lead)} className="btn-quiet focus-ring mt-3 inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-bold whitespace-nowrap">
                        <SearchCheck size={14} />
                        Find Decision Makers
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <a href={lead.sourceUrl} className="btn-quiet focus-ring inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-bold">
                        <ExternalLink size={14} />
                        Source
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => onRemoveLead(lead.id)} className="focus-ring inline-flex h-8 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50">
                        <Trash2 size={14} />
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {leads.length === 0 ? <div className="p-6 text-center text-sm text-[#667085]">{filterActive ? "No account members match this search." : "No account members yet. Add converted Discovery leads to define the campaign account scope."}</div> : null}
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-bold text-[#101828]"><UserCheck size={16} />Decision-maker coverage</div><Badge tone={contacts.length > 0 ? "green" : "neutral"}>{contacts.length} contact{contacts.length === 1 ? "" : "s"}</Badge></div>
        <div className="list-table-container rounded-md border border-[#e4e7ec]">
          <table className="list-data-table list-contact-table min-w-[980px] w-full text-left text-sm">
            <thead className="table-head text-xs uppercase">
              <tr>
                <th className="w-12 px-4 py-3">Select</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Account / Project</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Evidence / Profile</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const memberId = members.find((member) => member.contactId === contact.id)?.id;
                return (
                  <tr key={contact.id} className="border-t border-[#eef2f6] align-top hover:bg-[#f8fafc]">
                    <td className="px-4 py-3">
                      {memberId ? (
                        <input type="checkbox" checked={selectedListMemberIds.includes(memberId)} onChange={() => toggleListMember(memberId)} aria-label={`Select ${contact.name}`} />
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-[#101828]">{contact.name}</div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#667085]">{contact.title}</div>
                      <div className="mt-1 text-xs font-semibold text-[#2563eb]">{contact.department ?? "Role pending"}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge tone={contactTrustTone(contact)}>{contactTrustLabel(contact)}</Badge>
                        <Badge tone={(contact.confidence ?? 0) >= 80 ? "green" : (contact.confidence ?? 0) >= 65 ? "amber" : "neutral"}>{contact.confidence ?? 50}% confidence</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#101828]">{contact.companyName}</div>
                      <div className="mt-1 line-clamp-1 text-xs text-[#667085]">{contact.projectName}</div>
                      <div className="mt-1 text-xs text-[#667085]">{contact.country}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={emailTone(contact.emailStatus)}>{contact.emailStatus}</Badge>
                      <div className="mt-1 text-xs text-[#667085]">{contact.email ?? "No verified email shown"}</div>
                      <div className="mt-1 text-xs text-[#667085]">{contact.phone ?? "No phone found"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge tone={contact.evidenceType === "Professional profile" ? "green" : "neutral"}>{contact.evidenceType}</Badge>
                        {contact.linkedinUrl ? (
                          <a href={contact.linkedinUrl} className="btn-quiet focus-ring inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-bold text-[#0b66c3]">
                            <ExternalLink size={13} />
                            LinkedIn
                          </a>
                        ) : null}
                        {contact.sourceUrl ? (
                          <a href={contact.sourceUrl} className="btn-quiet focus-ring inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-bold">
                            <ExternalLink size={13} />
                            Source
                          </a>
                        ) : null}
                      </div>
                      {contact.evidenceSignals?.length ? (
                        <div className="mt-2 flex max-w-xl flex-wrap gap-1">
                          {contact.evidenceSignals.slice(0, 4).map((signal) => (
                            <span key={`${contact.id}-${signal}`} className="rounded border border-[#d0d5dd] bg-[#f8fafc] px-2 py-0.5 text-[11px] font-semibold text-[#475467]">{signal}</span>
                          ))}
                        </div>
                      ) : null}
                      {confidenceBasis(contact) ? <div className="mt-2 text-[11px] leading-5 text-[#667085]">Confidence basis: {confidenceBasis(contact)}</div> : null}
                      {contact.verificationSource ? <div className="mt-2 line-clamp-2 max-w-xl text-xs leading-5 text-[#667085]">{contact.verificationSource}</div> : <span className="mt-2 block text-xs text-[#667085]">Evidence pending</span>}
                    </td>
                    <td className="px-4 py-3">
                      {memberId ? (
                        <button type="button" onClick={() => onRemoveMember(memberId)} className="focus-ring inline-flex h-8 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50">
                          <Trash2 size={14} />
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {contacts.length === 0 ? <div className="p-6 text-center text-sm text-[#667085]">{filterActive ? "No decision-maker contacts match this search." : "No decision-maker contacts yet. Run contact search from an account row, then add real sourced people here."}</div> : null}
        </div>
      </div>

      {contacts.length === 0 && leads.length === 0 ? (
        <div className="rounded-md border border-[#e4e7ec] bg-[#f8fafc] p-6 text-center text-sm text-[#667085]">
          {filterActive ? "No list members match this search." : "Add account leads first, then decision makers, then export only the campaign-ready segment."}
        </div>
      ) : null}
    </div>
  );
}
