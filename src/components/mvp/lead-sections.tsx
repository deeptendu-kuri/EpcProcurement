"use client";

import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, MinusCircle, XCircle } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import type {
  CheckStatus,
  ChecklistItem,
  CompanyContactView,
  CompanyInsights,
  FactEntityType,
  FactEvidenceRow,
  GateResult,
  LeadDetail,
  PackageView,
  PartyView,
  PersonOutreach,
  PersonView,
  ProjectStage,
  Reason,
  RequirementRow,
  SignalRow,
} from "@/mvp/types";
import { EvidenceButton } from "./evidence";
import { NotFound, Section } from "./section";
import {
  BUYING_ROLE_LABELS,
  CHECK_LABELS,
  FAILED_CHECK_TITLES,
  PARTY_ROLE_LABELS,
  PERMISSION_LABELS,
  STAGE_LABELS,
  STAGE_PATH,
  disciplineLabel,
  formatDate,
  formatMoney,
  formatSpec,
  rejectReasonLabel,
} from "./labels";

/** Evidence ids recorded for an entity (optionally only some fields; '*' rows always count). */
export function factIds(facts: FactEvidenceRow[], type: FactEntityType, id: string | null | undefined, fields?: string[]): string[] {
  if (!id) return [];
  return facts
    .filter((fact) => fact.entity_type === type && fact.entity_id === id && (!fields || fact.field === "*" || fields.includes(fact.field)))
    .map((fact) => fact.evidence_id);
}

/** "Jubail, Eastern Province, Saudi Arabia" without repeats ("Saudi Arabia, Saudi Arabia"). Exported for tests. */
export function locationLabel(...parts: (string | null | undefined)[]): string {
  const out: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (out.some((existing) => existing.toLowerCase() === key || existing.toLowerCase().includes(key) || key.includes(existing.toLowerCase()))) continue;
    out.push(value);
  }
  return out.join(", ");
}

// ───────────────────────── rejected banner ─────────────────────────

