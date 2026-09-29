/**
 * Supply chain, directory and contacts across the chain — database side (docs/mvp/15 §B–§E).
 * Loads a ChainData snapshot (companies, relations, directory, manual links, people, contact points),
 * keeps the company directory in sync (observed / known-companies / seed), builds derived buyers for
 * SuperSearch, and writes manual company links, derived leads and manual contacts. Server-only.
 */
import { getKnownCompanies, type KnownCompany } from "@/mvp/config/buyers-config";
import { getDirectorySeed, getSupplierType } from "@/mvp/config/supply-map";
import { outreachRules } from "@/mvp/compliance";
import { getDb, type Queryable } from "@/mvp/db";
import { ensurePlaceNameCleanup } from "@/mvp/pipeline/place-cleanup";
import { normalizeCompanyName, shortCompanyName } from "@/mvp/pipeline/text";
import { allBuyerRecords, clearBuyerCache, isUuid } from "./load";
import { findKnownCompany, supplierRoleFor } from "./roles";
import {
  buildSupplyChain,
  chainContacts,
  derivedKeyOf,
  nodeTypeKey,
  parseDerivedKey,
  type ChainCapability,
  type ChainCompanyInfo,
  type ChainData,
  type ChainOptions,
  type ChainRelation,
  type ChainRoot,
  type ContactPointLite,
  type ManualLink,
} from "./supply-tree";
import { buildTeam, slotDefs, teamCounts, type TeamPerson } from "./team";
import type { AddContactInput, BuyerRow, BuyerView, ChainContactRow, ChainLinkStatus, ChainNode, ChainTier, SupplyChain } from "./types";
import { DERIVED_PREFIX } from "./types";
import type { BuyerRecord } from "./view";
import { labelOfType } from "./what-they-do";
import { companyGroupKey } from "./group";

async function q<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

// ───────────────────────── type keys ─────────────────────────

/** Supplier-type key of a known company (known-companies.json). */
export function knownTypeKey(known: KnownCompany | null): string | null {
  if (!known) return null;
  switch (known.role) {
    case "manufacturer":
      if (known.subRole === "pipe_mill") return "pipe_maker";
      if (known.subRole === "valve_maker") return "valve_maker";
      return known.makes.some((m) => /fitting|flange|bend/.test(m)) ? "fittings_maker" : null;
    case "distributor":
      return "stockist";
    case "fabricator":
      return "fabricator";
    case "epc_contractor":
      return known.subRole === "plant" ? "plant_builder" : known.subRole === "water" ? "water_contractor" : "pipeline_builder";
    case "subcontractor":
      return null;
    case "owner":
      return null;
  }
}

function typeKeysFromCompanyTypes(name: string, types: readonly string[]): string[] {
  const out: string[] = [];
  if (types.includes("stockist_trader")) out.push("stockist");
  if (types.includes("fabricator")) out.push("fabricator");
  if (types.includes("manufacturer")) {
    const role = supplierRoleFor(name, types);
    if (role === "manufacturer") out.push(/\bvalves?\b/i.test(name) ? "valve_maker" : /\b(?:pipes?|tubes?|tubulars?|seamless)\b/i.test(name) ? "pipe_maker" : "fittings_maker");
  }
  return out;
}

// ───────────────────────── directory sync (15 §C) ─────────────────────────

let lastSync: { key: string; at: number } | null = null;

/**
 * Fill company_capabilities from what we observed (tier-1 buyers' roles and competitor items, suppliers
 * named in supply orders), known-companies.json (companies present in our data) and the cited seed list.
 * Idempotent (unique index + on conflict do nothing).
 */
