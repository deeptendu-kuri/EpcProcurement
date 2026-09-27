/**
 * Read models and small writes for the UI and /api/mvp routes (docs/mvp/12 §5).
 * All functions use getDb(); rows are typed in src/mvp/types.ts. Parameterised SQL only.
 */
import { getDb, type Queryable } from "@/mvp/db";
import { getProductById } from "@/mvp/config/profile";
import { bidChecklist, contactCountry, outreachRules } from "@/mvp/compliance";
import { getCompanyInsights } from "@/mvp/scoring/graph";
import type {
  ActivityRow,
  ActivityType,
  ChecklistItem,
  CompanyInsights,
  CompanyRow,
  Discipline,
  DraftStatus,
  EvidenceView,
  FactEvidenceRow,
  LeadClass,
  LeadDetail,
  LeadFilter,
  LeadListItem,
  LeadListResult,
  LeadPatch,
  LeadRow,
  LeadScoreHistoryRow,
  LeadStatus,
  OutreachDraftRow,
  PackageRow,
  PartyView,
  PersonOutreach,
  PersonRoleRow,
  PersonRow,
  ProjectPartyRow,
  ProjectRow,
  ProjectStageEventRow,
  RequirementRow,
  RunEventRow,
  RunRow,
  RunWithEvents,
  ScoreBreakdown,
  SignalRow,
} from "@/mvp/types";

export const OPEN_STATUSES: LeadStatus[] = ["new", "accepted", "contacted", "rfq", "quoted"];
const LEAD_CLASSES: LeadClass[] = ["genuine", "research", "watch", "rejected"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

/** True when `value` is a uuid (ids that are not uuids can never match a row and would fail the cast). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function uniqUuids(values: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const value of values) if (isUuid(value)) out.add(value.toLowerCase());
  return [...out];
}

// ───────────────────────── leads inbox ─────────────────────────

interface LeadListSqlRow extends LeadRow {
  buyer_name: string;
  buyer_country: string | null;
  project_name: string | null;
  project_country: string | null;
  package_name: string | null;
  package_discipline: Discipline | null;
}

const LEAD_LIST_FROM = `
  from leads l
  join companies c on c.id = l.buyer_company_id
  left join projects p on p.id = l.project_id
  left join packages pk on pk.id = l.package_id`;

/** WHERE clause for every filter except the class (so the tab counts can share it). */
function leadWhere(filter: LeadFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (n: string) => string, value: unknown) => {
    params.push(value);
    clauses.push(sql(`$${params.length}`));
  };

  if (filter.market) add((n) => `upper(coalesce(p.country, c.country)) = upper(${n})`, filter.market);
  if (filter.productId) add((n) => `${n}::text = any(l.client_product_ids)`, filter.productId);
  if (filter.kind) add((n) => `l.kind = ${n}`, filter.kind);
  if (filter.runId && isUuid(filter.runId)) add((n) => `l.run_id = ${n}::uuid`, filter.runId);
  const status = filter.status ?? "open";
  if (status === "open") add((n) => `l.status = any(${n}::text[])`, OPEN_STATUSES);
  else if (status !== "all") add((n) => `l.status = ${n}`, status);

  return { sql: clauses.length ? `where ${clauses.join(" and ")}` : "", params };
}

function toListItem(row: LeadListSqlRow): LeadListItem {
  return {
    id: row.id,
    kind: row.kind,
    class: row.class,
    status: row.status,
    score: row.score,
    confidence: row.confidence,
    confidenceBand: row.confidence_band,
    buyerId: row.buyer_company_id,
    buyerName: row.buyer_name,
    buyerCountry: row.buyer_country,
    projectId: row.project_id,
    projectName: row.project_name,
    projectCountry: row.project_country,
    packageName: row.package_name,
    discipline: row.package_discipline,
    productNames: (row.client_product_ids ?? []).map((id) => getProductById(id)?.name ?? id),
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    closingDate: row.closing_date,
    isSample: row.is_sample,
    createdAt: row.created_at,
  };
}

