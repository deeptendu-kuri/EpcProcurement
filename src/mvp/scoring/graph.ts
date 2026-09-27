/**
 * Relationship-graph insights for a company (docs/mvp/07 §6). SQL to fetch the company's edges and
 * parties, TS to apply the rules:
 *
 * - Regular supplier of X in discipline D: ≥ 2 independent evidence items (different publisher_key,
 *   quote verified) of `supplied_by` (from X → supplier) or `approved_vendor_of` (from vendor → X)
 *   edges in D, within 36 months.
 * - Regular partner: the same rule on `partnered_with` edges (either direction).
 * - Typical subcontracted package: discipline D with a subcontract (a `subcontracted_to` edge from X,
 *   or a `subcontractor` party on a package of a project where X is main EPC) on ≥ 2 of X's projects
 *   in the last 5 years.
 * - Typical self-performed package: D where X owns the package and nothing in it is subcontracted,
 *   on ≥ 2 projects.
 * - Track record: awards (main_epc / consortium / subcontractor / supplier parties, plus
 *   `awarded_to` edges) in the last 5 years.
 */
import { getDb, type Queryable } from "@/mvp/db";
import type {
  CompanyInsights,
  Discipline,
  GraphPartner,
  InsightProject,
  PartyRole,
  RelationshipRow,
  RelationshipType,
} from "@/mvp/types";
import { SCORING_CONFIG } from "./config";
import { monthsBetween, unique } from "./util";

const G = SCORING_CONFIG.graph;
const AWARD_ROLES: PartyRole[] = ["main_epc", "consortium_member", "subcontractor", "supplier"];

interface EdgeEvidence {
  evidence_id: string;
  entity_id: string;
  publisher_key: string;
  quote_verified: boolean;
  observed_at: string;
  published_at: string | null;
}

interface PartyJoined {
  id: string;
  project_id: string;
  role: PartyRole;
  award_date: string | null;
  value_usd: number | null;
  package_id: string | null;
  project_name: string;
  country: string | null;
  sector: string | null;
}