export async function syncDirectory(db: Queryable, records: readonly BuyerRecord[]): Promise<void> {
  const insert = (companyId: string, type: string, item: string | null, country: string | null, source: "observed" | "seed" | "user", url: string | null, note: string) =>
    db.query(
      `insert into company_capabilities (company_id, supplier_type, item_id, country, source, url, note)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`,
      [companyId, type, item, country, source, url, note],
    );
  // Observed: tier-1 buyers (not clients running a project, not consultants / places / competitors-only).
  for (const r of records) {
    if (r.derived || r.consultant || r.view.stage === "not_buyer") continue;
    const def = getSupplierType(r.typeKey);
    if (!def || def.role === "owner") continue;
    await insert(r.view.companyId, r.typeKey, null, r.hqCountry, "observed", null, `Seen in our data: ${def.label.toLowerCase()}`);
    for (const item of r.view.sellItems.filter((i) => i.fit === "competitor")) await insert(r.view.companyId, r.typeKey, item.itemId, r.hqCountry, "observed", null, "Makes or stocks it (competitor check)");
  }
  // Observed: suppliers named in supply orders.
  const suppliers = await q<{ id: string; canonical_name: string; country: string | null; types: string[] }>(
    db,
    `select distinct c.id, c.canonical_name, c.country, c.types from relationships r join companies c on c.id = r.to_company_id where r.type = 'supplied_by'`,
  );
  for (const c of suppliers) {
    const key = knownTypeKey(findKnownCompany(c.canonical_name)) ?? typeKeysFromCompanyTypes(c.canonical_name, c.types ?? [])[0] ?? null;
    if (key) await insert(c.id, key, null, findKnownCompany(c.canonical_name)?.country ?? c.country, "observed", null, "Named as a supplier in a source");
  }
  // Known companies present in our data.
  const companies = await q<{ id: string; canonical_name: string; country: string | null }>(db, "select id, canonical_name, country from companies");
  const byKnown = new Map<KnownCompany, { id: string; country: string | null }>();
  for (const c of companies) {
    const known = findKnownCompany(c.canonical_name);
    if (!known) continue;
    if (!byKnown.has(known)) byKnown.set(known, { id: c.id, country: known.country ?? c.country });
    const key = knownTypeKey(known);
    if (!key) continue;
    await insert(c.id, key, null, known.country ?? c.country, "observed", null, "Known-companies list");
    for (const item of known.makes) await insert(c.id, key, item, known.country ?? c.country, "observed", null, "Known-companies list");
  }
  void getKnownCompanies;
  // Seed: well-known makers, each cited from its own website.
  for (const seed of getDirectorySeed()) {
    const known = findKnownCompany(seed.name);
    let id = (known && byKnown.get(known)?.id) ?? companies.find((c) => normalizeCompanyName(c.canonical_name) === normalizeCompanyName(seed.name))?.id ?? null;
    if (!id) {
      const created = await q<{ id: string }>(
        db,
        `insert into companies (canonical_name, normalized_name, country, types, domain, match_certainty)
         values ($1, $2, $3, '{manufacturer}', $4, 0.9) returning id`,
        [seed.name, normalizeCompanyName(seed.name), seed.country, seed.domain],
      );
      id = created[0].id;
      companies.push({ id, canonical_name: seed.name, country: seed.country });
    }
    for (const type of seed.types) {
      await insert(id, type, null, seed.country, "seed", seed.url, seed.says);
      for (const item of seed.items) await insert(id, type, item, seed.country, "seed", seed.url, seed.says);
    }
  }
}

// ───────────────────────── snapshot ─────────────────────────

let chainCache: { key: string; at: number; data: ChainData } | null = null;
const CHAIN_CACHE_MS = 30_000;

async function chainVersion(db: Queryable): Promise<string> {
  const [row] = await q<Record<string, unknown>>(
    db,
    `select (select count(*)::int from relationships) as r, (select count(*)::int from companies) as c,
            (select count(*)::int from company_capabilities) as k, (select max(created_at)::text from chain_links) as m,
            (select count(*)::int from people) as p, (select max(created_at)::text from contact_points) as cp,
            (select max(confirmed_at)::text from people) as pc, (select count(*)::int from leads) as l`,
  );
  return JSON.stringify(row);
}

/** Forget the cached snapshot (after a write). */
export function clearChainCache(): void {
  chainCache = null;
  lastSync = null;
  clearBuyerCache();
}