/**
 * Leads for the inbox, sorted by score desc then newest, with per-class counts for the tabs.
 * `filter.status` defaults to "open".
 */
export async function listLeads(filter: LeadFilter = {}): Promise<LeadListResult> {
  const db = getDb();
  const where = leadWhere(filter);

  const params = [...where.params];
  let sql = `select l.*, c.canonical_name as buyer_name, c.country as buyer_country,
      p.name as project_name, p.country as project_country, pk.name as package_name, pk.discipline as package_discipline
    ${LEAD_LIST_FROM} ${where.sql}`;
  if (filter.class) {
    params.push(filter.class);
    sql += `${where.sql ? " and" : " where"} l.class = $${params.length}`;
  }
  const limit = Math.min(Math.max(1, Math.floor(filter.limit ?? DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE);
  const offset = Math.max(0, Math.floor(filter.offset ?? 0));
  params.push(limit, offset);
  sql += ` order by l.score desc nulls last, l.created_at desc, l.id limit $${params.length - 1} offset $${params.length}`;

  const [items, counts] = await Promise.all([
    db.query<LeadListSqlRow>(sql, params),
    db.query<{ class: LeadClass; n: number }>(
      `select l.class, count(*)::int as n ${LEAD_LIST_FROM} ${where.sql} group by l.class`,
      where.params,
    ),
  ]);

  const countMap = Object.fromEntries(LEAD_CLASSES.map((cls) => [cls, 0])) as Record<LeadClass, number>;
  for (const row of counts.rows) countMap[row.class] = Number(row.n);
  return { items: items.rows.map(toListItem), counts: countMap };
}

/** Evidence URLs behind each lead (reasons, signals, breakdown), for the CSV export. */
export async function leadEvidenceUrls(leadIds: string[]): Promise<Record<string, string[]>> {
  const ids = uniqUuids(leadIds);
  if (!ids.length) return {};
  const { rows } = await getDb().query<{ lead_id: string; url: string }>(
    `with refs as (
       select l.id as lead_id, unnest(s.evidence_ids) as evidence_id
         from leads l join signals s on s.id = any(l.signal_ids)
        where l.id = any($1::uuid[])
       union
       select l.id, (ev.value)::uuid
         from leads l, jsonb_array_elements(l.reasons) r, jsonb_array_elements_text(coalesce(r->'evidenceIds', '[]'::jsonb)) ev(value)
        where l.id = any($1::uuid[]) and ev.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     )
     select distinct refs.lead_id, e.url from refs join evidence e on e.id = refs.evidence_id order by refs.lead_id, e.url`,
    [ids],
  );
  const out: Record<string, string[]> = {};
  for (const row of rows) (out[row.lead_id] ??= []).push(row.url);
  return out;
}

// ───────────────────────── lead detail ─────────────────────────

function breakdownEvidenceIds(breakdown: ScoreBreakdown | null | undefined): string[] {
  return (breakdown?.criteria ?? []).flatMap((criterion) => (criterion.subs ?? []).flatMap((sub) => sub.evidenceIds ?? []));
}

function insightEvidenceIds(insights: CompanyInsights | null): string[] {
  if (!insights) return [];
  return [
    ...insights.projects.flatMap((project) => project.evidenceIds ?? []),
    ...insights.regularSuppliers.flatMap((partner) => partner.evidenceIds ?? []),
    ...insights.regularPartners.flatMap((partner) => partner.evidenceIds ?? []),
  ];
}

async function companiesById(db: Queryable, ids: (string | null | undefined)[]): Promise<Map<string, CompanyRow>> {
  const wanted = uniqUuids(ids);
  if (!wanted.length) return new Map();
  const { rows } = await db.query<CompanyRow>("select * from companies where id = any($1::uuid[])", [wanted]);
  return new Map(rows.map((row) => [row.id, row]));
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error("[repo] optional section failed:", error);
    return fallback;
  }
}

/** Everything the lead page needs (F3/F4), or null when the lead doesn't exist. */
export async function getLeadDetail(id: string): Promise<LeadDetail | null> {
  if (!isUuid(id)) return null;
  const db = getDb();
  const lead = (await db.query<LeadRow>("select * from leads where id = $1", [id])).rows[0];
  if (!lead) return null;

  const buyer = (await db.query<CompanyRow>("select * from companies where id = $1", [lead.buyer_company_id])).rows[0];
  const project = lead.project_id
    ? ((await db.query<ProjectRow>("select * from projects where id = $1", [lead.project_id])).rows[0] ?? null)
    : null;
  const projectId = project?.id ?? null;

  const [stageEvents, packages, parties, signals, activities, drafts, scoreHistory] = await Promise.all([
    projectId
      ? db.query<ProjectStageEventRow>(
          "select * from project_stage_events where project_id = $1 order by event_date nulls last, created_at",
          [projectId],
        )
      : Promise.resolve({ rows: [] as ProjectStageEventRow[] }),
    projectId
      ? db.query<PackageRow>("select * from packages where project_id = $1 order by name", [projectId])
      : lead.package_id
        ? db.query<PackageRow>("select * from packages where id = $1", [lead.package_id])
        : Promise.resolve({ rows: [] as PackageRow[] }),
    projectId
      ? db.query<ProjectPartyRow>(
          "select * from project_parties where project_id = $1 order by award_date nulls last, created_at",
          [projectId],
        )
      : Promise.resolve({ rows: [] as ProjectPartyRow[] }),
    db.query<SignalRow>(
      `select * from signals
        where id = any($1::uuid[]) or ($2::uuid is not null and project_id = $2::uuid)
        order by signal_date desc, created_at desc limit 50`,
      [uniqUuids(lead.signal_ids ?? []), projectId],
    ),
    db.query<ActivityRow>("select * from activities where lead_id = $1 order by created_at desc", [id]),
    db.query<OutreachDraftRow>("select * from outreach_drafts where lead_id = $1 order by created_at desc", [id]),
    db.query<LeadScoreHistoryRow>(
      "select * from lead_score_history where lead_id = $1 order by scored_at desc limit 20",
      [id],
    ),
  ]);

  const packageIds = packages.rows.map((pkg) => pkg.id);
  const requirements = packageIds.length
    ? (
        await db.query<RequirementRow>(
          "select * from requirements where package_id = any($1::uuid[]) order by created_at",
          [packageIds],
        )
      ).rows
    : [];

  const people = (
    await db.query<PersonRow>(
      `select * from people p
        where p.id in (
                select person_id from person_roles
                 where ($1::uuid is not null and project_id = $1::uuid) or package_id = any($2::uuid[])
              )
           or p.current_company_id = $3
        order by p.full_name limit 50`,
      [projectId, packageIds, lead.buyer_company_id],
    )
  ).rows;
  const personIds = people.map((person) => person.id);
  const roles = personIds.length
    ? (
        await db.query<PersonRoleRow>("select * from person_roles where person_id = any($1::uuid[]) order by created_at", [
          personIds,
        ])
      ).rows
    : [];

  const companies = await companiesById(db, [
    lead.buyer_company_id,
    project?.owner_company_id,
    ...packages.rows.map((pkg) => pkg.package_owner_company_id),
    ...parties.rows.map((party) => party.company_id),
    ...people.map((person) => person.current_company_id),
  ]);
  const company = (companyId: string | null | undefined) => (companyId ? (companies.get(companyId) ?? null) : null);

  const entityIds = uniqUuids([
    lead.buyer_company_id,
    projectId,
    project?.owner_company_id,
    ...packageIds,
    ...requirements.map((req) => req.id),
    ...parties.rows.flatMap((party) => [party.id, party.company_id]),
    ...personIds,
    ...roles.map((role) => role.id),
    ...signals.rows.map((signal) => signal.id),
    ...stageEvents.rows.map((event) => event.id),
  ]);
  const facts = entityIds.length
    ? (await db.query<FactEvidenceRow>("select * from fact_evidence where entity_id = any($1::uuid[])", [entityIds])).rows
    : [];

  const buyerInsights = await safe(() => getCompanyInsights(lead.buyer_company_id), null as CompanyInsights | null);
  const bid = await safe(() => bidChecklist(id), [] as ChecklistItem[]);
  const outreach: PersonOutreach[] = people.map((person) => {
    const country = contactCountry(person.country, company(person.current_company_id)?.country, buyer?.country);
    return { personId: person.id, country, rule: outreachRules(country ?? "") };
  });

  const breakdown: ScoreBreakdown = {
    criteria: lead.score_breakdown?.criteria ?? [],
    unknown: lead.score_breakdown?.unknown ?? [],
  };
  const gates = Array.isArray(lead.gate_results) ? lead.gate_results : [];
  const reasons = Array.isArray(lead.reasons) ? lead.reasons : [];

  const evidenceIds = uniqUuids([
    ...facts.map((fact) => fact.evidence_id),
    ...stageEvents.rows.map((event) => event.evidence_id),
    ...signals.rows.flatMap((signal) => signal.evidence_ids ?? []),
    ...breakdownEvidenceIds(breakdown),
    ...reasons.flatMap((reason) => reason.evidenceIds ?? []),
    ...insightEvidenceIds(buyerInsights),
  ]);
  const evidenceRows = evidenceIds.length
    ? (
        await db.query<EvidenceView>(
          `select e.*, d.source_name as "sourceName", d.source_key as "sourceKey", d.title as "documentTitle",
                  d.published_at as "publishedAt", coalesce(d.is_sample, false) as "isSample"
             from evidence e left join source_documents d on d.id = e.document_id
            where e.id = any($1::uuid[])`,
          [evidenceIds],
        )
      ).rows
    : [];

  const partyViews: PartyView[] = parties.rows.map((party) => ({ ...party, company: company(party.company_id) }));

  return {
    lead,
    buyer,
    project,
    projectOwner: company(project?.owner_company_id),
    stageEvents: stageEvents.rows,
    packages: packages.rows.map((pkg) => ({
      ...pkg,
      owner: company(pkg.package_owner_company_id),
      requirements: requirements.filter((req) => req.package_id === pkg.id),
    })),
    requirements,
    parties: partyViews,
    people: people.map((person) => ({
      ...person,
      companyName: company(person.current_company_id)?.canonical_name ?? null,
      roles: roles.filter((role) => role.person_id === person.id),
    })),
    signals: signals.rows,
    evidence: Object.fromEntries(evidenceRows.map((row) => [row.id, row])),
    facts,
    breakdown,
    gates,
    reasons,
    buyerInsights,
    compliance: { bid, outreach },
    activities: activities.rows,
    drafts: drafts.rows,
    scoreHistory: scoreHistory.rows,
  };
}

// ───────────────────────── writes ─────────────────────────

const PATCHABLE: (keyof LeadPatch)[] = ["status", "reject_reason", "owner_user_id", "next_action"];

/**
 * Update the user-editable lead fields (status, reject_reason, owner_user_id, next_action),
 * set `updated_at`, and record a 'status_change' activity when the status changes.
 * Moving a lead out of `rejected` clears its reject reason unless one is given.
 * @returns the updated row, or null when the lead doesn't exist.
 */
export async function updateLead(id: string, patch: LeadPatch, userId: string | null = null): Promise<LeadRow | null> {
  if (!isUuid(id)) return null;
  return getDb().tx(async (tx) => {
    const current = (await tx.query<LeadRow>("select * from leads where id = $1 for update", [id])).rows[0];
    if (!current) return null;

    const next: LeadPatch = {};
    for (const key of PATCHABLE) if (patch[key] !== undefined) (next as Record<string, unknown>)[key] = patch[key];
    if (next.status && next.status !== "rejected" && next.reject_reason === undefined) next.reject_reason = null;

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(next)) {
      params.push(value);
      sets.push(`${key} = $${params.length}`);
    }
    params.push(id);
    const updated = (
      await tx.query<LeadRow>(
        `update leads set ${[...sets, "updated_at = now()"].join(", ")} where id = $${params.length} returning *`,
        params,
      )
    ).rows[0];

    if (next.status && next.status !== current.status) {
      const reason = next.status === "rejected" && updated.reject_reason ? ` (${updated.reject_reason})` : "";
      await insertActivity(tx, {
        leadId: id,
        type: "status_change",
        body: `${current.status} → ${next.status}${reason}`,
        userId,
      });
    }
    return updated;
  });
}