/** Evidence ids per entity, for one entity type. */
async function evidenceFor(db: Queryable, entityType: string, ids: string[]): Promise<EdgeEvidence[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<EdgeEvidence>(
    `select fe.evidence_id, fe.entity_id, e.publisher_key, e.quote_verified, e.observed_at, d.published_at
       from fact_evidence fe
       join evidence e on e.id = fe.evidence_id
       left join source_documents d on d.id = e.document_id
      where fe.entity_type = $1 and fe.entity_id = any($2::uuid[])`,
    [entityType, ids],
  );
  return rows;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/** An edge seen from company X: the other company, and the edge + its evidence. */
export interface EdgeView {
  partnerId: string;
  discipline: Discipline | null;
  eventDate: string | null;
  evidence: { id: string; publisherKey: string; quoteVerified: boolean; date: string }[];
}

/**
 * Pure: apply the "≥ N independent publishers within M months" rule to edges, grouped by
 * (partner, discipline). Only quote-verified evidence counts.
 */
export function regularPartners(edges: EdgeView[], names: Record<string, string>, now: Date): GraphPartner[] {
  const out: GraphPartner[] = [];
  for (const [, group] of groupBy(edges, (e) => `${e.partnerId}|${e.discipline ?? ""}`)) {
    const recent = group.flatMap((edge) =>
      edge.evidence
        .filter((ev) => ev.quoteVerified)
        .map((ev) => ({ ...ev, when: edge.eventDate ?? ev.date }))
        .filter((ev) => monthsBetween(ev.when, now) <= G.regularSupplierWindowMonths),
    );
    const publishers = unique(recent.map((ev) => ev.publisherKey));
    if (publishers.length < G.regularSupplierMinPublishers) continue;
    const dates = group.map((e) => e.eventDate).filter((d): d is string => Boolean(d)).sort();
    out.push({
      companyId: group[0].partnerId,
      name: names[group[0].partnerId] ?? "",
      discipline: group[0].discipline,
      evidenceCount: unique(recent.map((ev) => ev.id)).length,
      lastDate: dates.at(-1) ?? null,
      evidenceIds: unique(recent.map((ev) => ev.id)),
    });
  }
  return out.sort((a, b) => b.evidenceCount - a.evidenceCount);
}

function withinYears(date: string | null, now: Date, years: number): boolean {
  if (!date) return false;
  const months = monthsBetween(date, now);
  return Number.isFinite(months) && months <= years * 12;
}

/**
 * Buyer history from the relationship graph (docs/mvp/07 §6): awards in the last 5 years, sectors,
 * countries, regular suppliers/partners (≥ 2 independent evidences within 36 months), typically
 * subcontracted / self-performed disciplines, and the projects behind them — each with evidence ids.
 *
 * @param db optional query handle (defaults to getDb()); @param now for tests.
 */
export async function getCompanyInsights(companyId: string, db: Queryable = getDb(), now: Date = new Date()): Promise<CompanyInsights> {
  // ── parties of X (its projects) ──
  const parties = (
    await db.query<PartyJoined>(
      `select pp.id, pp.project_id, pp.role, pp.award_date, pp.value_usd, pp.package_id,
              p.name as project_name, p.country, p.sector
         from project_parties pp join projects p on p.id = pp.project_id
        where pp.company_id = $1
        order by pp.award_date desc nulls last`,
      [companyId],
    )
  ).rows;
  const partyEvidence = groupBy(await evidenceFor(db, "project_party", parties.map((p) => p.id)), (e) => e.entity_id);

  // ── edges touching X ──
  const rels = (
    await db.query<RelationshipRow>(
      "select * from relationships where from_company_id = $1 or to_company_id = $1",
      [companyId],
    )
  ).rows;
  const relEvidence = groupBy(await evidenceFor(db, "relationship", rels.map((r) => r.id)), (e) => e.entity_id);

  const partnerIds = unique(rels.map((r) => (r.from_company_id === companyId ? r.to_company_id : r.from_company_id)));
  const names: Record<string, string> = {};
  if (partnerIds.length) {
    const { rows } = await db.query<{ id: string; canonical_name: string }>(
      "select id, canonical_name from companies where id = any($1::uuid[])",
      [partnerIds],
    );
    for (const row of rows) names[row.id] = row.canonical_name;
  }

  const edgeView = (r: RelationshipRow): EdgeView => ({
    partnerId: r.from_company_id === companyId ? r.to_company_id : r.from_company_id,
    discipline: r.discipline,
    eventDate: r.event_date,
    evidence: (relEvidence.get(r.id) ?? []).map((e) => ({
      id: e.evidence_id,
      publisherKey: e.publisher_key,
      quoteVerified: e.quote_verified,
      date: e.published_at ?? e.observed_at,
    })),
  });
  const isType = (r: RelationshipRow, type: RelationshipType) => r.type === type;

  const supplierEdges = rels
    .filter(
      (r) =>
        (isType(r, "supplied_by") && r.from_company_id === companyId) ||
        (isType(r, "approved_vendor_of") && r.to_company_id === companyId),
    )
    .map(edgeView);
  const partnerEdges = rels.filter((r) => isType(r, "partnered_with")).map(edgeView);

  // ── typical subcontracted packages ──
  const subProjects = new Map<Discipline, Set<string>>();
  const add = (d: Discipline | null, projectId: string | null) => {
    if (!d || !projectId) return;
    if (!subProjects.has(d)) subProjects.set(d, new Set());
    subProjects.get(d)!.add(projectId);
  };
  const subcontractKeys = new Set<string>();
  for (const r of rels) {
    if (!isType(r, "subcontracted_to") || r.from_company_id !== companyId) continue;
    if (r.event_date && !withinYears(r.event_date, now, G.typicalPackageWindowYears)) continue;
    add(r.discipline, r.project_id);
    if (r.project_id && r.discipline) subcontractKeys.add(`${r.project_id}|${r.discipline}`);
    if (r.package_id) subcontractKeys.add(`pkg|${r.package_id}`);
  }
  const epcProjectIds = unique(parties.filter((p) => p.role === "main_epc" || p.role === "consortium_member").map((p) => p.project_id));
  if (epcProjectIds.length) {
    const { rows } = await db.query<{ project_id: string; package_id: string; discipline: Discipline; award_date: string | null }>(
      `select pp.project_id, pp.package_id, pk.discipline, pp.award_date
         from project_parties pp join packages pk on pk.id = pp.package_id
        where pp.role = 'subcontractor' and pp.company_id <> $1 and pp.project_id = any($2::uuid[])`,
      [companyId, epcProjectIds],
    );
    for (const row of rows) {
      if (row.award_date && !withinYears(row.award_date, now, G.typicalPackageWindowYears)) continue;
      add(row.discipline, row.project_id);
      subcontractKeys.add(`${row.project_id}|${row.discipline}`);
      subcontractKeys.add(`pkg|${row.package_id}`);
    }
  }
  const typicalSubcontracted = [...subProjects.entries()]
    .filter(([, projects]) => projects.size >= G.typicalPackageMinProjects)
    .map(([d]) => d)
    .sort();

  // ── typical self-performed packages ──
  const owned = (
    await db.query<{ id: string; project_id: string; discipline: Discipline }>(
      "select id, project_id, discipline from packages where package_owner_company_id = $1",
      [companyId],
    )
  ).rows;
  const selfProjects = new Map<Discipline, Set<string>>();
  for (const pkg of owned) {
    if (subcontractKeys.has(`pkg|${pkg.id}`) || subcontractKeys.has(`${pkg.project_id}|${pkg.discipline}`)) continue;
    if (!selfProjects.has(pkg.discipline)) selfProjects.set(pkg.discipline, new Set());
    selfProjects.get(pkg.discipline)!.add(pkg.project_id);
  }
  const typicalSelfPerformed = [...selfProjects.entries()]
    .filter(([, projects]) => projects.size >= G.typicalPackageMinProjects)
    .map(([d]) => d)
    .sort();

  // ── awards and projects ──
  const awardProjects = new Set<string>();
  for (const p of parties)
    if (AWARD_ROLES.includes(p.role) && withinYears(p.award_date, now, G.awardsWindowYears)) awardProjects.add(p.project_id);
  for (const r of rels)
    if (isType(r, "awarded_to") && r.to_company_id === companyId && r.project_id && withinYears(r.event_date, now, G.awardsWindowYears))
      awardProjects.add(r.project_id);

  const projects: InsightProject[] = parties.map((p) => ({
    projectId: p.project_id,
    name: p.project_name,
    country: p.country,
    sector: p.sector,
    role: p.role,
    awardDate: p.award_date,
    valueUsd: p.value_usd,
    evidenceIds: unique((partyEvidence.get(p.id) ?? []).map((e) => e.evidence_id)),
  }));

  return {
    companyId,
    awards5y: awardProjects.size,
    sectors: unique(parties.map((p) => p.sector).filter((s): s is string => Boolean(s))),
    countries: unique(parties.map((p) => p.country).filter((c): c is string => Boolean(c))),
    regularSuppliers: regularPartners(supplierEdges, names, now),
    regularPartners: regularPartners(partnerEdges, names, now),
    typicalSubcontracted,
    typicalSelfPerformed,
    projects,
  };
}