/** Load the ChainData snapshot (and sync the directory when data changed). */
export async function loadChainData(records: readonly BuyerRecord[], db: Queryable = getDb()): Promise<ChainData> {
  let key = await chainVersion(db);
  if (chainCache && chainCache.key === key && Date.now() - chainCache.at < CHAIN_CACHE_MS) return chainCache.data;
  if (!lastSync || lastSync.key !== key) {
    await syncDirectory(db, records);
    key = await chainVersion(db);
    lastSync = { key, at: Date.now() };
  }
  const [companies, rels, caps, manual, people, cps] = await Promise.all([
    q<{ id: string; canonical_name: string; country: string | null; types: string[]; domain: string | null }>(db, "select id, canonical_name, country, types, domain from companies"),
    q<{ id: string; from_company_id: string; to_company_id: string; type: string; project_id: string | null; event_date: string | null; evidence_ids: string[] | null }>(
      db,
      `select r.id, r.from_company_id, r.to_company_id, r.type, r.project_id, r.event_date::text as event_date,
              array(select fe.evidence_id::text from fact_evidence fe where fe.entity_type = 'relationship' and fe.entity_id = r.id) as evidence_ids
         from relationships r where r.type in ('supplied_by','subcontracted_to','awarded_to')`,
    ),
    q<{ company_id: string; supplier_type: string; item_id: string | null; country: string | null; source: ChainCapability["source"]; url: string | null }>(db, "select company_id, supplier_type, item_id, country, source, url from company_capabilities"),
    q<{ parent_company_id: string; supplier_type: string; company_id: string; action: "set" | "removed"; created_at: string }>(db, "select parent_company_id, supplier_type, company_id, action, created_at from chain_links order by created_at"),
    q<{ id: string; full_name: string; title: string | null; department: string | null; current_company_id: string | null; slot_id: string | null; confirmed_at: string | null }>(
      db,
      "select id, full_name, title, department, current_company_id, slot_id, confirmed_at from people where current_company_id is not null order by full_name",
    ),
    q<{ person_id: string; kind: "email" | "phone" | "linkedin"; value: string }>(db, "select person_id, kind, value from contact_points order by created_at"),
  ]);
  const personFacts = people.length
    ? await q<{ entity_id: string; evidence_id: string }>(db, "select entity_id, evidence_id from fact_evidence where entity_type = 'person' and entity_id = any($1::uuid[])", [people.map((p) => p.id)])
    : [];
  const factsBy = new Map<string, string[]>();
  for (const f of personFacts) (factsBy.get(f.entity_id) ?? factsBy.set(f.entity_id, []).get(f.entity_id)!).push(f.evidence_id);

  // Type keys and strongest lead per company.
  const typeKeys = new Map<string, string[]>();
  const addType = (id: string, key: string | null) => {
    if (!key) return;
    const list = typeKeys.get(id) ?? [];
    if (!list.includes(key)) list.push(key);
    typeKeys.set(id, list);
  };
  // Strongest lead per company group: a node whose company belongs to a tier-1 buyer links to its lead.
  const leadOf = new Map<string, BuyerRecord>();
  for (const r of records) {
    if (r.derived) continue;
    addType(r.view.companyId, r.typeKey);
    const prev = leadOf.get(r.groupKey);
    if (!prev || prev.view.fitScore < r.view.fitScore) leadOf.set(r.groupKey, r);
  }
  for (const c of caps) addType(c.company_id, c.supplier_type);
  const map = new Map<string, ChainCompanyInfo>();
  for (const c of companies) {
    const known = findKnownCompany(c.canonical_name);
    addType(c.id, knownTypeKey(known));
    for (const k of typeKeysFromCompanyTypes(c.canonical_name, c.types ?? [])) addType(c.id, k);
    const groupKey = companyGroupKey(c.id, c.canonical_name);
    map.set(c.id, {
      id: c.id,
      name: c.canonical_name,
      country: known?.country ?? c.country,
      typeKeys: typeKeys.get(c.id) ?? [],
      leadId: leadOf.get(groupKey)?.view.leadId ?? null,
      website: c.domain,
      groupKey,
    });
  }
  const relations: ChainRelation[] = rels.map((r) => ({
    buyerId: r.from_company_id,
    supplierId: r.to_company_id,
    kind: r.type === "supplied_by" ? "supply" : r.type === "subcontracted_to" ? "subcontract" : "award",
    projectId: r.project_id,
    date: r.event_date,
    evidenceIds: r.evidence_ids ?? [],
  }));
  const peopleByCompany = new Map<string, TeamPerson[]>();
  for (const p of people) {
    const list = peopleByCompany.get(p.current_company_id!) ?? [];
    list.push({ id: p.id, name: p.full_name, title: p.title, department: p.department, evidenceIds: factsBy.get(p.id) ?? [], slotId: p.slot_id });
    peopleByCompany.set(p.current_company_id!, list);
  }
  const contactPoints = new Map<string, ContactPointLite>();
  for (const cp of cps) {
    const entry = contactPoints.get(cp.person_id) ?? { email: null, phone: null, linkedinUrl: null };
    if (cp.kind === "email") entry.email = cp.value;
    if (cp.kind === "phone") entry.phone = cp.value;
    if (cp.kind === "linkedin") entry.linkedinUrl = cp.value;
    contactPoints.set(cp.person_id, entry);
  }
  const data: ChainData = {
    companies: map,
    relations,
    capabilities: caps.map((c) => ({ companyId: c.company_id, supplierType: c.supplier_type, itemId: c.item_id, country: c.country, source: c.source, url: c.url })),
    manual: manual.map<ManualLink>((m) => ({ parentCompanyId: m.parent_company_id, supplierType: m.supplier_type, companyId: m.company_id, action: m.action, at: m.created_at })),
    peopleByCompany,
    confirmedPersonIds: new Set(people.filter((p) => p.confirmed_at).map((p) => p.id)),
    contactPoints,
  };
  chainCache = { key, at: Date.now(), data };
  return data;
}