export function RejectedBanner({ gates, leadClass, status, rejectReason }: {
  gates: GateResult[];
  leadClass: string;
  status: string;
  rejectReason: string | null;
}) {
  const failed = gates.filter((gate) => !gate.pass);
  const userRejected = status === "rejected";
  if (leadClass !== "rejected" && !userRejected) return null;
  return (
    <div role="note" className="flex gap-2 rounded-xl border border-[#fecdca] bg-[#fef3f2] p-3 text-sm text-[#b42318]">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="space-y-1">
        {leadClass === "rejected" ? (
          failed.length ? (
            failed.map((gate) => (
              <p key={gate.id}>
                <span className="font-bold">Not a buyer: {FAILED_CHECK_TITLES[gate.id] ?? "a required check failed"}.</span>{" "}
                {gate.why}
              </p>
            ))
          ) : (
            <p className="font-bold">Not a buyer: a required check failed.</p>
          )
        ) : null}
        {userRejected ? (
          <p>
            <span className="font-bold">You marked this buyer not relevant</span>
            {rejectReason ? `: ${rejectReasonLabel(rejectReason)}` : "."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ───────────────────────── why this lead ─────────────────────────

export function WhySection({ reasons, signals }: { reasons: Reason[]; signals: SignalRow[] }) {
  return (
    <Section id="why" title="Why this buyer">
      {reasons.length ? (
        <ul className="list-disc space-y-1 pl-5">
          {reasons.map((reason, index) => (
            <li key={index}>
              {reason.text}
              <EvidenceButton ids={reason.evidenceIds} label="Why this buyer" />
            </li>
          ))}
        </ul>
      ) : (
        <NotFound text="No reasons recorded yet." />
      )}
      {signals.length ? (
        <div className="mt-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[#667085]">What happened</h3>
          <ul className="mt-1 space-y-0.5 text-sm">
            {signals.slice(0, 8).map((signal) => (
              <li key={signal.id}>
                <span className="tabular-nums text-[#667085]">{formatDate(signal.signal_date)}</span> · {signal.summary}
                <EvidenceButton ids={signal.evidence_ids} label={signal.summary} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

// ───────────────────────── project ─────────────────────────

export function ProjectSection({ detail }: { detail: LeadDetail }) {
  const { project, projectOwner, stageEvents, facts } = detail;
  if (!project) {
    return (
      <Section id="project" title="Project">
        <NotFound text="No project linked to this buyer yet." />
      </Section>
    );
  }
  const location = locationLabel(project.site, project.region, project.country ? marketName(project.country) : null);
  const value = formatMoney(project.estimated_value, project.currency);
  const valueUsd = project.value_usd && project.currency?.toUpperCase() !== "USD" ? formatMoney(project.value_usd, "USD") : "";

  const reached = new Map<ProjectStage, (typeof stageEvents)[number]>();
  for (const event of stageEvents) if (!reached.has(event.stage)) reached.set(event.stage, event);
  const currentIndex = project.current_stage ? STAGE_PATH.indexOf(project.current_stage) : -1;
  const flags = (["on_hold", "cancelled", "completed"] as ProjectStage[]).filter(
    (stage) => project.current_stage === stage || reached.has(stage),
  );

  return (
    <Section id="project" title="Project">
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold text-[#667085]">Name</dt>
        <dd>{project.name}<EvidenceButton ids={factIds(facts, "project", project.id, ["name"])} label="Project" /></dd>
        <dt className="font-semibold text-[#667085]">Owner</dt>
        <dd>
          {projectOwner?.canonical_name ?? <NotFound />}
          <EvidenceButton ids={factIds(facts, "project", project.id, ["owner_company_id"])} label="Owner" />
        </dd>
        <dt className="font-semibold text-[#667085]">Location</dt>
        <dd>{location || <NotFound />}<EvidenceButton ids={factIds(facts, "project", project.id, ["site", "region", "country"])} label="Location" /></dd>
        <dt className="font-semibold text-[#667085]">Value</dt>
        <dd className="tabular-nums">
          {value ? `${value}${valueUsd ? ` (≈ ${valueUsd})` : ""}` : <NotFound />}
          <EvidenceButton ids={factIds(facts, "project", project.id, ["estimated_value", "value_usd"])} label="Value" />
        </dd>
        {project.sector ? (
          <>
            <dt className="font-semibold text-[#667085]">Sector</dt>
            <dd>{disciplineLabel(project.sector)}</dd>
          </>
        ) : null}
      </dl>

      <div className="mt-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[#667085]">Stage</h3>
        <ol className="mt-2 flex flex-wrap items-center gap-y-2 text-xs" aria-label="Project stages">
          {STAGE_PATH.map((stage, index) => {
            const event = reached.get(stage);
            const isCurrent = stage === project.current_stage;
            const passed = currentIndex >= 0 && index < currentIndex;
            return (
              <li key={stage} className="flex items-center">
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                    isCurrent
                      ? "bg-[#2563eb] text-white"
                      : passed || event
                        ? "bg-[#eef4ff] text-[#1d4ed8]"
                        : "text-[#98a2b3]"
                  }`}
                >
                  {isCurrent ? <span aria-hidden>●</span> : null}
                  {STAGE_LABELS[stage]}
                  {event?.event_date ? <span className="font-normal opacity-80">{formatDate(event.event_date)}</span> : null}
                </span>
                {event ? <EvidenceButton ids={[event.evidence_id]} label={STAGE_LABELS[stage]} /> : null}
                {index < STAGE_PATH.length - 1 ? <span aria-hidden className="mx-1 text-[#d0d5dd]">─</span> : null}
              </li>
            );
          })}
        </ol>
        {flags.length ? (
          <p className="mt-2 text-sm font-semibold text-[#b42318]">
            {flags.map((stage) => STAGE_LABELS[stage]).join(", ")}
            {flags.map((stage) => reached.get(stage)).filter(Boolean).map((event) => (
              <EvidenceButton key={event!.id} ids={[event!.evidence_id]} label={STAGE_LABELS[event!.stage]} />
            ))}
          </p>
        ) : null}
        {!project.current_stage && !stageEvents.length ? <p className="mt-1"><NotFound text="Stage not found yet." /></p> : null}
      </div>
    </Section>
  );
}

// ───────────────────────── supply chain ─────────────────────────

function RequirementLine({ requirement, facts }: { requirement: RequirementRow; facts: FactEvidenceRow[] }) {
  const spec = formatSpec(requirement.spec);
  const quantity = requirement.quantity !== null ? `${requirement.quantity.toLocaleString("en")}${requirement.unit ? ` ${requirement.unit}` : ""}` : "";
  const delivery = [requirement.delivery_port ?? requirement.delivery_site, requirement.needed_by ? `by ${formatDate(requirement.needed_by)}` : null]
    .filter(Boolean)
    .join(", ");
  return (
    <li>
      <span className="font-semibold text-[#101828]">{requirement.item_category}</span>
      {spec ? ` · ${spec}` : ""}
      {quantity ? ` · ~${quantity}` : ""}
      {delivery ? ` · delivery ${delivery}` : ""}
      <EvidenceButton ids={factIds(facts, "requirement", requirement.id)} label={requirement.item_category} />
    </li>
  );
}

function PartyName({ party, facts }: { party: PartyView; facts: FactEvidenceRow[] }) {
  return (
    <span>
      <span className="font-semibold text-[#101828]">{party.company?.canonical_name ?? "Unknown company"}</span>{" "}
      <span className="text-[#667085]">({PARTY_ROLE_LABELS[party.role] ?? party.role}{party.award_date ? `, ${formatDate(party.award_date)}` : ""})</span>
      <EvidenceButton ids={factIds(facts, "project_party", party.id)} label={party.company?.canonical_name ?? "Party"} />
    </span>
  );
}

function PackageNode({ pkg, isLead, parties, facts }: { pkg: PackageView; isLead: boolean; parties: PartyView[]; facts: FactEvidenceRow[] }) {
  const meta = [
    disciplineLabel(pkg.discipline),
    pkg.owner ? `owner ${pkg.owner.canonical_name}` : null,
    pkg.status ? pkg.status.replace(/_/g, " ") : null,
    pkg.needed_by ? `needed by ${formatDate(pkg.needed_by)}` : null,
    formatMoney(pkg.estimated_value, pkg.currency) || null,
  ].filter(Boolean);
  return (
    <li className={`rounded-lg border p-2.5 ${isLead ? "border-[#84adff] bg-[#f5f8ff]" : "border-[#edf1f6]"}`}>
      <p>
        <span className="font-bold text-[#101828]">{pkg.name}</span>
        {isLead ? <span className="ml-2 rounded bg-[#2563eb] px-1.5 py-0.5 text-xs font-bold text-white">This buyer</span> : null}
        <EvidenceButton ids={factIds(facts, "package", pkg.id)} label={pkg.name} />
      </p>
      <p className="text-sm text-[#475467]">{meta.join(" · ")}</p>
      {pkg.requirements.length ? (
        <div className="mt-1 text-sm">
          <span className="text-[#667085]">Needs:</span>
          <ul className="ml-4 list-[circle] space-y-0.5 pl-3">
            {pkg.requirements.map((requirement) => (
              <RequirementLine key={requirement.id} requirement={requirement} facts={facts} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm"><NotFound text="Requirements not found yet." /></p>
      )}
      {parties.length ? (
        <ul className="mt-1 space-y-0.5 text-sm">
          {parties.map((party) => (
            <li key={party.id}>↳ <PartyName party={party} facts={facts} /></li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** owner → main EPC → subcontractors → packages → requirements (12 F3). */
export function SupplyChainSection({ detail }: { detail: LeadDetail }) {
  const { projectOwner, parties, packages, facts, lead } = detail;
  const owners = parties.filter((party) => party.role === "owner");
  const mains = parties.filter((party) => ["main_epc", "consortium_member", "pmc", "consultant"].includes(party.role));
  const others = parties.filter((party) => !["owner", "main_epc", "consortium_member", "pmc", "consultant"].includes(party.role));
  const byPackage = (id: string) => others.filter((party) => party.package_id === id);
  const loose = others.filter((party) => !party.package_id || !packages.some((pkg) => pkg.id === party.package_id));
  const ownerName = projectOwner?.canonical_name ?? owners[0]?.company?.canonical_name ?? null;
  const empty = !ownerName && !mains.length && !packages.length && !others.length;

  return (
    <Section id="supply-chain" title="Project chain">
      {empty ? (
        <NotFound text="No contractors or packages found yet." />
      ) : (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-x-2">
            {ownerName ? (
              <span>
                <span className="font-semibold text-[#101828]">{ownerName}</span> <span className="text-[#667085]">(owner)</span>
                {owners[0] ? <EvidenceButton ids={factIds(facts, "project_party", owners[0].id)} label="Owner" /> : null}
              </span>
            ) : (
              <NotFound text="Owner not found" />
            )}
            <span aria-hidden className="text-[#98a2b3]">→</span>
            {mains.length ? (
              mains.map((party, index) => (
                <span key={party.id}>
                  <PartyName party={party} facts={facts} />
                  {index < mains.length - 1 ? ", " : ""}
                </span>
              ))
            ) : (
              <NotFound text="Main contractor not found yet" />
            )}
          </p>
          {packages.length ? (
            <ul className="ml-2 space-y-2 border-l-2 border-[#e1e6ef] pl-3">
              {packages.map((pkg) => (
                <PackageNode key={pkg.id} pkg={pkg} isLead={pkg.id === lead.package_id} parties={byPackage(pkg.id)} facts={facts} />
              ))}
            </ul>
          ) : null}
          {loose.length ? (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#667085]">Subcontractors and suppliers</h3>
              <ul className="mt-1 space-y-0.5 text-sm">
                {loose.map((party) => (
                  <li key={party.id}><PartyName party={party} facts={facts} /></li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}

// ───────────────────────── people ─────────────────────────

export function outreachLine(outreach: PersonOutreach | undefined): string {
  if (!outreach) return "";
  const where = outreach.country ? ` (${marketName(outreach.country)})` : "";
  return `Contact rules${where}: email ${PERMISSION_LABELS[outreach.rule.email]} · phone ${PERMISSION_LABELS[outreach.rule.phone]}`;
}

function PersonLine({ person, outreach, facts }: { person: PersonView; outreach?: PersonOutreach; facts: FactEvidenceRow[] }) {
  const roles = [...new Set(person.roles.map((role) => BUYING_ROLE_LABELS[role.buying_role] ?? role.buying_role))];
  const roleIds = person.roles.flatMap((role) => factIds(facts, "person_role", role.id));
  const emailBlocked = outreach && (outreach.rule.email === "consent_needed" || outreach.rule.email === "blocked");
  return (
    <li className="py-2">
      <p>
        <span className="font-semibold text-[#101828]">{person.full_name}</span>
        {person.title ? ` · ${person.title}` : ""}
        {person.companyName ? ` · ${person.companyName}` : ""}
        <EvidenceButton ids={[...factIds(facts, "person", person.id), ...roleIds]} label={person.full_name} />
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
        {roles.length ? roles.map((role) => (
          <span key={role} className="rounded bg-[#f2f4f7] px-1.5 py-0.5 text-xs font-semibold text-[#344054]">{role}</span>
        )) : null}
        <span className="rounded border border-[#d0d5dd] px-1.5 py-0.5 text-xs font-semibold text-[#667085]">Contact details not verified</span>
        {person.profile_url && /^https?:\/\//i.test(person.profile_url) ? (
          <a href={person.profile_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[#1d4ed8] hover:underline">
            Public profile <ExternalLink size={11} aria-hidden />
          </a>
        ) : null}
      </p>
      {outreach ? (
        <p className={`mt-0.5 text-xs ${emailBlocked ? "text-[#b54708]" : "text-[#667085]"}`} title={outreach.rule.steps.join(" ")}>
          {outreachLine(outreach)}
          {outreach.rule.steps[0] ? ` — ${outreach.rule.steps[0]}` : ""}
        </p>
      ) : null}
    </li>
  );
}

export function PeopleSection({ detail }: { detail: LeadDetail }) {
  const outreach = new Map(detail.compliance.outreach.map((item) => [item.personId, item]));
  const companies = detail.companies ?? [];
  return (
    <Section id="people" title="People and contacts" aside={detail.people.length ? `${detail.people.length} named in sources` : undefined}>
      <h3 className="text-xs font-bold uppercase tracking-wide text-[#667085]">Named in the sources</h3>
      {detail.people.length ? (
        <ul className="divide-y divide-[#f2f4f7]">
          {detail.people.map((person) => (
            <PersonLine key={person.id} person={person} outreach={outreach.get(person.id)} facts={detail.facts} />
          ))}
        </ul>
      ) : (
        <p className="py-2"><NotFound text="No people named in the sources yet." /></p>
      )}
      {companies.length ? (
        <div className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[#667085]">Find contacts</h3>
          <p className="mt-0.5 text-xs text-[#667085]">Links open a web search in a new tab — verify every contact before use.</p>
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {companies.map((company) => (
              <CompanyContactCard key={company.companyId} company={company} />
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

/** One company on the lead: its roles, website, contact searches and the email rule for its country. */
function CompanyContactCard({ company }: { company: CompanyContactView }) {
  const emailRule = company.rule.companyEmail ?? company.rule.email;
  const blocked = emailRule === "consent_needed" || emailRule === "blocked";
  return (
    <li className="rounded-lg border border-[#e4e7ec] p-3">
      <p className="font-semibold text-[#101828]">{company.name}</p>
      <p className="mt-0.5 flex flex-wrap gap-1">
        {company.roles.map((role) => (
          <span key={role} className="rounded bg-[#f2f4f7] px-1.5 py-0.5 text-xs font-semibold text-[#344054]">{role}</span>
        ))}
        {company.country ? <span className="rounded px-1.5 py-0.5 text-xs text-[#667085]">{marketName(company.country)}</span> : null}
      </p>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {company.website ? (
          <a href={company.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#1d4ed8] hover:underline">
            Website <ExternalLink size={11} aria-hidden />
          </a>
        ) : null}
        {company.searches.map((search) => (
          <a key={search.label} href={search.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#1d4ed8] hover:underline">
            {search.label} <ExternalLink size={11} aria-hidden />
          </a>
        ))}
      </p>
      <p className={`mt-2 text-xs ${blocked ? "text-[#b54708]" : "text-[#667085]"}`} title={company.rule.steps.join(" ")}>
        Company email: {PERMISSION_LABELS[emailRule]}{company.rule.steps[0] ? ` — ${company.rule.steps[0]}` : ""}
      </p>
    </li>
  );
}

// ───────────────────────── buyer history ─────────────────────────

export function BuyerHistorySection({ insights, buyerName }: { insights: CompanyInsights | null; buyerName: string }) {
  const empty =
    !insights ||
    (!insights.awards5y && !insights.projects.length && !insights.regularSuppliers.length && !insights.regularPartners.length);
  return (
    <Section id="buyer-history" title="Buyer history (5 years)">
      {empty || !insights ? (
        <NotFound text={`No past projects found yet for ${buyerName}.`} />
      ) : (
        <div className="space-y-2">
          <p>
            <span className="font-semibold tabular-nums text-[#101828]">{insights.awards5y}</span> {insights.awards5y === 1 ? "award" : "awards"}
            {insights.sectors.length ? ` · ${insights.sectors.map(disciplineLabel).join(", ")}` : ""}
            {insights.countries.length ? ` · ${insights.countries.map((code) => marketName(code)).join(", ")}` : ""}
          </p>
          {insights.typicalSubcontracted.length ? (
            <p>Usually subcontracts: {insights.typicalSubcontracted.map(disciplineLabel).join(", ")}</p>
          ) : null}
          {insights.typicalSelfPerformed.length ? (
            <p>Usually does in-house: {insights.typicalSelfPerformed.map(disciplineLabel).join(", ")}</p>
          ) : null}
          {insights.regularSuppliers.length ? (
            <p>
              Regular suppliers:{" "}
              {insights.regularSuppliers.map((partner, index) => (
                <span key={partner.companyId}>
                  {partner.name}
                  {partner.discipline ? ` (${disciplineLabel(partner.discipline)})` : ""}
                  <EvidenceButton ids={partner.evidenceIds} label={partner.name} />
                  {index < insights.regularSuppliers.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          ) : null}
          {insights.regularPartners.length ? (
            <p>
              Regular partners:{" "}
              {insights.regularPartners.map((partner, index) => (
                <span key={partner.companyId}>
                  {partner.name}
                  <EvidenceButton ids={partner.evidenceIds} label={partner.name} />
                  {index < insights.regularPartners.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          ) : null}
          {insights.projects.length ? (
            <ul className="mt-1 space-y-0.5 text-sm">
              {insights.projects.slice(0, 10).map((project) => (
                <li key={`${project.projectId}-${project.role}`}>
                  <span className="font-semibold text-[#101828]">{project.name}</span>
                  <span className="text-[#667085]">
                    {" "}· {PARTY_ROLE_LABELS[project.role] ?? project.role}
                    {project.country ? ` · ${marketName(project.country)}` : ""}
                    {project.awardDate ? ` · ${formatDate(project.awardDate)}` : ""}
                    {project.valueUsd ? ` · ${formatMoney(project.valueUsd, "USD")}` : ""}
                  </span>
                  <EvidenceButton ids={project.evidenceIds} label={project.name} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Section>
  );
}

// ───────────────────────── compliance ─────────────────────────

const CHECK_ICON: Record<CheckStatus, React.ReactNode> = {
  met: <CheckCircle2 size={16} className="text-[#067647]" aria-hidden />,
  missing: <XCircle size={16} className="text-[#b42318]" aria-hidden />,
  unknown: <CircleHelp size={16} className="text-[#b54708]" aria-hidden />,
  not_applicable: <MinusCircle size={16} className="text-[#98a2b3]" aria-hidden />,
};

export function ComplianceSection({ items, eligibility }: { items: ChecklistItem[]; eligibility: { points: number | null; max: number } | null }) {
  const missingHard = items.some((item) => item.hard && item.status === "missing");
  return (
    <Section
      id="compliance"
      title="Can you sell to them?"
      aside={eligibility ? <span className="tabular-nums">Eligibility: {eligibility.points ?? "?"} / {eligibility.max}</span> : undefined}
    >
      {missingHard ? (
        <p role="note" className="mb-2 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm font-semibold text-[#b42318]">
          A required item is missing. Sort it out before you bid or quote.
        </p>
      ) : null}
      {items.length ? (
        <ul className="divide-y divide-[#f2f4f7]">
          {items.map((item) => (
            <li key={item.ruleKey} className="grid grid-cols-[1.25rem_1fr_auto] items-start gap-2 py-1.5">
              <span className="pt-0.5">{CHECK_ICON[item.status]}</span>
              <span>
                <span className="font-semibold text-[#101828]">{item.title}</span>
                {item.hard ? <span className="ml-2 rounded bg-[#f2f4f7] px-1.5 py-0.5 text-xs font-semibold text-[#344054]">Required</span> : null}
                {item.note ? <span className="block text-sm text-[#667085]">{item.note}</span> : null}
              </span>
              <span className="flex items-center gap-2 text-sm">
                <span className={item.status === "missing" ? "font-semibold text-[#b42318]" : "text-[#475467]"}>{CHECK_LABELS[item.status]}</span>
                {item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) ? (
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Source for ${item.title}`} className="text-[#1d4ed8]">
                    <ExternalLink size={13} aria-hidden />
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <NotFound text="No checklist for this market yet." />
      )}
    </Section>
  );
}
