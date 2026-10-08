/**
 * Database loader for buyers (docs/mvp/14 §9): reads leads and their verified facts in a few batched,
 * parameterised queries and builds BuyerRecords with the pure view builder. Server-only.
 */
import { getDb, type Queryable } from "@/mvp/db";
import { sentenceAround } from "@/mvp/pipeline/text";
import type {
  CompanyRow,
  LeadRow,
  PackageRow,
  PersonRoleRow,
  PersonRow,
  ProjectPartyRow,
  ProjectRow,
  RequirementRow,
  SignalRow,
} from "@/mvp/types";
import type { TeamPerson } from "./team";
import { buildBuyerView, type BuyerRecord, type EvidenceLite, type PartyWithName } from "./view";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Most leads read for one search (the slice is small; the list is newest first). */
export const MAX_BUYERS = 2000;
/** Activity body that marks a person as the confirmed holder of a slot (14 §8 "Confirmed"). */
export const CONFIRM_PREFIX = "contact_confirmed:";

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function uuids(values: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const v of values) if (isUuid(v)) out.add(v.toLowerCase());
  return [...out];
}

/** The sentence of `text` that contains `quote` (by offsets when they still match, else by search). */
export function sentenceFor(text: string, quote: string, start: number | null, end: number | null): string | null {
  let from = start;
  let to = end;
  const q = quote.trim();
  if (from === null || to === null || from < 0 || to > text.length || text.slice(from, to).trim() !== q) {
    const at = text.indexOf(q);
    if (at < 0) return null;
    from = at;
    to = at + q.length;
  }
  return sentenceAround(text, from, to).sentence;
}

interface EvidenceSql {
  id: string;
  document_id: string | null;
  url: string;
  quote: string;
  char_start: number | null;
  char_end: number | null;
  quote_verified: boolean;
  publisher_key: string;
  source_name: string | null;
  published_at: string | null;
}