// ───────────────────────── roots and chains ─────────────────────────

export function rootOf(record: BuyerRecord): ChainRoot {
  return {
    leadId: record.view.leadId,
    companyId: record.view.companyId,
    name: record.view.name,
    typeKey: record.typeKey,
    country: record.hqCountry,
    siteCountry: record.siteCountry,
    projectId: record.projectId,
    projectType: record.projectType,
    triggerDate: record.view.triggerDate,
    view: record.view,
  };
}

/** True when a tier-1 record roots a chain shown in search (a visible, real buyer). */
function isChainRoot(r: BuyerRecord): boolean {
  return !r.derived && !r.consultant && !r.competitorForAll && r.view.stage !== "not_buyer" && r.leadStatus !== "rejected" && r.view.tier === 1;
}

const LINK_FIT: Record<Exclude<ChainLinkStatus, "not_identified">, number> = { confirmed: 0.85, likely: 0.7, possible: 0.55 };
const LINK_RANK: Record<ChainLinkStatus, number> = { confirmed: 0, likely: 1, possible: 2, not_identified: 3 };

/** A synthetic buyer record for an identified tier-2/3 company without a stored lead (15 §D). */
export function derivedRecord(root: BuyerRecord, node: ChainNode, data: ChainData): BuyerRecord | null {
  if (!node.companyId || node.leadId || node.link === "not_identified" || node.tier === 1) return null;
  const typeKey = nodeTypeKey(node);
  const def = typeKey ? getSupplierType(typeKey) : undefined;
  if (!typeKey || !def) return null;
  const info = data.companies.get(node.companyId);
  const name = info?.name ?? node.name;
  const key = derivedKeyOf(root.view.leadId, node.companyId, typeKey, node.tier);
  const team = buildTeam(def.role, shortCompanyName(name), data.peopleByCompany.get(node.companyId) ?? [], { confirmedPersonIds: data.confirmedPersonIds, website: info?.website ?? null });
  const { found, total } = teamCounts(team);
  const rootShort = root.view.shortName;
  const link = node.link;
  const reason =
    link === "confirmed"
      ? `Supplies ${node.supplies || def.does} to ${rootShort}${root.row.buyingReason ? ` (${root.row.buyingReason})` : ""}`
      : link === "likely"
        ? `Worked with ${rootShort} before — likely to supply ${node.supplies || def.does} again`
        : `${node.linkWhy} — could supply ${node.supplies || def.does} to ${rootShort}`;
  const shortReason = link === "confirmed" ? `Supplies ${rootShort}: ${node.supplies || def.does}` : link === "likely" ? `Worked with ${rootShort} before` : `Could supply ${rootShort}: ${node.supplies || def.does}`;
  const fitScore = Math.round(root.view.fitScore * LINK_FIT[link] * (node.tier === 3 ? 0.85 : 1));
  const reach = outreachRules(info?.country ?? "");
  const sellItems = node.wouldBuy;
  const view: BuyerView = {
    leadId: `${DERIVED_PREFIX}${key}`,
    companyId: node.companyId,
    name,
    shortName: shortCompanyName(name),
    role: def.role,
    roleLabel: def.label,
    subRoleLabel: def.label,
    country: info?.country ?? null,
    city: null,
    stage: "check",
    fitScore,
    howSure: link === "confirmed" ? "medium" : "low",
    headline: `${shortCompanyName(name)} (${def.label}${info?.country ? `, ${info.country}` : ""}) — tier ${node.tier} in ${rootShort}'s supply chain.`,
    buyingReason: reason,
    buyingReasonEvidenceIds: node.evidenceIds,
    triggerDate: root.view.triggerDate,
    sellItems,
    competitorFor: [],
    window: [],
    whyYou: [],
    team,
    found,
    total,
    chain: [],
    reach: { country: info?.country ?? null, email: reach.email, summary: reach.steps[0] ?? "" },
    proof: [],
    status: "new",
    isSample: root.view.isSample,
    updatedAt: root.view.updatedAt,
    whatTheyDo: def.label,
    tier: node.tier,
    foundVia: { leadId: root.view.leadId, name: root.view.name },
    deals: [],
    chainSummary: { tier2: 0, tier3: 0, peopleTotal: total, peopleFound: found },
  };
  const row: BuyerRow = {
    leadId: view.leadId,
    name,
    subRoleLabel: def.label,
    role: def.role,
    roleLabel: def.label,
    buyingReason: shortReason,
    sellSummary: sellItems.slice(0, 4).map((i) => i.name.split(/[(,]/)[0].trim()).join(", "),
    competitorNote: node.competitorFor.length ? `Makes ${node.competitorFor.slice(0, 2).join(" and ")} — competitor for these` : null,
    country: view.country,
    fitScore,
    howSure: view.howSure,
    stage: "check",
    found,
    total,
    isSample: view.isSample,
    triggerDate: view.triggerDate,
    whatTheyDo: def.label,
    tier: node.tier,
    foundVia: view.foundVia,
    dealsCount: 0,
    derivedKey: key,
    storedLeadId: null,
    link,
  };
  return {
    view,
    row,
    hqCountry: view.country,
    siteCountry: root.siteCountry,
    site: root.site,
    sector: root.sector,
    valueUsd: null,
    signals: [],
    createdAt: root.createdAt,
    slotDepartments: Object.fromEntries(slotDefs(def.role).map((d) => [d.slotId, d.department])),
    leadStatus: "new",
    competitorForAll: false,
    typeKey,
    groupKey: info?.groupKey ?? companyGroupKey(node.companyId, name),
    projectId: root.projectId,
    projectType: root.projectType,
    consultant: false,
    sourceCount: 0,
    derived: { key, rootLeadId: root.view.leadId, link },
  };
}

/** Derived buyers of every visible tier-1 buyer: one record per company, best link first. */
export function derivedRecords(records: readonly BuyerRecord[], data: ChainData): BuyerRecord[] {
  const tier1Groups = new Set(records.filter((r) => !r.derived).map((r) => r.groupKey));
  const tier1Companies = new Set(records.filter((r) => !r.derived).map((r) => r.view.companyId));
  const best = new Map<string, BuyerRecord>();
  for (const root of records.filter(isChainRoot)) {
    const chain = buildSupplyChain(rootOf(root), data, { expand: "all" });
    for (const node of chain.nodes) {
      if (!node.companyId || tier1Companies.has(node.companyId)) continue;
      const rec = derivedRecord(root, node, data);
      if (!rec || tier1Groups.has(rec.groupKey)) continue;
      const prev = best.get(node.companyId);
      const better =
        !prev ||
        LINK_RANK[rec.derived!.link] < LINK_RANK[prev.derived!.link] ||
        (rec.derived!.link === prev.derived!.link && (rec.view.tier < prev.view.tier || (rec.view.tier === prev.view.tier && rec.view.fitScore > prev.view.fitScore)));
      if (better) best.set(node.companyId, rec);
    }
  }
  return [...best.values()];
}

/** Tier-1 records plus derived buyers — everything SuperSearch searches. */
export async function allSearchRecords(db?: Queryable): Promise<BuyerRecord[]> {
  const database = db ?? getDb();
  await ensurePlaceNameCleanup(database);
  const records = await allBuyerRecords(db ? { db } : {});
  const data = await loadChainData(records, database);
  return [...records, ...derivedRecords(records, data)];
}

/** Records of the same company as `record` (one page per company, 15 §A3), strongest first. */
export function companyGroup(record: BuyerRecord, records: readonly BuyerRecord[]): BuyerRecord[] {
  return records
    .filter((r) => !r.derived && r.groupKey === record.groupKey)
    .sort((a, b) => b.view.fitScore - a.view.fitScore || (b.view.triggerDate ?? "").localeCompare(a.view.triggerDate ?? ""));
}

async function recordFor(leadId: string, db?: Queryable): Promise<{ record: BuyerRecord; records: BuyerRecord[]; data: ChainData } | null> {
  const database = db ?? getDb();
  await ensurePlaceNameCleanup(database);
  const records = await allBuyerRecords(db ? { db } : {});
  const data = await loadChainData(records, database);
  let record = records.find((r) => r.view.leadId === leadId) ?? null;
  if (!record && leadId.startsWith(DERIVED_PREFIX)) record = derivedRecords(records, data).find((r) => r.view.leadId === leadId) ?? null;
  return record ? { record, records, data } : null;
}

/** GET /api/mvp/chain/[leadId] → SupplyChain (tier 1 = this buyer). */
export async function getSupplyChain(leadId: string, opts: ChainOptions = {}, db?: Queryable): Promise<SupplyChain | null> {
  const found = await recordFor(leadId, db);
  if (!found) return null;
  return buildSupplyChain(rootOf(found.record), found.data, opts);
}

/** GET /api/mvp/chain/[leadId]/contacts → every node × buying-team slot. */
export async function getChainContacts(leadId: string, opts: ChainOptions = {}, db?: Queryable): Promise<ChainContactRow[] | null> {
  const found = await recordFor(leadId, db);
  if (!found) return null;
  const root = rootOf(found.record);
  return chainContacts(buildSupplyChain(root, found.data, opts), found.data, root);
}

/** The buyer view with its deals and chain summary (15 §A3, §B). */
export async function getBuyerPage(leadId: string, db?: Queryable): Promise<BuyerView | null> {
  const found = await recordFor(leadId, db);
  if (!found) return null;
  const { record, records, data } = found;
  const group = record.derived ? [record] : companyGroup(record, records);
  const deals = group.flatMap((r) => r.view.deals);
  const chain = buildSupplyChain(rootOf(record), data);
  return {
    ...record.view,
    deals: deals.length ? deals : record.view.deals,
    chainSummary: {
      tier2: chain.nodes.filter((n) => n.tier === 2).length,
      tier3: chain.nodes.filter((n) => n.tier === 3).length,
      peopleTotal: chain.peopleTotal,
      peopleFound: chain.peopleFound,
    },
  };
}

// ───────────────────────── writes ─────────────────────────

export class ChainError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ChainError";
  }
}

