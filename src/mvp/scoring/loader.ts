/**
 * Loads a ScoringContext for one candidate from the database (companies, project, packages,
 * requirements, parties, stage events, signals, people, evidence, graph insights, compliance).
 */
import { buildChecklist, checklistInputFor } from "@/mvp/compliance";
import { getClientProfile } from "@/mvp/config/profile";
import type { Queryable } from "@/mvp/db";
import type {
  CompanyInsights,
  CompanyRow,
  PackageRow,
  PersonRoleRow,
  PersonRow,
  ProjectPartyRow,
  ProjectRow,
  ProjectStageEventRow,
  RequirementRow,
  SignalRow,
} from "@/mvp/types";
import type { Candidate, ScoringContext } from "./context";
import { getCompanyInsights } from "./graph";
import { readTenders, sameName, unique, type EvidenceInfo, type TenderSpec } from "./util";

export type InsightsCache = Map<string, Promise<CompanyInsights>>;

async function one<T>(db: Queryable, sql: string, params: unknown[]): Promise<T | null> {
  return (await db.query<T>(sql, params)).rows[0] ?? null;
}

async function many<T>(db: Queryable, sql: string, params: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Evidence rows (with document date and sample flag) for the given ids. */
export async function loadEvidenceInfo(db: Queryable, ids: string[]): Promise<Record<string, EvidenceInfo>> {
  const out: Record<string, EvidenceInfo> = {};
  if (!ids.length) return out;
  const rows = await many<{
    id: string;
    tier: EvidenceInfo["tier"];
    publisher_key: string;
    quote_verified: boolean;
    agreement: EvidenceInfo["agreement"];
    observed_at: string;
    published_at: string | null;
    is_sample: boolean | null;
  }>(
    db,
    `select e.id, e.tier, e.publisher_key, e.quote_verified, e.agreement, e.observed_at, d.published_at, d.is_sample
       from evidence e left join source_documents d on d.id = e.document_id
      where e.id = any($1::uuid[])`,
    [ids],
  );
  for (const r of rows)
    out[r.id] = {
      id: r.id,
      tier: r.tier,
      publisherKey: r.publisher_key,
      quoteVerified: r.quote_verified,
      agreement: r.agreement,
      observedAt: r.observed_at,
      publishedAt: r.published_at,
      isSample: Boolean(r.is_sample),
    };
  return out;
}

function pickTender(tenders: TenderSpec[], candidate: Candidate, ownerId: string | null): TenderSpec | null {
  const fits = (t: TenderSpec) =>
    (t.buyerCompanyId ?? ownerId) === candidate.buyerId && (!t.packageId || !candidate.packageId || t.packageId === candidate.packageId);
  const matching = tenders.filter(fits);
  // Prefer the one with the latest closing date that is still open.
  return matching.sort((a, b) => (b.closingDate ?? "").localeCompare(a.closingDate ?? ""))[0] ?? null;
}

export async function loadContext(
  db: Queryable,
  candidate: Candidate,
  now: Date,
  insightsCache: InsightsCache = new Map(),
  searchMarkets: string[] = [],
): Promise<ScoringContext | null> {
  // The countries chosen in this search are the markets; the profile list is only the default.
  const base = getClientProfile();
  // Any ISO country can be searched; the market gate only compares codes, so widening the type is safe.
  const profile = searchMarkets.length ? { ...base, markets: searchMarkets as typeof base.markets } : base;
  const buyer = await one<CompanyRow>(db, "select * from companies where id = $1", [candidate.buyerId]);
  if (!buyer) return null;
  const project = candidate.projectId ? await one<ProjectRow>(db, "select * from projects where id = $1", [candidate.projectId]) : null;
  const projectOwner = project?.owner_company_id
    ? project.owner_company_id === buyer.id
      ? buyer
      : await one<CompanyRow>(db, "select * from companies where id = $1", [project.owner_company_id])
    : null;

  const allPackages = project ? await many<PackageRow>(db, "select * from packages where project_id = $1 order by created_at", [project.id]) : [];
  const leadPackage = candidate.packageId
    ? allPackages.find((p) => p.id === candidate.packageId) ?? (await one<PackageRow>(db, "select * from packages where id = $1", [candidate.packageId]))
    : null;
  const packages = leadPackage ? [leadPackage] : allPackages;
  const packageIds = packages.map((p) => p.id);
  const requirements = packageIds.length
    ? await many<RequirementRow>(db, "select * from requirements where package_id = any($1::uuid[])", [packageIds])
    : [];
  const parties = project ? await many<ProjectPartyRow>(db, "select * from project_parties where project_id = $1", [project.id]) : [];
  const stageEvents = project
    ? await many<ProjectStageEventRow>(db, "select * from project_stage_events where project_id = $1 order by event_date nulls last", [project.id])
    : [];
  // A supplier's client on this order (13 §11): the company that bought from it on the project.
  const orderClient =
    project && parties.some((p) => p.company_id === buyer.id && p.role === "supplier")
      ? await one<CompanyRow>(
          db,
          `select c.* from relationships r join companies c on c.id = r.from_company_id
            where r.type = 'supplied_by' and r.to_company_id = $1 and r.project_id = $2 limit 1`,
          [buyer.id, project.id],
        )
      : null;

  const triggerSignals = candidate.signalIds.length
    ? await many<SignalRow>(db, "select * from signals where id = any($1::uuid[])", [candidate.signalIds])
    : [];
  const projectSignals = project
    ? await many<SignalRow>(
        db,
        "select * from signals where project_id = $1 and (package_id is null or $2::uuid is null or package_id = $2::uuid)",
        [project.id, leadPackage?.id ?? null],
      )
    : [];

  // People: mapped to the project / package, or working at the buyer.
  const roles = await many<PersonRoleRow>(
    db,
    `select * from person_roles
      where ($1::uuid is not null and project_id = $1::uuid) or package_id = any($2::uuid[]) or company_id = $3`,
    [project?.id ?? null, packageIds, buyer.id],
  );
  const peopleRows = await many<PersonRow>(
    db,
    "select * from people where id = any($1::uuid[]) or current_company_id = $2",
    [unique(roles.map((r) => r.person_id)), buyer.id],
  );
  const people = peopleRows.map((person) => ({ person, roles: roles.filter((r) => r.person_id === person.id) }));

  // Tender (projects.specs) and competition.
  const tender = project ? pickTender(readTenders(project.specs), candidate, project.owner_company_id) : null;
  let competitorCount: number | null = tender?.biddersCount ?? (tender?.approvedVendors.length ? tender.approvedVendors.length : null);
  if (competitorCount === null && leadPackage) {
    const row = await one<{ n: number }>(
      db,
      "select count(distinct from_company_id)::int as n from relationships where type = 'approved_vendor_of' and package_id = $1",
      [leadPackage.id],
    );
    competitorCount = row && row.n > 0 ? row.n : null;
  }

  // Provenance: fact_evidence for every entity in the context.
  const entityIds = unique([
    buyer.id,
    ...(project ? [project.id] : []),
    ...allPackages.map((p) => p.id),
    ...requirements.map((r) => r.id),
    ...parties.map((p) => p.id),
    ...stageEvents.map((e) => e.id),
    ...peopleRows.map((p) => p.id),
    ...roles.map((r) => r.id),
  ]);
  const facts = entityIds.length
    ? await many<{ entity_type: string; entity_id: string; field: string; evidence_id: string }>(
        db,
        "select entity_type, entity_id, field, evidence_id from fact_evidence where entity_id = any($1::uuid[])",
        [entityIds],
      )
    : [];
  const factEvidence: Record<string, string[]> = {};
  const fieldEvidence: Record<string, string[]> = {};
  for (const f of facts) {
    const key = `${f.entity_type}:${f.entity_id}`;
    (factEvidence[key] ??= []).push(f.evidence_id);
    (fieldEvidence[`${key}:${f.field}`] ??= []).push(f.evidence_id);
  }
  for (const key of Object.keys(factEvidence)) factEvidence[key] = unique(factEvidence[key]);

  const evidenceIds = unique([
    ...facts.map((f) => f.evidence_id),
    ...triggerSignals.flatMap((s) => s.evidence_ids ?? []),
    ...projectSignals.flatMap((s) => s.evidence_ids ?? []),
    ...stageEvents.flatMap((e) => (e.evidence_id ? [e.evidence_id] : [])),
    ...(tender?.evidenceIds ?? []),
  ]).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const evidence = await loadEvidenceInfo(db, evidenceIds);

  if (!insightsCache.has(buyer.id)) insightsCache.set(buyer.id, getCompanyInsights(buyer.id, db, now));
  const insights = await insightsCache.get(buyer.id)!;

  const prior = await one<{ n: number }>(
    db,
    `select count(*)::int as n from activities a join leads l on l.id = a.lead_id
      where l.buyer_company_id = $1 and a.type in ('email_sent','call','meeting')`,
    [buyer.id],
  );

  const checklist = buildChecklist(
    checklistInputFor({ kind: candidate.kind, buyer, project, projectOwner, packages, requirements, now }),
  );

  return {
    now,
    kind: candidate.kind,
    profile,
    buyer,
    project,
    projectOwner,
    orderClient,
    leadPackage,
    packages,
    requirements,
    parties,
    stageEvents,
    tender,
    triggerSignals,
    projectSignals,
    people,
    insights,
    checklist,
    existingCustomer: profile.existing_customer_names.some((n) => sameName(n, buyer.canonical_name)),
    priorContact: (prior?.n ?? 0) > 0,
    competitorCount,
    evidence,
    factEvidence,
    fieldEvidence,
  };
}