async function insertActivity(
  db: Queryable,
  activity: { leadId: string; type: ActivityType; body?: string | null; personId?: string | null; userId?: string | null },
): Promise<ActivityRow> {
  const { rows } = await db.query<ActivityRow>(
    `insert into activities (lead_id, type, body, person_id, user_id) values ($1, $2, $3, $4, $5) returning *`,
    [
      activity.leadId,
      activity.type,
      activity.body ?? null,
      isUuid(activity.personId) ? activity.personId : null,
      activity.userId ?? null,
    ],
  );
  return rows[0];
}

/** Append an activity (note, status change, draft, sent email…) to a lead. */
export async function addActivity(activity: {
  leadId: string;
  type: ActivityType;
  body?: string | null;
  personId?: string | null;
  userId?: string | null;
}): Promise<ActivityRow> {
  if (!isUuid(activity.leadId)) throw new Error("Unknown lead.");
  return insertActivity(getDb(), activity);
}

/**
 * Edit an outreach draft (subject/body) and/or mark it sent. Marking it `sent_externally` records an
 * 'email_sent' activity on the lead. Drafts stored with a `blocked_reason` cannot be marked sent.
 * @returns the updated draft, or null when it doesn't exist.
 */
export async function updateDraft(
  id: string,
  patch: { subject?: string; body?: string; status?: DraftStatus },
  userId: string | null = null,
): Promise<OutreachDraftRow | null> {
  if (!isUuid(id)) return null;
  return getDb().tx(async (tx) => {
    const current = (await tx.query<OutreachDraftRow>("select * from outreach_drafts where id = $1 for update", [id])).rows[0];
    if (!current) return null;
    if (current.blocked_reason && patch.status === "sent_externally") {
      throw new DraftBlockedError(current.blocked_reason);
    }
    const updated = (
      await tx.query<OutreachDraftRow>(
        `update outreach_drafts
            set subject = coalesce($2, subject), body = coalesce($3, body), status = coalesce($4, status), updated_at = now()
          where id = $1 returning *`,
        [id, patch.subject ?? null, patch.body ?? null, patch.status ?? null],
      )
    ).rows[0];
    if (patch.status === "sent_externally" && current.status !== "sent_externally") {
      await insertActivity(tx, {
        leadId: current.lead_id,
        type: "email_sent",
        body: updated.subject ? `Email sent: ${updated.subject}` : "Email sent",
        personId: current.person_id,
        userId,
      });
    }
    return updated;
  });
}

export class DraftBlockedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "DraftBlockedError";
  }
}

// ───────────────────────── runs ─────────────────────────

/**
 * A run with its progress events (ordered by id).
 * @param afterEventId only return events with id greater than this (for 2 s polling).
 */
export async function getRun(id: string, afterEventId?: number): Promise<RunWithEvents | null> {
  if (!isUuid(id)) return null;
  const db = getDb();
  const run = (await db.query<RunRow>("select * from runs where id = $1", [id])).rows[0];
  if (!run) return null;
  const events = await db.query<RunEventRow>(
    "select * from run_events where run_id = $1 and id > $2 order by id limit 500",
    [id, Math.max(0, Math.floor(afterEventId ?? 0))],
  );
  return { ...run, counters: run.counters ?? {}, events: events.rows };
}

/** Most recent runs first. */
export async function listRecentRuns(limit = 10): Promise<RunRow[]> {
  const { rows } = await getDb().query<RunRow>("select * from runs order by created_at desc limit $1", [
    Math.min(Math.max(1, Math.floor(limit)), 100),
  ]);
  return rows;
}

/** True when a lead with this id exists. */
export async function leadExists(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { rows } = await getDb().query("select 1 from leads where id = $1", [id]);
  return rows.length > 0;
}