async function findOrCreateCompany(db: Queryable, name: string, country: string | null): Promise<string> {
  const normalized = normalizeCompanyName(name);
  if (!normalized) throw new ChainError(400, "Company name is empty.");
  const known = findKnownCompany(name);
  const existing = await q<{ id: string; canonical_name: string }>(db, "select id, canonical_name from companies where normalized_name = $1 order by created_at limit 1", [normalized]);
  if (existing[0]) return existing[0].id;
  if (known) {
    const all = await q<{ id: string; canonical_name: string }>(db, "select id, canonical_name from companies");
    const hit = all.find((c) => findKnownCompany(c.canonical_name) === known);
    if (hit) return hit.id;
  }
  const created = await q<{ id: string }>(db, "insert into companies (canonical_name, normalized_name, country, match_certainty) values ($1, $2, $3, 0.7) returning id", [
    name.trim(),
    normalized,
    known?.country ?? country,
  ]);
  return created[0].id;
}

async function nodeContext(rootLeadId: string, nodeId: string, db?: Queryable) {
  const found = await recordFor(rootLeadId, db);
  if (!found) throw new ChainError(404, "Buyer not found.");
  const chain = buildSupplyChain(rootOf(found.record), found.data, { expand: "all" });
  const node = chain.nodes.find((n) => n.nodeId === nodeId);
  if (!node || node.tier === 1) throw new ChainError(404, "Node not found.");
  const parent = chain.nodes.find((n) => n.nodeId === node.parentNodeId);
  const typeKey = nodeTypeKey(node);
  if (!typeKey) throw new ChainError(404, "Node not found.");
  return { found, chain, node, parent, typeKey };
}

