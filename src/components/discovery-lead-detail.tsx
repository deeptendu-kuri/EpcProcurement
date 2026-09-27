"use client";

import Link from "next/link";
import { ResponsiveTable } from "@/components/responsive-table";
import { mergeWorkspaceCache } from "@/lib/crm-workspace";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Boxes, Clock, ExternalLink, LinkIcon, ListPlus, MailCheck, NotebookPen, Radar, Search, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/badge";
import { formatDateTime } from "@/lib/date-format";

type CandidateStage = "New" | "Researching" | "Contact Needed" | "Qualified" | "Rejected";
type EmailPipelineStatus = "Email Not Found" | "Search Queued" | "Verification Pending" | "Verified" | "Risky";
type PhoneStatus = "Not Found" | "Candidate Found" | "Verified" | "Do Not Call";
type LinkedinStatus = "Not Found" | "Profile Found" | "Needs Review";
type DataSourceType = "Manual research" | "Company website" | "Professional profile" | "Procurement source" | "Contact provider" | "Email pattern";
type EmailCandidateType = "unknown" | "source-backed" | "pattern-inferred" | "provider-supplied";

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

interface PersistedCrmState {
  savedDiscoveryCandidates?: SavedDiscoveryCandidate[];
  convertedDiscoveryLeads?: ConvertedDiscoveryLead[];
  crmActivities?: CrmActivity[];
}

interface LeadDetailResponse {
  ok: boolean;
  mode?: string;
  candidate?: SavedDiscoveryCandidate | ConvertedDiscoveryLead;
  converted?: ConvertedDiscoveryLead;
  decisionMakers?: EnrichedDecisionMaker[];
  contactEnrichmentJobs?: DiscoveryQueueJob[];
  emailVerificationJobs?: DiscoveryQueueJob[];
  crmActivities?: CrmActivity[];
}

interface ContractorContactSearchResponse {
  ok: boolean;
  mode?: string;
  queries?: string[];
  sourcesRead?: number;
  contacts?: EnrichedDecisionMaker[];
  errors?: string[];
  error?: string;
}

interface EnrichedDecisionMaker {
  id: string;
  leadId: string;
  companyName: string;
  name: string;
  title: string;
  department: string;
  seniority: string;
  location?: string;
  linkedinUrl?: string;
  email?: string;
  emailStatus: EmailPipelineStatus;
  phone?: string;
  phoneStatus?: PhoneStatus;
  phoneSourceUrl?: string;
  linkedinStatus?: LinkedinStatus;
  dataSourceType?: DataSourceType;
  confidence?: number;
  confidenceBreakdown?: {
    base: number;
    professionalProfile: number;
    directContact: number;
    sourcePage: number;
  };
  evidenceSignals?: string[];
  evidenceNotes?: string;
  emailCandidateType?: EmailCandidateType;
  verificationSource?: string;
  sourceUrl?: string;
  status: string;
  verifiedAt?: string;
  createdAt: string;
}

interface DiscoveryQueueJob {
  id: string;
  leadId?: string;
  companyName?: string;
  projectName?: string;
  targetRoles?: string[];
  status?: string;
  queuedAt?: string;
  completedAt?: string;
  result?: Record<string, unknown>;
  error?: string;
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

type CrmActivityType = "note" | "call" | "email" | "meeting" | "status_change" | "verification" | "task";

interface CrmActivity {
  id: string;
  leadId: string;
  contactId?: string;
  activityType: CrmActivityType;
  title: string;
  body?: string;
  outcome?: string;
  nextStep?: string;
  dueAt?: string;
  sourceUrl?: string;
  createdAt: string;
}

const crmStorageKey = "industrialBuyerCrmState.v1";
const departments = ["Procurement", "Projects", "Engineering", "Supply Chain", "Operations", "Executive"];
const seniorityLevels = ["C-Level", "VP", "Director", "Manager", "Owner", "Individual Contributor"];

interface DecisionMakerFormState {
  companyName: string;
  name: string;
  title: string;
  department: string;
  seniority: string;
  location: string;
  linkedinUrl: string;
  email: string;
  emailStatus: EmailPipelineStatus;
  phone: string;
  phoneStatus: PhoneStatus;
  phoneSourceUrl: string;
  linkedinStatus: LinkedinStatus;
  dataSourceType: DataSourceType;
  confidence: number;
  evidenceNotes: string;
  emailCandidateType: EmailCandidateType;
  verificationSource: string;
  sourceUrl: string;
}

const emptyDecisionMakerForm: DecisionMakerFormState = {
  companyName: "",
  name: "",
  title: "",
  department: "Procurement",
  seniority: "Director",
  location: "",
  linkedinUrl: "",
  email: "",
  emailStatus: "Email Not Found" as EmailPipelineStatus,
  phone: "",
  phoneStatus: "Not Found",
  phoneSourceUrl: "",
  linkedinStatus: "Not Found",
  dataSourceType: "Manual research",
  confidence: 50,
  evidenceNotes: "",
  emailCandidateType: "unknown",
  verificationSource: "",
  sourceUrl: "",
};

const activityTypes: CrmActivityType[] = ["note", "call", "email", "meeting", "status_change", "verification", "task"];
const emptyActivityForm = {
  activityType: "note" as CrmActivityType,
  title: "",
  body: "",
  outcome: "",
  nextStep: "",
  dueAt: "",
  sourceUrl: "",
};

const targetDecisionMakerRoles = ["Procurement Head", "Project Director", "Supply Chain Manager", "Engineering Manager", "CEO / Managing Director"];
const contractorBaseRoles = ["Procurement Manager", "Supply Chain Manager", "Contracts Manager", "Project Manager", "CEO / Managing Director"];
const phoneStatuses = ["Not Found", "Candidate Found", "Verified", "Do Not Call"] as const;
const linkedinStatuses = ["Not Found", "Profile Found", "Needs Review"] as const;
const dataSourceTypes = ["Manual research", "Company website", "Professional profile", "Procurement source", "Contact provider", "Email pattern"] as const;
const emailCandidateTypes = ["unknown", "source-backed", "pattern-inferred", "provider-supplied"] as const;

function awardedContractorsFor(candidate: SavedDiscoveryCandidate) {
  return Array.isArray(candidate.awardedContractors) ? candidate.awardedContractors.filter((contractor) => contractor.name) : [];
}

function contractorLeadId(parentLeadId: string, contractorName: string) {
  return `contractor-${parentLeadId}-${contractorName}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 140);
}

function isContractorLead(candidate: SavedDiscoveryCandidate) {
  return candidate.leadType === "contractor" || Boolean(candidate.parentCompanyName);
}

function contractorContactJobId(parentLeadId: string, contractorName: string) {
  return `contractor-contact-${parentLeadId}-${contractorName}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 140);
}

function packageRolesForContractor(contractor: AwardedContractor, candidate: SavedDiscoveryCandidate) {
  const text = [contractor.scope, contractor.packageHint, candidate.projectName, candidate.requirementSummary].join(" ").toLowerCase();
  const roles = new Set(contractorBaseRoles);

  if (text.includes("pipe") || text.includes("pipeline") || text.includes("gre") || text.includes("dn1000") || text.includes("line")) {
    ["Package Manager", "Materials Manager", "Pipeline Procurement Lead"].forEach((role) => roles.add(role));
  }
  if (text.includes("mechanical") || text.includes("valve") || text.includes("compressor") || text.includes("flange")) {
    ["Mechanical Package Manager", "Mechanical Procurement Lead"].forEach((role) => roles.add(role));
  }
  if (text.includes("instrument") || text.includes("control") || text.includes("inspection") || text.includes("commissioning")) {
    ["Instrumentation Lead", "Quality Manager", "Commissioning Manager"].forEach((role) => roles.add(role));
  }
  if (text.includes("civil") || text.includes("construction") || text.includes("installation")) {
    ["Construction Manager", "Subcontracts Manager"].forEach((role) => roles.add(role));
  }

  return Array.from(roles).slice(0, 8);
}

function jobResultString(job: DiscoveryQueueJob, key: string) {
  const value = job.result?.[key];
  return typeof value === "string" ? value : "";
}