async function rows<T>(db: Queryable, sql: string, params: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/**
 * Build buyer records. `leadIds` = only these leads; otherwise the newest MAX_BUYERS leads.
 * Buyers are built even for rejected leads (search hides them by default).
 */
export async function loadBuyerRecords(opts: { leadIds?: string[]; db?: Queryable; now?: Date } = {}): Promise<BuyerRecord[]> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const ids = opts.leadIds ? uuids(opts.leadIds) : null;
  if (ids && !ids.length) return [];
  const leads = ids
    ? await rows<LeadRow>(db, "select * from leads where id = any($1::uuid[])", [ids])
    : await rows<LeadRow>(db, "select * from leads order by created_at desc limit $1", [MAX_BUYERS]);
  if (!leads.length) return [];

  const leadIds = leads.map((l) => l.id);
  const projectIds = uuids(leads.map((l) => l.project_id));
  const [projects, parties, packages, stageEvents] = await Promise.all([
    projectIds.length ? rows<ProjectRow>(db, "select * from projects where id = any($1::uuid[])", [projectIds]) : [],
    projectIds.length ? rows<ProjectPartyRow>(db, "select * from project_parties where project_id = any($1::uuid[]) order by award_date nulls last, created_at", [projectIds]) : [],
    rows<PackageRow>(db, "select * from packages where project_id = any($1::uuid[]) or id = any($2::uuid[]) order by name", [projectIds, uuids(leads.map((l) => l.package_id))]),
    projectIds.length
      ? rows<{ project_id: string; awarded: string | null }>(db, "select project_id, min(event_date)::text as awarded from project_stage_events where project_id = any($1::uuid[]) and stage = 'awarded' group by project_id", [projectIds])
      : [],
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const awardedByProject = new Map(stageEvents.map((e) => [e.project_id, e.awarded]));

  // The client of a supplier's order (supplied_by edge: client → supplier), used when the project has no owner.
  const supplyEdges = projectIds.length
    ? await rows<{ from_company_id: string; to_company_id: string; project_id: string }>(
        db,
        "select from_company_id, to_company_id, project_id from relationships where type = 'supplied_by' and project_id = any($1::uuid[])",
        [projectIds],
      )
    : [];
  let companyIds = uuids([
    ...leads.map((l) => l.buyer_company_id), ...projects.map((p) => p.owner_company_id), ...parties.map((p) => p.company_id),
    ...supplyEdges.map((e) => e.from_company_id),
  ]);
  let companies = await rows<CompanyRow>(db, "select * from companies where id = any($1::uuid[])", [companyIds]);
  const parentIds = uuids(companies.map((c) => c.parent_company_id)).filter((id) => !companyIds.includes(id));
  if (parentIds.length) companies = companies.concat(await rows<CompanyRow>(db, "select * from companies where id = any($1::uuid[])", [parentIds]));
  companyIds = companies.map((c) => c.id);
  const companyById = new Map(companies.map((c) => [c.id, c]));

  const packageIds = packages.map((p) => p.id);
  const buyerIds = uuids(leads.map((l) => l.buyer_company_id));
  const signalIds = uuids(leads.flatMap((l) => l.signal_ids ?? []));
  const [requirements, signals, people, confirms] = await Promise.all([
    packageIds.length ? rows<RequirementRow>(db, "select * from requirements where package_id = any($1::uuid[]) order by created_at", [packageIds]) : [],
    rows<SignalRow>(
      db,
      `select * from signals where id = any($1::uuid[]) or (company_id = any($2::uuid[]) and project_id = any($3::uuid[]))
        order by signal_date desc limit 5000`,
      [signalIds, buyerIds, projectIds],
    ),
    rows<PersonRow & { slot_id?: string | null; confirmed_at?: string | null }>(db, "select * from people where current_company_id = any($1::uuid[]) order by full_name", [companyIds]),
    rows<{ lead_id: string; body: string | null }>(
      db,
      "select lead_id, body from activities where lead_id = any($1::uuid[]) and type = 'note' and body like $2",
      [leadIds, `${CONFIRM_PREFIX}%`],
    ),
  ]);
  const personIds = people.map((p) => p.id);
  const buyerPartyIds = parties.filter((p) => buyerIds.includes(p.company_id)).map((p) => p.id);
  const [roles, facts] = await Promise.all([
    personIds.length ? rows<PersonRoleRow>(db, "select * from person_roles where person_id = any($1::uuid[])", [personIds]) : [],
    rows<{ entity_type: string; entity_id: string; field: string; evidence_id: string }>(
      db,
      `select entity_type, entity_id, field, evidence_id from fact_evidence
        where (entity_type = 'company' and entity_id = any($1::uuid[]))
           or (entity_type = 'project_party' and entity_id = any($2::uuid[]))
           or (entity_type = 'person' and entity_id = any($3::uuid[]))`,
      [buyerIds, buyerPartyIds, personIds],
    ),
  ]);
  const factsBy = new Map<string, string[]>();
  for (const f of facts) {
    const key = `${f.entity_type}:${f.entity_id}`;
    (factsBy.get(key) ?? factsBy.set(key, []).get(key)!).push(f.evidence_id);
  }

  // Evidence referenced anywhere: facts, signals, reasons.
  const evidenceIds = uuids([
    ...facts.map((f) => f.evidence_id),
    ...signals.flatMap((s) => s.evidence_ids ?? []),
    ...leads.flatMap((l) => (Array.isArray(l.reasons) ? l.reasons : []).flatMap((r) => r.evidenceIds ?? [])),
  ]);
  const evidenceRows = evidenceIds.length
    ? await rows<EvidenceSql>(
        db,
        `select e.id, e.document_id, e.url, e.quote, e.char_start, e.char_end, e.quote_verified, e.publisher_key,
                d.source_name, d.published_at
           from evidence e left join source_documents d on d.id = e.document_id
          where e.id = any($1::uuid[])`,
        [evidenceIds],
      )
    : [];
  const docIds = uuids(evidenceRows.map((e) => e.document_id));
  const docs = docIds.length ? await rows<{ id: string; text: string | null }>(db, "select id, text from source_documents where id = any($1::uuid[])", [docIds]) : [];
  const docText = new Map(docs.map((d) => [d.id, d.text ?? ""]));
  const evidence: Record<string, EvidenceLite> = {};
  for (const e of evidenceRows) {
    const text = e.document_id ? docText.get(e.document_id) : undefined;
    evidence[e.id] = {
      id: e.id,
      quote: e.quote,
      sentence: text ? sentenceFor(text, e.quote, e.char_start, e.char_end) : null,
      url: e.url ?? null,
      source: e.source_name ?? e.publisher_key,
      publishedAt: e.published_at,
      verified: e.quote_verified,
    };
  }

  const rolesByPerson = new Map<string, string[]>();
  for (const r of roles) (rolesByPerson.get(r.person_id) ?? rolesByPerson.set(r.person_id, []).get(r.person_id)!).push(r.buying_role);
  const peopleByCompany = new Map<string, TeamPerson[]>();
  for (const p of people) {
    if (!p.current_company_id) continue;
    const list = peopleByCompany.get(p.current_company_id) ?? [];
    list.push({
      id: p.id,
      name: p.full_name,
      title: p.title,
      department: p.department,
      buyingRoles: rolesByPerson.get(p.id) ?? [],
      evidenceIds: (factsBy.get(`person:${p.id}`) ?? []).filter((id) => evidence[id]),
      slotId: p.slot_id ?? null,
    });
    peopleByCompany.set(p.current_company_id, list);
  }
  // People a user confirmed as decision maker (15 §E) count as confirmed on every lead of their company.
  const confirmedPeople = new Set(people.filter((p) => p.confirmed_at).map((p) => p.id.toLowerCase()));
  const viaIds = uuids(leads.map((l) => (l as LeadRow & { found_via_lead_id?: string | null }).found_via_lead_id));
  const viaNames = new Map(
    (viaIds.length
      ? await rows<{ id: string; name: string }>(db, "select l.id, c.canonical_name as name from leads l join companies c on c.id = l.buyer_company_id where l.id = any($1::uuid[])", [viaIds])
      : []
    ).map((r) => [r.id, r.name]),
  );
  const confirmedByLead = new Map<string, Set<string>>();
  for (const c of confirms) {
    const personId = (c.body ?? "").slice(CONFIRM_PREFIX.length).split(/[\s:]/)[0];
    if (isUuid(personId)) (confirmedByLead.get(c.lead_id) ?? confirmedByLead.set(c.lead_id, new Set()).get(c.lead_id)!).add(personId.toLowerCase());
  }

  const records: BuyerRecord[] = [];
  for (const lead of leads) {
    const buyer = companyById.get(lead.buyer_company_id);
    if (!buyer) continue;
    const project = lead.project_id ? (projectById.get(lead.project_id) ?? null) : null;
    const projectParties: PartyWithName[] = project
      ? parties.filter((p) => p.project_id === project.id).map((p) => ({ ...p, companyName: companyById.get(p.company_id)?.canonical_name ?? "Unknown company" }))
      : [];
    const leadPackages = lead.package_id ? packages.filter((p) => p.id === lead.package_id) : project ? packages.filter((p) => p.project_id === project.id) : [];
    const pkgIds = new Set(leadPackages.map((p) => p.id));
    const triggerIds = new Set(lead.signal_ids ?? []);
    const leadSignals = signals.filter((s) => triggerIds.has(s.id) || (s.company_id === buyer.id && project && s.project_id === project.id));
    const buyerEvidenceIds = [
      ...(factsBy.get(`company:${buyer.id}`) ?? []),
      ...projectParties.filter((p) => p.company_id === buyer.id).flatMap((p) => factsBy.get(`project_party:${p.id}`) ?? []),
    ];
    try {
      records.push(
        buildBuyerView({
          now,
          lead,
          buyer,
          parent: buyer.parent_company_id ? (companyById.get(buyer.parent_company_id) ?? null) : null,
          project,
          owner: project?.owner_company_id
            ? (companyById.get(project.owner_company_id) ?? null)
            : project
              ? (companyById.get(supplyEdges.find((e) => e.project_id === project.id && e.to_company_id === buyer.id)?.from_company_id ?? "") ?? null)
              : null,
          packages: leadPackages,
          requirements: requirements.filter((r) => pkgIds.has(r.package_id)),
          parties: projectParties,
          signals: leadSignals,
          people: peopleByCompany.get(buyer.id) ?? [],
          peopleByCompany,
          evidence,
          buyerEvidenceIds,
          capabilityEvidenceIds: facts.filter(f => f.entity_type === 'company' && f.entity_id === buyer.id && f.field === 'capability_activity').map(f => f.evidence_id),
          confirmedPersonIds: new Set([...(confirmedByLead.get(lead.id) ?? []), ...confirmedPeople]),
          foundViaName: viaNames.get((lead as LeadRow & { found_via_lead_id?: string | null }).found_via_lead_id ?? "") ?? null,
          awardedDate: project ? (awardedByProject.get(project.id) ?? null) : null,
        }),
      );
    } catch (error) {
      console.error("[buyers] view failed for lead", lead.id, error);
    }
  }
  return records;
}

// ───────────────────────── short-lived cache for search ─────────────────────────

let cache: { key: string; at: number; records: BuyerRecord[] } | null = null;
const CACHE_MS = 30_000;

/** A key that changes whenever leads, people or confirmations change. */
async function dataVersion(db: Queryable): Promise<string> {
  const { rows: r } = await db.query<{ n: number; t: string | null; p: number; a: string | null }>(
    `select (select count(*)::int from leads) as n,
            (select max(coalesce(updated_at, created_at))::text from leads) as t,
            (select count(*)::int from people) as p,
            (select max(created_at)::text from activities) as a`,
  );
  const row = r[0];
  return `${row?.n}|${row?.t}|${row?.p}|${row?.a}`;
}

/** All buyer records (newest MAX_BUYERS leads), cached for 30 s while the data is unchanged. */
export async function allBuyerRecords(opts: { db?: Queryable; now?: Date } = {}): Promise<BuyerRecord[]> {
  const db = opts.db ?? getDb();
  const key = await dataVersion(db);
  if (!opts.db && !opts.now && cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.records;
  const records = await loadBuyerRecords({ db, now: opts.now });
  if (!opts.db && !opts.now) cache = { key, at: Date.now(), records };
  return records;
}

/** Forget cached records (after a write that the version key would not see). */
export function clearBuyerCache(): void {
  cache = null;
}