/**
 * Set the company of a node (15 §B): creates or links the company, stores a `set` link (confirmed,
 * source "your team") and a `user` directory row. The parent node must have a company.
 */
export async function setNodeCompany(rootLeadId: string, nodeId: string, name: string, userId: string | null = null, db: Queryable = getDb()): Promise<SupplyChain> {
  const { found, parent, typeKey } = await nodeContext(rootLeadId, nodeId, db);
  if (!parent?.companyId) throw new ChainError(409, "Set the company of the supplier above first.");
  const companyId = await findOrCreateCompany(db, name, found.record.siteCountry ?? found.record.hqCountry);
  if (companyId === parent.companyId) throw new ChainError(400, "A company cannot supply itself.");
  await db.query("insert into chain_links (parent_company_id, supplier_type, company_id, action, created_by) values ($1, $2, $3, 'set', $4)", [parent.companyId, typeKey, companyId, userId]);
  const country = found.data.companies.get(companyId)?.country ?? null;
  await db.query(
    "insert into company_capabilities (company_id, supplier_type, country, source, note) values ($1, $2, $3, 'user', 'Set by your team') on conflict do nothing",
    [companyId, typeKey, country],
  );
  clearChainCache();
  return (await getSupplyChain(rootLeadId, {}, db))!;
}