function jobResultArray(job: DiscoveryQueueJob, key: string) {
  const value = job.result?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function jobResultNumber(job: DiscoveryQueueJob, key: string) {
  const value = job.result?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isActiveContractorContactJob(job: DiscoveryQueueJob | undefined) {
  return Boolean(job && ["Queued", "Searching Sources", "Reviewing Sources"].includes(job.status ?? ""));
}

function departmentForRole(role: string) {
  const lower = role.toLowerCase();
  if (lower.includes("supply")) return "Supply Chain";
  if (lower.includes("engineering") || lower.includes("mechanical") || lower.includes("instrumentation") || lower.includes("quality")) return "Engineering";
  if (lower.includes("project") || lower.includes("construction") || lower.includes("commissioning")) return "Projects";
  if (lower.includes("operation")) return "Operations";
  if (lower.includes("ceo") || lower.includes("chief")) return "Executive";
  return "Procurement";
}

function seniorityForRole(role: string) {
  const lower = role.toLowerCase();
  if (lower.includes("director")) return "Director";
  if (lower.includes("manager") || lower.includes("lead")) return "Manager";
  if (lower.includes("head")) return "Director";
  return "Manager";
}

function adjacentMaterialPackages(candidate: SavedDiscoveryCandidate) {
  const text = [candidate.companyName, candidate.projectName, candidate.signalType, candidate.requirementSummary].join(" ").toLowerCase();

  if (text.includes("water") || text.includes("dn1000") || text.includes("gre")) {
    return [
      { name: "Primary pipe package", detail: "DI / GRE pipe, bends, fittings, jointing kits", confidence: "High" },
      { name: "Valve and flow-control package", detail: "Isolation valves, air valves, flow meters, chambers", confidence: "Medium" },
      { name: "Civil and installation package", detail: "Excavation, protection, diversion, testing and commissioning", confidence: "Medium" },
    ];
  }

  if (text.includes("lng") || text.includes("gas") || text.includes("pipeline")) {
    return [
      { name: "Line pipe package", detail: "Steel line pipe, bends, coatings, welding consumables", confidence: "High" },
      { name: "Mechanical package", detail: "Valves, flanges, gaskets, compressors, pigging components", confidence: "Medium" },
      { name: "Controls and inspection", detail: "Instrumentation, NDT, pressure testing, commissioning support", confidence: "Medium" },
    ];
  }

  return [
    { name: "Core material package", detail: "Primary materials inferred from project and requirement evidence", confidence: "Medium" },
    { name: "Support package", detail: "Installation, testing, inspection, and commissioning services", confidence: "Medium" },
  ];
}

export function DiscoveryLeadDetail({ leadId }: { leadId: string }) {
  const [state, setState] = useState<PersistedCrmState>(() => {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(crmStorageKey);
    return raw ? (JSON.parse(raw) as PersistedCrmState) : {};
  });
  const [contactJobs, setContactJobs] = useState<DiscoveryQueueJob[]>([]);
  const [emailJobs, setEmailJobs] = useState<DiscoveryQueueJob[]>([]);
  const [decisionMakers, setDecisionMakers] = useState<EnrichedDecisionMaker[]>([]);
  const [decisionMakerForm, setDecisionMakerForm] = useState(emptyDecisionMakerForm);
  const [activityForm, setActivityForm] = useState(emptyActivityForm);
  const [crmActivities, setCrmActivities] = useState<CrmActivity[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(crmStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedCrmState;
    return (parsed.crmActivities ?? []).filter((activity) => activity.leadId === leadId);
  });
  const [isSavingDecisionMaker, setIsSavingDecisionMaker] = useState(false);
  const [isSavingActivity, setIsSavingActivity] = useState(false);
  const [savingDecisionMakerIds, setSavingDecisionMakerIds] = useState<string[]>([]);
  const [contractorWorkflowNotice, setContractorWorkflowNotice] = useState("");
  const [isLoadingDatabase, setIsLoadingDatabase] = useState(true);
  const lead = useMemo(() => {
    const converted = state.convertedDiscoveryLeads?.find((item) => item.id === leadId);
    const candidate = state.savedDiscoveryCandidates?.find((item) => item.id === leadId);
    return { converted, candidate: converted ?? candidate };
  }, [leadId, state]);

  useEffect(() => {
    let cancelled = false;

    async function loadLead() {
      const response = await fetch(`/api/discovery/crm?id=${encodeURIComponent(leadId)}`).catch(() => null);
      if (!response?.ok) {
        setIsLoadingDatabase(false);
        return;
      }

      const payload = (await response.json()) as LeadDetailResponse;
      if (cancelled) return;

      if (payload.ok && payload.mode === "database" && payload.candidate) {
        setState((current) => ({
          savedDiscoveryCandidates: upsertById(current.savedDiscoveryCandidates ?? [], payload.candidate!),
          convertedDiscoveryLeads: payload.converted
            ? upsertById(current.convertedDiscoveryLeads ?? [], payload.converted)
            : current.convertedDiscoveryLeads,
        }));
        setDecisionMakers(payload.decisionMakers ?? []);
        setContactJobs(payload.contactEnrichmentJobs ?? []);
        setEmailJobs(payload.emailVerificationJobs ?? []);
        setCrmActivities((current) => mergeActivities(current, payload.crmActivities ?? []));
      }
      setIsLoadingDatabase(false);
    }

    void loadLead();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (!lead.candidate) {
    return (
      <section className="rounded-lg border border-[#d0d5dd] bg-white p-8 text-center shadow-sm">
        <Search className="mx-auto text-[#667085]" size={28} />
        <h1 className="mt-4 text-xl font-bold text-[#101828]">{isLoadingDatabase ? "Loading lead candidate" : "Lead candidate not found"}</h1>
        <p className="mt-2 text-sm text-[#667085]">
          {isLoadingDatabase ? "Checking the saved CRM workspace." : "Run discovery, save a candidate, then open the detail view from the saved candidates table."}
        </p>
        <Link href="/discovery" className="focus-ring mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[#2563eb] px-4 text-sm font-bold text-white hover:bg-[#1d4ed8]">
          <ArrowLeft size={16} />
          Back to Discovery
        </Link>
      </section>
    );
  }

  const candidate = lead.candidate;
  const converted = lead.converted;
  const awardedContractors = awardedContractorsFor(candidate);
  const contractorProspectRows = (() => {
    const queuedContractorNames = new Set(
      contactJobs
        .filter((job) => job.id.startsWith("contractor-contact-") && isActiveContractorContactJob(job))
        .map((job) => job.companyName)
        .filter(Boolean),
    );

    const contractors =
      awardedContractors.length > 0
        ? awardedContractors
        : isContractorLead(candidate)
          ? [{
              name: candidate.companyName,
              country: candidate.country,
              role: candidate.contractorRole ?? candidate.signalType,
              scope: candidate.contractorScope,
              packageHint: candidate.packageHint ?? candidate.requirementSummary,
              confidence: candidate.confidence,
            }]
          : [];

    return contractors.flatMap((contractor) =>
      packageRolesForContractor(contractor, candidate).map((role) => {
        const existing = decisionMakers.find((person) => person.companyName === contractor.name && person.title.toLowerCase().includes(role.toLowerCase().split(" ")[0]));
        return {
          id: `${contractorLeadId(candidate.parentLeadId ?? candidate.id, contractor.name)}-${role}`,
          contractor,
          role,
          department: departmentForRole(role),
          seniority: seniorityForRole(role),
          packageScope: contractor.packageHint || contractor.scope || candidate.requirementSummary,
          queued: queuedContractorNames.has(contractor.name),
          existing,
        };
      }),
    );
  })();
  const contractorNames = new Set(awardedContractors.map((contractor) => contractor.name));
  const contractorDecisionMakerCount = decisionMakers.filter((person) => contractorNames.has(person.companyName) || (isContractorLead(candidate) && person.companyName === candidate.companyName)).length;

  async function persistDecisionMaker(person: EnrichedDecisionMaker) {
    setSavingDecisionMakerIds((current) => Array.from(new Set([...current, person.id])));
    await fetch("/api/discovery/crm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "decision-maker", payload: person }),
    }).catch(() => undefined);
    setSavingDecisionMakerIds((current) => current.filter((id) => id !== person.id));
  }

  async function persistActivity(activity: CrmActivity) {
    await fetch("/api/discovery/crm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "crm-activity", payload: activity }),
    }).catch(() => undefined);
  }

  async function addCrmActivity() {
    if (!converted || !activityForm.title.trim()) return;

    setIsSavingActivity(true);
    const activity: CrmActivity = {
      id: `crm-activity-${leadId}-${Date.now()}`,
      leadId,
      activityType: activityForm.activityType,
      title: activityForm.title.trim(),
      body: activityForm.body.trim() || undefined,
      outcome: activityForm.outcome.trim() || undefined,
      nextStep: activityForm.nextStep.trim() || undefined,
      dueAt: activityForm.dueAt ? new Date(activityForm.dueAt).toISOString() : undefined,
      sourceUrl: activityForm.sourceUrl.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const nextActivities = mergeActivities([activity], crmActivities);
    setCrmActivities(nextActivities);
    setActivityForm(emptyActivityForm);
    setState((current) => {
      const globalActivities = mergeActivities(current.crmActivities ?? [], [activity]);
      const nextState = { ...current, crmActivities: globalActivities };
      window.localStorage.setItem(crmStorageKey, mergeWorkspaceCache(window.localStorage.getItem(crmStorageKey), nextState));
      return nextState;
    });

    await persistActivity(activity);
    setIsSavingActivity(false);
  }

  function updateDecisionMaker(personId: string, patch: Partial<EnrichedDecisionMaker>) {
    setDecisionMakers((current) => {
      const updated = current.map((person) => (person.id === personId ? { ...person, ...patch } : person));
      const changed = updated.find((person) => person.id === personId);
      if (changed) void persistDecisionMaker(changed);
      return updated;
    });
  }

  function queueDecisionMakerEmail(person: EnrichedDecisionMaker) {
    const nextPerson = {
      ...person,
      emailStatus: "Verification Pending" as EmailPipelineStatus,
    };
    updateDecisionMaker(person.id, nextPerson);
    void fetch("/api/discovery/crm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "email-verification-job",
        payload: {
          id: `email-verification-${person.id}`,
          leadId,
          companyName: candidate.companyName,
          projectName: candidate.projectName,
          emailStatus: "Verification Pending",
          status: "Queued",
          queuedAt: new Date().toISOString(),
          result: { decisionMakerId: person.id, name: person.name, title: person.title },
        },
      }),
    }).catch(() => undefined);
    setEmailJobs((current) => [
      {
        id: `email-verification-${person.id}`,
        leadId,
        companyName: candidate.companyName,
        projectName: candidate.projectName,
        status: "Queued",
        queuedAt: new Date().toISOString(),
      },
      ...current.filter((job) => job.id !== `email-verification-${person.id}`),
    ]);
    const activity: CrmActivity = {
      id: `crm-activity-${leadId}-verification-${person.id}-${Date.now()}`,
      leadId,
      contactId: person.id,
      activityType: "verification",
      title: `Queued email verification for ${person.name}`,
      body: person.email ? `Email under review: ${person.email}` : "Email search/verification queued. No fake email shown.",
      outcome: "Verification Pending",
      nextStep: "Review verifier result and update email status.",
      createdAt: new Date().toISOString(),
    };
    setCrmActivities((current) => mergeActivities([activity], current));
    void persistActivity(activity);
  }

  async function addDecisionMaker() {
    if (!converted || !decisionMakerForm.name.trim() || !decisionMakerForm.title.trim()) return;

    setIsSavingDecisionMaker(true);
    const createdAt = new Date().toISOString();
    const person: EnrichedDecisionMaker = {
      id: `manual-decision-maker-${leadId}-${Date.now()}`,
      leadId,
      companyName: decisionMakerForm.companyName.trim() || candidate.companyName,
      name: decisionMakerForm.name.trim(),
      title: decisionMakerForm.title.trim(),
      department: decisionMakerForm.department,
      seniority: decisionMakerForm.seniority,
      location: decisionMakerForm.location.trim() || undefined,
      linkedinUrl: decisionMakerForm.linkedinUrl.trim() || undefined,
      email: decisionMakerForm.email.trim() || undefined,
      emailStatus: decisionMakerForm.email ? "Verification Pending" : "Email Not Found",
      phone: decisionMakerForm.phone.trim() || undefined,
      phoneStatus: decisionMakerForm.phone.trim() ? "Candidate Found" : decisionMakerForm.phoneStatus,
      phoneSourceUrl: decisionMakerForm.phoneSourceUrl.trim() || undefined,
      linkedinStatus: decisionMakerForm.linkedinUrl.trim() ? "Profile Found" : decisionMakerForm.linkedinStatus,
      dataSourceType: decisionMakerForm.dataSourceType,
      confidence: decisionMakerForm.confidence,
      evidenceNotes: decisionMakerForm.evidenceNotes.trim() || undefined,
      emailCandidateType: decisionMakerForm.email.trim() ? decisionMakerForm.emailCandidateType : "unknown",
      verificationSource: decisionMakerForm.verificationSource.trim() || undefined,
      sourceUrl: decisionMakerForm.sourceUrl.trim() || candidate.sourceUrl,
      status: "Found",
      verifiedAt: undefined,
      createdAt,
    };

    setDecisionMakers((current) => [person, ...current]);
    setDecisionMakerForm(emptyDecisionMakerForm);

    await persistDecisionMaker(person);

    await fetch("/api/discovery/crm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "converted-lead",
        payload: {
          ...converted,
          enrichmentStatus: "Decision Makers Found",
          emailStatus: person.emailStatus === "Verified" ? "Verified" : converted.emailStatus,
        },
      }),
    }).catch(() => undefined);

    setState((current) => ({
      ...current,
      convertedDiscoveryLeads: upsertById(current.convertedDiscoveryLeads ?? [], {
        ...converted,
        enrichmentStatus: "Decision Makers Found",
        emailStatus: person.emailStatus === "Verified" ? "Verified" : converted.emailStatus,
      }),
    }));
    setIsSavingDecisionMaker(false);
  }

  function createContractorLead(contractor: AwardedContractor) {
    const createdAt = new Date().toISOString();
    const contractorLead: ConvertedDiscoveryLead = {
      ...candidate,
      id: contractorLeadId(candidate.id, contractor.name),
      companyName: contractor.name,
      country: contractor.country ?? candidate.country,
      leadType: "contractor",
      parentLeadId: candidate.id,
      parentCompanyName: candidate.companyName,
      parentProjectName: candidate.projectName,
      contractorRole: contractor.role ?? "Awarded contractor",
      contractorScope: contractor.scope,
      packageHint: contractor.packageHint,
      stage: "Contact Needed",
      crmStatus: "Contact Needed",
      enrichmentStatus: "Not Started",
      emailStatus: "Email Not Found",
      signalType: contractor.role ?? "Awarded Contractor",
      targetRoles: targetDecisionMakerRoles,
      requirementSummary: contractor.packageHint ?? contractor.scope ?? candidate.requirementSummary,
      awardedContractors: [contractor],
      savedAt: createdAt,
      convertedAt: createdAt,
    };

    setState((current) => {
      const savedDiscoveryCandidates = upsertById(current.savedDiscoveryCandidates ?? [], contractorLead);
      const convertedDiscoveryLeads = upsertById(current.convertedDiscoveryLeads ?? [], contractorLead);
      const nextState = { ...current, savedDiscoveryCandidates, convertedDiscoveryLeads };
      window.localStorage.setItem(crmStorageKey, mergeWorkspaceCache(window.localStorage.getItem(crmStorageKey), nextState));
      return nextState;
    });
    setContractorWorkflowNotice(`${contractor.name} is synced as a contractor CRM lead under parent project ${candidate.companyName} / ${candidate.projectName}. Open Leads CRM or the Converted CRM Leads table to continue enrichment.`);

    void fetch("/api/discovery/crm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "candidate", payload: contractorLead }),
    }).catch(() => undefined);

    void fetch("/api/discovery/crm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "converted-lead", payload: contractorLead }),
    }).catch(() => undefined);
  }

  async function queueContractorContactSearch(contractor: AwardedContractor) {
    const targetRoles = packageRolesForContractor(contractor, candidate);
    setContractorWorkflowNotice(`Searching public sources for real people at ${contractor.name}. Role targets will stay open until a named person is found.`);
    const createdAt = new Date().toISOString();
    const job: DiscoveryQueueJob = {
      id: contractorContactJobId(candidate.id, contractor.name),
      leadId: converted?.id ?? candidate.id,
      companyName: contractor.name,
      projectName: candidate.projectName,
      targetRoles,
      status: "Searching Sources",
      queuedAt: createdAt,
      result: {
        jobKind: "contractor-contact-search",
        ownerCompany: candidate.companyName,
        contractorName: contractor.name,
        contractorRole: contractor.role ?? "Awarded contractor",
        packageHint: contractor.packageHint ?? "",
        scope: contractor.scope ?? "",
        sourceUrl: candidate.sourceUrl,
      },
    };

    setContactJobs((current) => upsertById(current, job).sort((a, b) => (b.queuedAt ?? "").localeCompare(a.queuedAt ?? "")));
    await fetch("/api/discovery/crm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "contact-enrichment-job", payload: { ...job, result: job.result ?? {} } }),
    }).catch(() => undefined);

    const activity: CrmActivity = {
      id: `crm-activity-${leadId}-contractor-search-${contractorLeadId(candidate.id, contractor.name)}-${Date.now()}`,
      leadId,
      activityType: "task",
      title: `Started source-backed contractor contact search for ${contractor.name}`,
      body: `Searching public sources for real people in these roles: ${targetRoles.join(", ")}`,
      outcome: "Searching Sources",
      nextStep: "Review auto-patched contacts, then verify candidate email and phone data.",
      sourceUrl: candidate.sourceUrl,
      createdAt,
    };
    setCrmActivities((current) => mergeActivities([activity], current));
    void persistActivity(activity);

    const response = await fetch("/api/discovery/contact-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId: converted?.id ?? candidate.id,
        ownerCompany: candidate.parentCompanyName ?? candidate.companyName,
        parentProjectName: candidate.parentProjectName ?? candidate.projectName,
        sourceUrl: candidate.sourceUrl,
        contractor,
        targetRoles,
      }),
    }).catch(() => null);
    const payload = response ? ((await response.json().catch(() => null)) as ContractorContactSearchResponse | null) : null;
    const foundContacts = payload?.ok ? (payload.contacts ?? []) : [];
    const completedAt = new Date().toISOString();
    const completedJob: DiscoveryQueueJob = {
      ...job,
      status: foundContacts.length > 0 ? "Contacts Found" : "No Source Contact",
      completedAt,
      result: {
        ...(job.result ?? {}),
        mode: payload?.mode ?? "source-backed",
        queries: payload?.queries ?? [],
        sourcesRead: payload?.sourcesRead ?? 0,
        contactsFound: foundContacts.length,
        contactIds: foundContacts.map((person) => person.id),
        errors: payload?.errors ?? [],
      },
      error: payload?.ok ? undefined : payload?.error ?? "Contact discovery could not complete.",
    };

    setContactJobs((current) => upsertById(current, completedJob).sort((a, b) => (b.queuedAt ?? "").localeCompare(a.queuedAt ?? "")));
    await fetch("/api/discovery/crm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "contact-enrichment-job", payload: completedJob }),
    }).catch(() => undefined);

    if (foundContacts.length > 0) {
      setDecisionMakers((current) => {
        let merged = current;
        foundContacts.forEach((person) => {
          merged = upsertById(merged, person);
        });
        return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      await Promise.all(foundContacts.map((person) => persistDecisionMaker(person)));

      if (converted) {
        const updatedLead: ConvertedDiscoveryLead = {
          ...converted,
          enrichmentStatus: "Decision Makers Found",
          emailStatus: foundContacts.some((person) => person.emailStatus === "Verification Pending") ? "Verification Pending" : converted.emailStatus,
        };
        setState((current) => ({
          ...current,
          convertedDiscoveryLeads: upsertById(current.convertedDiscoveryLeads ?? [], updatedLead),
        }));
        await fetch("/api/discovery/crm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "converted-lead", payload: updatedLead }),
        }).catch(() => undefined);
      }
    }

    const completedActivity: CrmActivity = {
      id: `crm-activity-${leadId}-contractor-search-complete-${contractorLeadId(candidate.id, contractor.name)}-${Date.now()}`,
      leadId,
      activityType: "task",
      title: foundContacts.length > 0
        ? `Auto-patched ${foundContacts.length} source-backed contact${foundContacts.length === 1 ? "" : "s"} for ${contractor.name}`
        : `No source-backed people found for ${contractor.name}`,
      body: foundContacts.length > 0
        ? foundContacts.map((person) => `${person.name} - ${person.title}${person.linkedinUrl ? " - LinkedIn found" : ""}${person.email ? " - email candidate found" : ""}${person.phone ? " - phone candidate found" : ""}`).join("\n")
        : "The system searched public results and readable source pages, but did not find a real named person with enough evidence to auto-save.",
      outcome: foundContacts.length > 0 ? "Candidate Found" : "No Source Contact",
      nextStep: foundContacts.length > 0 ? "Verify candidate emails/phones before outreach." : "Try a narrower contractor, office location, or role-specific search.",
      sourceUrl: candidate.sourceUrl,
      createdAt: completedAt,
    };
    setCrmActivities((current) => mergeActivities([completedActivity], current));
    setContractorWorkflowNotice(foundContacts.length > 0
      ? `${foundContacts.length} real contact${foundContacts.length === 1 ? "" : "s"} auto-patched into Found Decision Makers for ${contractor.name}.`
      : `No source-backed people were found for ${contractor.name}. The role targets remain open for another search or manual research.`);
    await persistActivity(completedActivity);
  }

  function prepareDecisionMakerFromProspect(prospect: {
    contractor: AwardedContractor;
    role: string;
    department: string;
    seniority: string;
  }) {
    setDecisionMakerForm((current) => ({
      ...current,
      companyName: prospect.contractor.name,
      title: prospect.role,
      department: prospect.department,
      seniority: prospect.seniority,
      location: prospect.contractor.country ?? current.location,
      verificationSource: "Contractor contact research",
      sourceUrl: candidate.sourceUrl,
      dataSourceType: "Procurement source",
      confidence: prospect.contractor.confidence ?? candidate.confidence ?? 70,
      evidenceNotes: `Target role generated from ${prospect.contractor.packageHint || prospect.contractor.scope || candidate.requirementSummary}. Add only real person, LinkedIn, email, or phone evidence from a public/procured source.`,
    }));
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/discovery" className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#2563eb]">
        <ArrowLeft size={16} />
        Discovery
      </Link>

      <header className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="green">{candidate.signalType}</Badge>
              <Badge tone={converted ? "green" : "amber"}>{converted ? "Converted CRM Lead" : "Saved Candidate"}</Badge>
              <Badge tone={isContractorLead(candidate) ? "green" : "neutral"}>{isContractorLead(candidate) ? "Contractor Lead" : "Owner Lead"}</Badge>
            </div>
            <h1 className="mt-3 text-3xl font-bold text-[#101828]">{candidate.companyName}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667085]">{candidate.projectName}</p>
          </div>
          <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex h-10 w-fit items-center gap-2 rounded-md border border-[#bfdbfe] bg-white px-4 text-sm font-bold text-[#1d4ed8] hover:bg-[#eff6ff]">
            <ExternalLink size={16} />
            Open Source
          </a>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-4">
        <DetailCard label="Lead Type" value={isContractorLead(candidate) ? "Contractor lead" : "Owner lead"} />
        <DetailCard label="Country / Region" value={candidate.country} />
        <DetailCard label="CRM Stage" value={converted?.crmStatus ?? candidate.stage} />
        <DetailCard label="Email Status" value={converted?.emailStatus ?? "Email Not Found"} />
      </section>

      <section className="rounded-lg border border-[#d0d5dd] bg-white p-4 shadow-sm">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <div className="text-xs font-bold uppercase text-[#667085]">Lead relationship map</div>
            <h2 className="mt-1 text-lg font-bold text-[#101828]">
              {isContractorLead(candidate) ? `${candidate.companyName} belongs to ${candidate.parentProjectName ?? candidate.projectName}` : `${candidate.companyName} is the project owner / buyer record`}
            </h2>
          </div>
          <Badge tone={contractorDecisionMakerCount > 0 ? "green" : "amber"}>{contractorDecisionMakerCount} real people found</Badge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-3">
            <div className="text-xs font-bold uppercase text-[#667085]">1. Parent project</div>
            <div className="mt-2 text-sm font-bold text-[#101828]">{candidate.parentProjectName ?? candidate.projectName}</div>
            <p className="mt-1 text-xs leading-5 text-[#667085]">{candidate.parentCompanyName ? `Owner / buyer: ${candidate.parentCompanyName}` : `Owner / buyer: ${candidate.companyName}`}</p>
          </div>
          <div className="rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-3">
            <div className="text-xs font-bold uppercase text-[#667085]">2. Contractor layer</div>
            <div className="mt-2 text-sm font-bold text-[#101828]">{isContractorLead(candidate) ? candidate.companyName : `${awardedContractors.length} awarded contractor${awardedContractors.length === 1 ? "" : "s"}`}</div>
            <p className="mt-1 text-xs leading-5 text-[#667085]">{isContractorLead(candidate) ? candidate.contractorRole ?? "Contractor-side lead" : "Create contractor leads when the source names EPCs, suppliers, or subcontractors."}</p>
          </div>
          <div className="rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-3">
            <div className="text-xs font-bold uppercase text-[#667085]">3. People layer</div>
            <div className="mt-2 text-sm font-bold text-[#101828]">{contractorDecisionMakerCount} found decision maker{contractorDecisionMakerCount === 1 ? "" : "s"}</div>
            <p className="mt-1 text-xs leading-5 text-[#667085]">Role targets are search slots; named people with LinkedIn, email, phone, or source evidence appear in Found Decision Makers.</p>
          </div>
        </div>
      </section>

      {isContractorLead(candidate) ? (
        <section className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-4 shadow-sm">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <div className="text-xs font-bold uppercase text-[#1d4ed8]">Relationship context</div>
              <h2 className="mt-1 text-lg font-bold text-[#101828]">
                Contractor lead created from {candidate.parentCompanyName ?? "source project owner"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#475467]">
                Parent project: {candidate.parentProjectName ?? candidate.projectName}. Use this company for contractor-side procurement, contracts, package, and project contacts.
              </p>
            </div>
            <Badge tone="green">{candidate.contractorRole ?? candidate.signalType}</Badge>
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <section className="surface rounded-lg p-5">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div>
                <div className="flex items-center gap-2">
                  <Radar size={17} className="text-[#2563eb]" />
                  <h2 className="font-bold text-[#101828]">Intent And Package Fit</h2>
                </div>
                <p className="mt-1 text-sm leading-6 text-[#667085]">
                  Account-level topics are inferred from public project/source evidence. Private keyword-level intent can be plugged in later when an intent-data source is connected.
                </p>
              </div>
              <Badge tone="green">{candidate.confidence ? `${Math.round(candidate.confidence * 100)}% confidence` : "Evidence found"}</Badge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {adjacentMaterialPackages(candidate).map((item) => (
                <div key={item.name} className="rounded-lg border border-[#e4e7ec] bg-[#fbfcfe] p-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#101828]">
                    <Boxes size={15} className="text-[#2563eb]" />
                    {item.name}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#667085]">{item.detail}</p>
                  <div className="mt-3">
                    <Badge tone={item.confidence === "High" ? "green" : "amber"}>{item.confidence}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div>
                <h2 className="font-bold text-[#101828]">Awarded EPC / Contractor Map</h2>
                <p className="mt-1 text-sm leading-6 text-[#667085]">
                  Owner/buyer is the parent account. Awarded contractors are separate CRM leads only after you create or sync them; contractor role targets are search slots until real people are found.
                </p>
              </div>
              <Badge tone={awardedContractors.length > 0 ? "green" : "amber"}>
                {awardedContractors.length > 0 ? `${awardedContractors.length} extracted` : "Needs source pass"}
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-[#e4e7ec] bg-[#fbfcfe] p-3">
                <div className="text-xs font-bold uppercase text-[#667085]">Project owner / buyer</div>
                <div className="mt-2 font-bold text-[#101828]">{candidate.companyName}</div>
                <p className="mt-1 text-xs leading-5 text-[#667085]">{candidate.projectName}</p>
              </div>
              {awardedContractors.length > 0 ? (
                awardedContractors.map((contractor) => {
                  const contactJob = contactJobs.find((job) => job.id === contractorContactJobId(candidate.id, contractor.name));
                  const searchActive = isActiveContractorContactJob(contactJob);
                  const contractorLeadExists = Boolean(state.convertedDiscoveryLeads?.some((lead) => lead.id === contractorLeadId(candidate.id, contractor.name)));

                  return (
                  <div key={`${candidate.id}-${contractor.name}`} className="rounded-lg border border-[#e4e7ec] bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-bold text-[#101828]">{contractor.name}</div>
                      <Badge tone="green">{contractor.role || "Awarded party"}</Badge>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs leading-5 text-[#475467]">
                      {contractor.scope ? <DetailMeta label="Scope" value={contractor.scope} /> : null}
                      {contractor.packageHint ? <DetailMeta label="Likely package" value={contractor.packageHint} /> : null}
                      {contractor.contractValue ? <DetailMeta label="Contract value" value={contractor.contractValue} /> : null}
                      {contractor.country ? <DetailMeta label="Country" value={contractor.country} /> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => createContractorLead(contractor)}
                      title={contractorLeadExists ? "Refresh parent owner/project lineage on this contractor CRM lead" : "Create this awarded contractor as its own CRM lead under the parent project"}
                      className="focus-ring mt-3 inline-flex min-h-8 items-center gap-1 rounded-md bg-[#2563eb] px-3 py-1.5 text-xs font-bold leading-4 text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#98a2b3]"
                    >
                      <ListPlus size={13} className="shrink-0" />
                      <span>{contractorLeadExists ? "Sync parent context" : "Create contractor lead"}</span>
                    </button>
                    {contractorLeadExists ? (
                      <div className="mt-2 rounded-md border border-[#abefc6] bg-[#ecfdf3] px-2 py-1 text-xs font-semibold text-[#047857]">
                        CRM contractor lead exists. Parent lineage: {candidate.companyName} / {candidate.projectName}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => queueContractorContactSearch(contractor)}
                      disabled={searchActive}
                      className="focus-ring mt-2 inline-flex h-8 items-center gap-1 rounded-md border border-[#bfdbfe] bg-white px-2 text-xs font-bold text-[#1d4ed8] hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Users size={13} />
                      {searchActive ? "Searching sources" : contactJob?.status === "Contacts Found" ? "Search again" : "Find contractor contacts"}
                    </button>
                  </div>
                  );
                })
              ) : (
                <div className="rounded-lg border border-dashed border-[#d0d5dd] bg-[#fbfcfe] p-3">
                  <div className="font-bold text-[#101828]">No awarded company extracted yet</div>
                  <p className="mt-2 text-sm leading-6 text-[#667085]">
                    This candidate has project evidence, but the source did not produce a structured contractor name. Open the source or rerun live discovery with terms like EPC contractor, subcontractors, or awarded companies.
                  </p>
                </div>
              )}
            </div>
            {awardedContractors.length > 0 ? (
              <div className="mt-4 rounded-lg border border-[#e4e7ec] bg-[#fbfcfe] p-3">
                <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
                  <div>
                    <h3 className="text-sm font-bold text-[#101828]">Contractor Contact Prospecting</h3>
                    <p className="mt-1 text-xs leading-5 text-[#667085]">This is the search plan: role slots to fill for each contractor. Real named people appear below in Found Decision Makers only after a source/profile trail is found.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="neutral">{contractorProspectRows.length} role targets</Badge>
                    <Badge tone={contractorDecisionMakerCount > 0 ? "green" : "neutral"}>{contractorDecisionMakerCount} real people saved</Badge>
                    <Badge tone="neutral">{contactJobs.filter((job) => job.id.startsWith("contractor-contact-")).length} contractor jobs</Badge>
                  </div>
                </div>
                {contractorWorkflowNotice ? (
                  <div className="mt-3 rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2 text-xs font-semibold text-[#1d4ed8]">{contractorWorkflowNotice}</div>
                ) : null}
                <div className="mt-3 overflow-x-auto">
                  <ResponsiveTable className="w-full min-w-[780px] text-left text-sm">
                    <thead className="bg-white text-xs uppercase text-[#667085]">
                      <tr>
                        <th className="px-3 py-2">Contractor</th>
                        <th className="px-3 py-2">Package / Scope</th>
                        <th className="px-3 py-2">Target Roles</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {awardedContractors.map((contractor) => {
                        const job = contactJobs.find((item) => item.id === contractorContactJobId(candidate.id, contractor.name));
                        return (
                          <tr key={`${candidate.id}-${contractor.name}-prospecting`} className="border-t border-[#e4e7ec] align-top">
                            <td className="px-3 py-3">
                              <div className="font-bold text-[#101828]">{contractor.name}</div>
                              <div className="mt-1 text-xs text-[#667085]">{contractor.role ?? "Awarded contractor"}</div>
                            </td>
                            <td className="max-w-[260px] px-3 py-3 text-xs leading-5 text-[#475467]">{contractor.packageHint || contractor.scope || "Package scope pending"}</td>
                            <td className="px-3 py-3">
                              <div className="flex max-w-[320px] flex-wrap gap-1">
                                {packageRolesForContractor(contractor, candidate).slice(0, 8).map((role) => (
                                  <span key={`${contractor.name}-${role}`} className="rounded-md border border-[#d0d5dd] bg-white px-2 py-1 text-xs font-semibold text-[#475467]">{role}</span>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <Badge tone={job ? "amber" : "neutral"}>{job?.status ?? "Not queued"}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </ResponsiveTable>
                </div>
              </div>
            ) : null}
          </section>

          {contractorProspectRows.length > 0 ? (
            <section className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                <div>
                  <h2 className="font-bold text-[#101828]">Open Contractor Role Targets</h2>
                  <p className="mt-1 text-sm leading-6 text-[#667085]">
                    These are not leads yet. They are empty buying-committee slots generated from the contractor scope; use them to search, then save only real people with evidence into Found Decision Makers.
                  </p>
                </div>
                <Badge tone="neutral">{contractorProspectRows.length} open targets</Badge>
              </div>
              <div className="mt-4 overflow-x-auto rounded-md border border-[#e4e7ec]">
                <ResponsiveTable className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
                    <tr>
                      <th className="px-3 py-2">Contractor</th>
                      <th className="px-3 py-2">Target Role</th>
                      <th className="px-3 py-2">Package Fit</th>
                      <th className="px-3 py-2">Person</th>
                      <th className="px-3 py-2">LinkedIn</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractorProspectRows.map((prospect) => (
                      <tr key={prospect.id} className="border-t border-[#e4e7ec] align-top">
                        <td className="px-3 py-3">
                          <div className="font-bold text-[#101828]">{prospect.contractor.name}</div>
                          <div className="mt-1 text-xs text-[#667085]">{prospect.contractor.role ?? "Contractor lead"}</div>
                          {prospect.queued ? <div className="mt-2"><Badge tone="amber">Search queued</Badge></div> : null}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-[#101828]">{prospect.role}</div>
                          <div className="mt-1 text-xs text-[#667085]">{prospect.department} / {prospect.seniority}</div>
                        </td>
                        <td className="max-w-[250px] px-3 py-3 text-xs leading-5 text-[#475467]">{prospect.packageScope}</td>
                        <td className="px-3 py-3">
                          {prospect.existing ? (
                            <div>
                              <div className="font-bold text-[#101828]">{prospect.existing.name}</div>
                              <div className="mt-1 text-xs text-[#667085]">{prospect.existing.title}</div>
                            </div>
                          ) : (
                            <Badge tone="neutral">Person pending</Badge>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {prospect.existing?.linkedinUrl ? (
                            <a href={prospect.existing.linkedinUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#2563eb]">Open profile</a>
                          ) : (
                            <Badge tone="neutral">Pending</Badge>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={prospect.existing ? emailTone(prospect.existing.emailStatus) : "neutral"}>{prospect.existing?.emailStatus ?? "Pending"}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => prepareDecisionMakerFromProspect(prospect)}
                            className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-[#bfdbfe] bg-white px-2 text-xs font-bold text-[#1d4ed8] hover:bg-[#eff6ff]"
                          >
                            <UserPlus size={13} />
                            {prospect.existing ? "Review contact" : "Prepare contact"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </ResponsiveTable>
              </div>
            </section>
          ) : null}

          {contactJobs.filter((job) => job.id.startsWith("contractor-contact-")).length > 0 ? (
            <section className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                <div>
                  <h2 className="font-bold text-[#101828]">Contact Search Proof Trail</h2>
                  <p className="mt-1 text-sm leading-6 text-[#667085]">
                    Audit trail for contractor people search: queries used, sources read, contacts patched, and any provider/source errors.
                  </p>
                </div>
                <Badge tone="neutral">{contactJobs.filter((job) => job.id.startsWith("contractor-contact-")).length} searches</Badge>
              </div>
              <div className="mt-4 grid gap-3">
                {contactJobs.filter((job) => job.id.startsWith("contractor-contact-")).map((job) => {
                  const queries = jobResultArray(job, "queries");
                  const errors = jobResultArray(job, "errors");
                  const sourcesRead = jobResultNumber(job, "sourcesRead");
                  const contactsFound = jobResultNumber(job, "contactsFound");
                  const sourceUrl = jobResultString(job, "sourceUrl");

                  return (
                    <div key={job.id} className="rounded-lg border border-[#e4e7ec] bg-[#fbfcfe] p-3">
                      <div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-bold text-[#101828]">{job.companyName ?? "Contractor search"}</h3>
                            <Badge tone={contactJobTone(job)}>{job.status ?? "Queued"}</Badge>
                            {contactsFound > 0 ? <Badge tone="green">{contactsFound} contact{contactsFound === 1 ? "" : "s"} patched</Badge> : null}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-[#667085]">
                            Parent project: {job.projectName ?? candidate.projectName}. Sources read: {sourcesRead}. Queued {formatDateTime(job.queuedAt)}{job.completedAt ? `, completed ${formatDateTime(job.completedAt)}` : ""}.
                          </p>
                        </div>
                        {sourceUrl ? (
                          <a href={sourceUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex h-8 w-fit items-center gap-1 rounded-md border border-[#bfdbfe] bg-white px-2 text-xs font-bold text-[#1d4ed8] hover:bg-[#eff6ff]">
                            <ExternalLink size={13} />
                            Parent source
                          </a>
                        ) : null}
                      </div>

                      {queries.length > 0 ? (
                        <div className="mt-3 rounded-md border border-[#d0d5dd] bg-white p-2">
                          <div className="text-[11px] font-bold uppercase text-[#667085]">Search queries used</div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {queries.slice(0, 6).map((query) => (
                              <span key={`${job.id}-${query}`} className="rounded border border-[#d0d5dd] bg-[#fbfcfe] px-2 py-1 text-[11px] font-semibold text-[#475467]">{query}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        <ProofMetric label="Sources read" value={String(sourcesRead)} tone={sourcesRead > 0 ? "green" : "amber"} />
                        <ProofMetric label="Contacts patched" value={String(contactsFound)} tone={contactsFound > 0 ? "green" : "neutral"} />
                        <ProofMetric label="Errors" value={String(errors.length + (job.error ? 1 : 0))} tone={errors.length || job.error ? "amber" : "green"} />
                      </div>

                      {(errors.length > 0 || job.error) ? (
                        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2">
                          <div className="text-[11px] font-bold uppercase text-amber-900">Needs review</div>
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-amber-950">
                            {job.error ? <li>{job.error}</li> : null}
                            {errors.slice(0, 3).map((error) => <li key={`${job.id}-${error}`}>{error}</li>)}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
            <h2 className="font-bold text-[#101828]">Requirement Evidence</h2>
            <p className="mt-3 rounded-md bg-[#f8fafc] p-3 text-sm leading-6 text-[#344054]">{candidate.requirementSummary}</p>
          </section>

          <section className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
            <h2 className="font-bold text-[#101828]">Source Evidence</h2>
            <div className="mt-3 rounded-md border border-[#e4e7ec] p-3">
              <div className="truncate text-sm font-semibold text-[#344054]">{candidate.sourceUrl}</div>
              <div className="mt-2 text-xs text-[#667085]">Saved {formatDateTime(candidate.savedAt)}</div>
            </div>
          </section>

          <section className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
            <h2 className="font-bold text-[#101828]">Queue History</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <QueuePanel title="Decision Maker Jobs" jobs={contactJobs} />
              <QueuePanel title="Email Verification Jobs" jobs={emailJobs} />
            </div>
          </section>

          <section className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <h2 className="font-bold text-[#101828]">CRM Activity Timeline</h2>
                <p className="mt-1 text-sm text-[#667085]">Track notes, calls, emails, meetings, verification events, and next steps for this lead.</p>
              </div>
              <Badge tone={crmActivities.length > 0 ? "green" : "neutral"}>{crmActivities.length} activities</Badge>
            </div>

            {converted ? (
              <div className="mt-4 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <FormSelect label="Activity Type" value={activityForm.activityType} options={activityTypes} onChange={(value) => setActivityForm((current) => ({ ...current, activityType: value as CrmActivityType }))} />
                  <FormInput label="Title" value={activityForm.title} onChange={(value) => setActivityForm((current) => ({ ...current, title: value }))} placeholder="Follow-up note or task title" />
                  <label className="block md:col-span-2">
                    <span className="text-xs font-bold uppercase text-[#667085]">Details</span>
                    <textarea value={activityForm.body} onChange={(event) => setActivityForm((current) => ({ ...current, body: event.target.value }))} placeholder="What happened, what was learned, or what needs to be done" className="focus-ring mt-2 min-h-24 w-full rounded-md border border-[#d0d5dd] bg-white px-3 py-2 text-sm outline-none" />
                  </label>
                  <FormInput label="Outcome" value={activityForm.outcome} onChange={(value) => setActivityForm((current) => ({ ...current, outcome: value }))} placeholder="Qualified, no response, verified..." />
                  <FormInput label="Next Step" value={activityForm.nextStep} onChange={(value) => setActivityForm((current) => ({ ...current, nextStep: value }))} placeholder="Call procurement, verify email..." />
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-[#667085]">Due Date</span>
                    <input type="datetime-local" value={activityForm.dueAt} onChange={(event) => setActivityForm((current) => ({ ...current, dueAt: event.target.value }))} className="focus-ring mt-2 h-10 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-sm outline-none" />
                  </label>
                  <FormInput label="Source URL" value={activityForm.sourceUrl} onChange={(value) => setActivityForm((current) => ({ ...current, sourceUrl: value }))} placeholder="Optional evidence or thread URL" />
                </div>
                <button
                  type="button"
                  onClick={addCrmActivity}
                  disabled={isSavingActivity || !activityForm.title.trim()}
                  className="focus-ring mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-[#2563eb] px-4 text-sm font-bold text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#9db7f8]"
                >
                  <NotebookPen size={16} />
                  {isSavingActivity ? "Saving" : "Add Activity"}
                </button>
              </div>
            ) : (
              <p className="mt-3 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-3 text-sm text-[#667085]">Convert this candidate to a CRM lead before adding activity.</p>
            )}

            <ActivityTimeline activities={crmActivities} />
          </section>

          <section className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <h2 className="font-bold text-[#101828]">Found Decision Makers</h2>
                <p className="mt-1 text-sm text-[#667085]">This is the real contact layer. People here are source-backed names; email, LinkedIn, and phone fields remain pending unless the system or a researcher finds evidence.</p>
              </div>
              <Badge tone={decisionMakers.length > 0 ? "green" : "neutral"}>{decisionMakers.length} saved</Badge>
            </div>

            {converted ? (
              <div className="mt-4 grid gap-3 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-3 md:grid-cols-2">
                <FormInput label="Company" value={decisionMakerForm.companyName} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, companyName: value }))} placeholder={candidate.companyName} />
                <FormInput label="Name" value={decisionMakerForm.name} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, name: value }))} placeholder="Full name" />
                <FormInput label="Title" value={decisionMakerForm.title} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, title: value }))} placeholder="Procurement Director" />
                <FormSelect label="Department" value={decisionMakerForm.department} options={departments} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, department: value }))} />
                <FormSelect label="Seniority" value={decisionMakerForm.seniority} options={seniorityLevels} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, seniority: value }))} />
                <FormInput label="Location" value={decisionMakerForm.location} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, location: value }))} placeholder="City, country" />
                <FormInput label="LinkedIn URL" value={decisionMakerForm.linkedinUrl} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, linkedinUrl: value }))} placeholder="https://linkedin.com/in/..." />
                <FormInput label="Email" value={decisionMakerForm.email} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, email: value }))} placeholder="Leave blank unless found" />
                <FormSelect label="Email Candidate Type" value={decisionMakerForm.emailCandidateType} options={emailCandidateTypes} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, emailCandidateType: value as typeof emailCandidateTypes[number] }))} />
                <FormInput label="Phone" value={decisionMakerForm.phone} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, phone: value }))} placeholder="Company or direct phone if sourced" />
                <FormSelect label="Phone Status" value={decisionMakerForm.phoneStatus} options={phoneStatuses} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, phoneStatus: value as typeof phoneStatuses[number] }))} />
                <FormInput label="Phone Source URL" value={decisionMakerForm.phoneSourceUrl} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, phoneSourceUrl: value }))} placeholder="Phone evidence URL" />
                <FormSelect label="LinkedIn Status" value={decisionMakerForm.linkedinStatus} options={linkedinStatuses} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, linkedinStatus: value as typeof linkedinStatuses[number] }))} />
                <FormSelect label="Data Source" value={decisionMakerForm.dataSourceType} options={dataSourceTypes} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, dataSourceType: value as typeof dataSourceTypes[number] }))} />
                <FormInput label="Confidence" value={String(decisionMakerForm.confidence)} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, confidence: Math.max(0, Math.min(100, Number(value) || 0)) }))} placeholder="0-100" />
                <FormInput label="Verification Source" value={decisionMakerForm.verificationSource} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, verificationSource: value }))} placeholder="Company site, LinkedIn, email verifier" />
                <FormInput label="Source URL" value={decisionMakerForm.sourceUrl} onChange={(value) => setDecisionMakerForm((current) => ({ ...current, sourceUrl: value }))} placeholder="Evidence URL" />
                <label className="block md:col-span-2">
                  <span className="text-xs font-bold uppercase text-[#667085]">Evidence Notes</span>
                  <textarea value={decisionMakerForm.evidenceNotes} onChange={(event) => setDecisionMakerForm((current) => ({ ...current, evidenceNotes: event.target.value }))} placeholder="Why this person is relevant, where the contact data came from, and what still needs verification" className="focus-ring mt-2 min-h-20 w-full rounded-md border border-[#d0d5dd] bg-white px-3 py-2 text-sm outline-none" />
                </label>
                <div className="md:col-span-2">
                  <button
                    type="button"
                    onClick={addDecisionMaker}
                    disabled={isSavingDecisionMaker || !decisionMakerForm.name.trim() || !decisionMakerForm.title.trim()}
                    className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-[#2563eb] px-4 text-sm font-bold text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#9db7f8]"
                  >
                    <UserPlus size={16} />
                    {isSavingDecisionMaker ? "Saving" : "Add Decision Maker"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-3 text-sm text-[#667085]">Convert this candidate to a CRM lead before adding people.</p>
            )}

            <div className="mt-4 overflow-x-auto">
              <ResponsiveTable className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
                  <tr>
                    <th className="px-3 py-2">Person</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">LinkedIn</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {decisionMakers.map((person) => (
                    <tr key={person.id} className="border-t border-[#e4e7ec] align-top">
                      <td className="px-3 py-3">
                        <input
                          value={person.name}
                          onChange={(event) => updateDecisionMaker(person.id, { name: event.target.value })}
                          className="focus-ring h-9 w-full rounded-md border border-[#d0d5dd] bg-white px-2 text-xs font-bold text-[#101828] outline-none"
                        />
                        <input
                          value={person.location ?? ""}
                          onChange={(event) => updateDecisionMaker(person.id, { location: event.target.value })}
                          className="focus-ring mt-2 h-8 w-full rounded-md border border-[#d0d5dd] bg-white px-2 text-xs text-[#667085] outline-none"
                          placeholder="Location pending"
                        />
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge tone={contactTrustTone(person)}>{contactTrustLabel(person)}</Badge>
                          <Badge tone={(person.confidence ?? 0) >= 80 ? "green" : (person.confidence ?? 0) >= 65 ? "amber" : "neutral"}>{person.confidence ?? 50}% confidence</Badge>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <input
                          value={person.title}
                          onChange={(event) => updateDecisionMaker(person.id, { title: event.target.value })}
                          className="focus-ring h-9 w-full rounded-md border border-[#d0d5dd] bg-white px-2 text-xs font-semibold text-[#344054] outline-none"
                        />
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <select value={person.department} onChange={(event) => updateDecisionMaker(person.id, { department: event.target.value })} className="focus-ring h-8 rounded-md border border-[#d0d5dd] bg-white px-2 text-xs outline-none">
                            {departments.map((department) => <option key={department} value={department}>{department}</option>)}
                          </select>
                          <select value={person.seniority} onChange={(event) => updateDecisionMaker(person.id, { seniority: event.target.value })} className="focus-ring h-8 rounded-md border border-[#d0d5dd] bg-white px-2 text-xs outline-none">
                            {seniorityLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                          </select>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={emailTone(person.emailStatus)}>{person.emailStatus}</Badge>
                        <input
                          value={person.email ?? ""}
                          onChange={(event) => updateDecisionMaker(person.id, { email: event.target.value, emailStatus: event.target.value ? "Verification Pending" : "Email Not Found", verifiedAt: undefined, verificationSource: undefined, emailCandidateType: event.target.value ? (person.emailCandidateType ?? "source-backed") : "unknown" })}
                          className="focus-ring mt-2 h-8 w-full rounded-md border border-[#d0d5dd] bg-white px-2 text-xs text-[#667085] outline-none"
                          placeholder="No email displayed"
                        />
                        <select value={person.emailCandidateType ?? "unknown"} onChange={(event) => updateDecisionMaker(person.id, { emailCandidateType: event.target.value as EnrichedDecisionMaker["emailCandidateType"] })} className="focus-ring mt-2 h-8 w-full rounded-md border border-[#d0d5dd] bg-white px-2 text-xs outline-none">
                          {emailCandidateTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={person.phoneStatus === "Verified" ? "green" : person.phone ? "amber" : "neutral"}>{person.phoneStatus ?? "Not Found"}</Badge>
                        <input
                          value={person.phone ?? ""}
                          onChange={(event) => updateDecisionMaker(person.id, { phone: event.target.value, phoneStatus: event.target.value ? "Candidate Found" : "Not Found" })}
                          className="focus-ring mt-2 h-8 w-full rounded-md border border-[#d0d5dd] bg-white px-2 text-xs text-[#667085] outline-none"
                          placeholder="No phone found"
                        />
                        <input
                          value={person.phoneSourceUrl ?? ""}
                          onChange={(event) => updateDecisionMaker(person.id, { phoneSourceUrl: event.target.value })}
                          className="focus-ring mt-2 h-8 w-full rounded-md border border-[#d0d5dd] bg-white px-2 text-xs outline-none"
                          placeholder="Phone source URL"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={person.linkedinUrl ? "green" : "neutral"}>{person.linkedinStatus ?? (person.linkedinUrl ? "Profile Found" : "Not Found")}</Badge>
                        <input
                          value={person.linkedinUrl ?? ""}
                          onChange={(event) => updateDecisionMaker(person.id, { linkedinUrl: event.target.value, linkedinStatus: event.target.value ? "Profile Found" : "Not Found" })}
                          className="focus-ring mt-2 h-8 w-full rounded-md border border-[#d0d5dd] bg-white px-2 text-xs outline-none"
                          placeholder="LinkedIn URL"
                        />
                        {person.linkedinUrl ? (
                          <a href={person.linkedinUrl} target="_blank" rel="noreferrer" className="focus-ring mt-2 inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d5dd] bg-white px-2 text-xs font-bold text-[#0b66c3] hover:bg-[#f8fafc]">
                            <LinkIcon size={13} />
                            Open
                          </a>
                        ) : <span className="text-xs text-[#667085]">Not found</span>}
                      </td>
                      <td className="px-3 py-3">
                        <input
                          value={person.verificationSource ?? ""}
                          onChange={(event) => updateDecisionMaker(person.id, { verificationSource: event.target.value })}
                          className="focus-ring h-8 w-full rounded-md border border-[#d0d5dd] bg-white px-2 text-xs font-semibold text-[#344054] outline-none"
                          placeholder="Source pending"
                        />
                        <input
                          value={person.sourceUrl ?? ""}
                          onChange={(event) => updateDecisionMaker(person.id, { sourceUrl: event.target.value })}
                          className="focus-ring mt-2 h-8 w-full rounded-md border border-[#d0d5dd] bg-white px-2 text-xs outline-none"
                          placeholder="Evidence URL"
                        />
                        {person.sourceUrl ? (
                          <a href={person.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-[#2563eb]">Evidence</a>
                        ) : null}
                        {person.evidenceSignals?.length ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {person.evidenceSignals.slice(0, 4).map((signal) => (
                              <span key={`${person.id}-${signal}`} className="rounded border border-[#d0d5dd] bg-[#f8fafc] px-2 py-0.5 text-[11px] font-semibold text-[#475467]">{signal}</span>
                            ))}
                          </div>
                        ) : null}
                        {person.confidenceBreakdown ? (
                          <div className="mt-2 rounded-md border border-[#e4e7ec] bg-white p-2 text-[11px] leading-5 text-[#667085]">
                            <div className="font-bold uppercase text-[#475467]">Confidence basis</div>
                            <div>Base {person.confidenceBreakdown.base} + profile {person.confidenceBreakdown.professionalProfile} + direct {person.confidenceBreakdown.directContact} + source {person.confidenceBreakdown.sourcePage}</div>
                          </div>
                        ) : null}
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <select value={person.dataSourceType ?? "Manual research"} onChange={(event) => updateDecisionMaker(person.id, { dataSourceType: event.target.value as EnrichedDecisionMaker["dataSourceType"] })} className="focus-ring h-8 rounded-md border border-[#d0d5dd] bg-white px-2 text-xs outline-none">
                            {dataSourceTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                          </select>
                          <input
                            value={String(person.confidence ?? 50)}
                            onChange={(event) => updateDecisionMaker(person.id, { confidence: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })}
                            className="focus-ring h-8 rounded-md border border-[#d0d5dd] bg-white px-2 text-xs outline-none"
                            placeholder="Confidence"
                          />
                        </div>
                        <textarea
                          value={person.evidenceNotes ?? ""}
                          onChange={(event) => updateDecisionMaker(person.id, { evidenceNotes: event.target.value })}
                          className="focus-ring mt-2 min-h-16 w-full rounded-md border border-[#d0d5dd] bg-white px-2 py-2 text-xs outline-none"
                          placeholder="Evidence notes"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-2">
                          <Badge tone={emailTone(person.emailStatus)}>{person.emailStatus}</Badge>
                          {savingDecisionMakerIds.includes(person.id) ? <Badge tone="amber">Saving</Badge> : null}
                          <button
                            type="button"
                            onClick={() => queueDecisionMakerEmail(person)}
                            className="focus-ring inline-flex h-8 w-fit items-center gap-1 rounded-md bg-[#2563eb] px-2 text-xs font-bold text-white hover:bg-[#1d4ed8]"
                          >
                            <MailCheck size={13} />
                            Queue Verify
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
            {decisionMakers.length === 0 ? (
              <div className="mt-4 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-5 text-center text-sm text-[#667085]">No decision makers saved yet.</div>
            ) : null}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Users size={17} className="text-[#2563eb]" />
              <h2 className="font-bold text-[#101828]">Decision Maker Search</h2>
            </div>
            <div className="mt-3">
              <Badge tone={converted?.enrichmentStatus === "Decision Maker Search Queued" ? "amber" : "neutral"}>
                {converted?.enrichmentStatus ?? "Not Started"}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(converted?.targetRoles ?? targetDecisionMakerRoles).map((role) => (
                <span key={role} className="rounded-md border border-[#d0d5dd] bg-[#fbfcfe] px-2 py-1 text-xs font-semibold text-[#475467]">{role}</span>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <MailCheck size={17} className="text-[#2563eb]" />
              <h2 className="font-bold text-[#101828]">Email Verification</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#667085]">No email is displayed until it has been found and verified by the enrichment pipeline.</p>
          </section>

          <section className="rounded-lg border border-[#d0d5dd] bg-white p-5 shadow-sm">
            <h2 className="font-bold text-[#101828]">Notes</h2>
            <p className="mt-3 min-h-16 rounded-md bg-[#f8fafc] p-3 text-sm leading-6 text-[#344054]">{candidate.notes || "No quick notes yet. Use the CRM timeline for dated follow-up history."}</p>
          </section>
        </aside>
      </section>
    </div>
  );
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
  const byId = new Map(items.map((current) => [current.id, current]));
  byId.set(item.id, item);
  return Array.from(byId.values());
}

function mergeActivities(base: CrmActivity[], incoming: CrmActivity[]) {
  const byId = new Map(base.map((activity) => [activity.id, activity]));
  incoming.forEach((activity) => byId.set(activity.id, activity));
  return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#d0d5dd] bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase text-[#667085]">{label}</div>
      <div className="mt-2 font-bold text-[#101828]">{value}</div>
    </div>
  );
}

function DetailMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-bold uppercase text-[#667085]">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

function emailTone(status: string) {
  if (status === "Verified") return "green";
  if (status === "Risky") return "amber";
  if (status === "Email Not Found") return "red";
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

function contactJobTone(job: DiscoveryQueueJob) {
  if (job.error) return "red";
  if (job.status === "Contacts Found") return "green";
  if (job.status === "No Source Contact") return "amber";
  return "neutral";
}

function ProofMetric({ label, value, tone }: { label: string; value: string; tone: "green" | "amber" | "neutral" }) {
  const toneClass =
    tone === "green"
      ? "border-[#abefc6] bg-[#ecfdf3] text-[#067647]"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-[#d0d5dd] bg-white text-[#475467]";

  return (
    <div className={`rounded-md border p-2 ${toneClass}`}>
      <div className="text-[11px] font-bold uppercase">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}

function FormInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase text-[#667085]">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="focus-ring mt-2 h-10 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-sm outline-none" />
    </label>
  );
}

function FormSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase text-[#667085]">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="focus-ring mt-2 h-10 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-sm outline-none">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function QueuePanel({ title, jobs }: { title: string; jobs: DiscoveryQueueJob[] }) {
  return (
    <div className="rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-3">
      <div className="text-sm font-bold text-[#101828]">{title}</div>
      {jobs.length > 0 ? (
        <div className="mt-3 space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-md border border-[#d0d5dd] bg-white p-2">
              <Badge tone={job.status === "Completed" ? "green" : job.error ? "red" : "amber"}>{job.status ?? "Queued"}</Badge>
              <div className="mt-2 text-xs text-[#667085]">
                Queued {formatDateTime(job.queuedAt)}
              </div>
              {job.targetRoles?.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {job.targetRoles.slice(0, 4).map((role) => (
                    <span key={`${job.id}-${role}`} className="rounded border border-[#d0d5dd] bg-[#fbfcfe] px-1.5 py-0.5 text-[11px] font-semibold text-[#475467]">{role}</span>
                  ))}
                </div>
              ) : null}
              {jobResultString(job, "packageHint") || jobResultString(job, "scope") ? (
                <div className="mt-2 text-xs leading-5 text-[#667085]">{jobResultString(job, "packageHint") || jobResultString(job, "scope")}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[#667085]">No queue records yet.</p>
      )}
    </div>
  );
}

function ActivityTimeline({ activities }: { activities: CrmActivity[] }) {
  if (activities.length === 0) {
    return (
      <div className="mt-4 rounded-md border border-[#e4e7ec] bg-white p-5 text-center text-sm text-[#667085]">
        No CRM activity yet.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {activities.map((activity) => (
        <div key={activity.id} className="rounded-md border border-[#e4e7ec] bg-white p-3">
          <div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={activity.activityType === "verification" ? "green" : activity.activityType === "task" ? "amber" : "neutral"}>
                  {activity.activityType.replaceAll("_", " ")}
                </Badge>
                <h3 className="text-sm font-bold text-[#101828]">{activity.title}</h3>
              </div>
              {activity.body ? <p className="mt-2 text-sm leading-6 text-[#475467]">{activity.body}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[#667085]">
              <Clock size={13} />
              {formatDateTime(activity.createdAt)}
            </div>
          </div>
          {(activity.outcome || activity.nextStep || activity.dueAt || activity.sourceUrl) ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {activity.outcome ? <TimelineMeta label="Outcome" value={activity.outcome} /> : null}
              {activity.nextStep ? <TimelineMeta label="Next Step" value={activity.nextStep} /> : null}
              {activity.dueAt ? <TimelineMeta label="Due" value={formatDateTime(activity.dueAt)} /> : null}
              {activity.sourceUrl ? (
                <a href={activity.sourceUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex h-8 w-fit items-center gap-2 rounded-md border border-[#d0d5dd] bg-white px-3 text-xs font-bold text-[#2563eb] hover:bg-[#f8fafc]">
                  <ExternalLink size={13} />
                  Evidence
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TimelineMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[#f8fafc] px-3 py-2">
      <div className="text-[11px] font-bold uppercase text-[#667085]">{label}</div>
      <div className="mt-1 text-xs font-semibold text-[#344054]">{value}</div>
    </div>
  );
}