/** Remove a wrong company from a node (15 §B): stores a `removed` link so it is not proposed again. */
export async function removeNodeCompany(rootLeadId: string, nodeId: string, userId: string | null = null, db: Queryable = getDb()): Promise<SupplyChain> {
  const { node, parent, typeKey } = await nodeContext(rootLeadId, nodeId, db);
  if (!node.companyId) throw new ChainError(409, "This node has no company.");
  if (!parent?.companyId) throw new ChainError(409, "The supplier above has no company.");
  await db.query("insert into chain_links (parent_company_id, supplier_type, company_id, action, created_by) values ($1, $2, $3, 'removed', $4)", [parent.companyId, typeKey, node.companyId, userId]);
  clearChainCache();
  return (await getSupplyChain(rootLeadId, {}, db))!;
}

/**
 * Materialise a derived buyer as a lead (15 §D): kind supply_subcontract, class research, on the
 * root deal's project, with its tier and the tier-1 deal it was found via. Returns the lead id
 * (an existing lead of that company on that project is reused).
 */
export async function deriveBuyer(derivedKey: string, db: Queryable = getDb()): Promise<{ leadId: string; created: boolean }> {
  const key = derivedKey.startsWith(DERIVED_PREFIX) ? derivedKey.slice(DERIVED_PREFIX.length) : derivedKey;
  const parsed = parseDerivedKey(key);
  if (!parsed) throw new ChainError(400, "Invalid derived buyer key.");
  const found = await recordFor(parsed.rootLeadId, db);
  if (!found) throw new ChainError(404, "The buyer this was found via no longer exists.");
  const rec = derivedRecords(found.records, found.data).find((r) => r.derived?.key === key) ?? null;
  const company = await q<{ id: string }>(db, "select id from companies where id = $1", [parsed.companyId]);
  if (!company.length) throw new ChainError(404, "Company not found.");
  const projectId = found.record.projectId;
  const existing = await q<{ id: string }>(db, "select id from leads where buyer_company_id = $1 and project_id is not distinct from $2 and package_id is null and kind = 'supply_subcontract'", [
    parsed.companyId,
    projectId,
  ]);
  if (existing[0]) return { leadId: existing[0].id, created: false };
  const def = getSupplierType(parsed.typeKey)!;
  const reasonText = rec?.view.buyingReason ?? `${labelOfType(parsed.typeKey)} in ${found.record.view.shortName}'s supply chain`;
  const evidenceIds = rec?.view.buyingReasonEvidenceIds ?? [];
  const fit = rec?.view.fitScore ?? Math.round(found.record.view.fitScore * 0.5);
  const inserted = await q<{ id: string }>(
    db,
    `insert into leads (kind, buyer_company_id, project_id, score, score_breakdown, gate_results, confidence, confidence_band, class, reasons,
                        scoring_version, is_sample, buyer_type, chain_tier, found_via_lead_id)
     values ('supply_subcontract', $1, $2, $3, '{}'::jsonb, '[]'::jsonb, $4, $5, 'research', $6::jsonb, 1, $7, $8, $9, $10) returning id`,
    [
      parsed.companyId,
      projectId,
      fit,
      rec?.view.howSure === "medium" ? 0.6 : 0.4,
      rec?.view.howSure ?? "low",
      JSON.stringify([{ text: reasonText, evidenceIds }]),
      found.record.view.isSample,
      def.role,
      parsed.tier,
      found.record.view.leadId,
    ],
  );
  clearChainCache();
  return { leadId: inserted[0].id, created: true };
}

/** Add a contact by hand (15 §E): a person (source manual, status Likely) plus contact points. */
export async function addContact(input: AddContactInput, db: Queryable = getDb()): Promise<{ personId: string }> {
  if (!isUuid(input.companyId)) throw new ChainError(404, "Company not found.");
  const company = await q<{ id: string; country: string | null }>(db, "select id, country from companies where id = $1", [input.companyId]);
  if (!company.length) throw new ChainError(404, "Company not found.");
  const name = input.name.replace(/\s+/g, " ").trim();
  const personId = await (async () => {
    const created = await q<{ id: string }>(
      db,
      `insert into people (full_name, normalized_name, current_company_id, title, country, profile_url, source, slot_id, notes)
       values ($1, $2, $3, $4, $5, $6, 'manual', $7, $8) returning id`,
      [name, name.toLowerCase(), input.companyId, input.title.trim() || null, company[0].country, input.linkedinUrl ?? null, input.slotId, input.notes ?? null],
    );
    return created[0].id;
  })();
  const points: [string, string | undefined][] = [
    ["email", input.email],
    ["phone", input.phone],
    ["linkedin", input.linkedinUrl],
  ];
  for (const [kind, value] of points)
    if (value && value.trim())
      await db.query("insert into contact_points (person_id, kind, value, source) values ($1, $2, $3, 'manual') on conflict do nothing", [personId, kind, value.trim()]);
  clearChainCache();
  return { personId };
}

/**
 * Confirm a person as the decision maker of their slot (15 §E): stamps people.confirmed_at and logs an
 * activity on a lead of their company (the given lead, else the company's newest lead) when one exists.
 */
export async function confirmPerson(personId: string, opts: { leadId?: string | null; slotId?: string | null; userId?: string | null } = {}, db: Queryable = getDb()): Promise<boolean> {
  if (!isUuid(personId)) return false;
  const person = await q<{ id: string; current_company_id: string | null; slot_id: string | null }>(db, "select id, current_company_id, slot_id from people where id = $1", [personId]);
  if (!person.length) return false;
  await db.query("update people set confirmed_at = now(), slot_id = coalesce($2, slot_id) where id = $1", [personId, opts.slotId ?? null]);
  const leadId =
    (opts.leadId && isUuid(opts.leadId) ? opts.leadId : null) ??
    (person[0].current_company_id ? (await q<{ id: string }>(db, "select id from leads where buyer_company_id = $1 order by created_at desc limit 1", [person[0].current_company_id]))[0]?.id : null) ??
    null;
  if (leadId)
    await db.query("insert into activities (lead_id, person_id, type, body, user_id) values ($1, $2, 'note', $3, $4)", [
      leadId,
      personId,
      `contact_confirmed:${personId.toLowerCase()}${opts.slotId ?? person[0].slot_id ? `:${opts.slotId ?? person[0].slot_id}` : ""}`,
      opts.userId ?? null,
    ]);
  clearChainCache();
  return true;
}

/** Remove a contact that was added by hand (source manual). People named in sources are never deleted. */
export async function deleteManualContact(personId: string, db: Queryable = getDb()): Promise<boolean> {
  if (!isUuid(personId)) return false;
  const deleted = await q<{ id: string }>(db, "delete from people where id = $1 and source = 'manual' returning id", [personId]);
  if (!deleted.length) return false;
  // Its "confirmed decision maker" notes would otherwise linger with person_id set to null.
  await db.query("delete from activities where body like $1", [`contact_confirmed:${personId.toLowerCase()}%`]);
  clearChainCache();
  return true;
}

export type { ChainTier };
