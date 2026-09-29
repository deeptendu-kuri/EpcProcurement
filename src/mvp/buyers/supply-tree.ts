/**
 * Supply-chain tree (docs/mvp/15 §B, §E): tier 1 = the buyer that won the work; tier 2 = the supplier
 * types it buys from (supply map); tier 3 = their supplier types (expand on demand). Each node holds
 * one company (or none) with a link status:
 *   confirmed  — a source states the relation for this deal (supply order, subcontract, award), or the
 *                user set the company ("your team");
 *   likely     — the two worked together before in our data (an earlier deal or supply relation);
 *   possible   — a directory company makes / stocks what is needed, same country or region;
 *   not_identified — type known, company unknown.
 * Plus the contacts table across the chain. Pure: chain-db.ts loads the ChainData snapshot.
 */
import { getCatalogueItem } from "@/mvp/config/buyers-config";
import { getSupplierType, getSupplyMap, type SupplierTypeDef } from "@/mvp/config/supply-map";
import { countryName } from "./format";
import { pickNeedsRule, sellItemsFor, shortItemName } from "./needs";
import { findKnownCompany, type Situation } from "./roles";
import { buildTeam, findLinks, slotDefs, type TeamPerson } from "./team";
import type {
  BuyerView,
  ChainCandidate,
  ChainContactRow,
  ChainLinkSource,
  ChainLinkStatus,
  ChainNode,
  ChainTier,
  SellItem,
  SupplyChain,
} from "./types";
import { contractorTypeFor, labelOfType } from "./what-they-do";

// ───────────────────────── data snapshot ─────────────────────────

export interface ChainCompanyInfo {
  id: string;
  name: string;
  country: string | null;
  /** Supplier-type keys this company is known to be (from its leads, known companies, directory). */
  typeKeys: string[];
  /** Its strongest stored lead, if any. */
  leadId: string | null;
  website: string | null;
  /** One company after name merging (group.ts); defaults to the id. */
  groupKey?: string;
}
export interface ChainRelation {
  /** The company that buys (client of the order, contractor that subcontracts, owner that awards). */
  buyerId: string;
  supplierId: string;
  kind: "supply" | "subcontract" | "award";
  projectId: string | null;
  date: string | null;
  evidenceIds: string[];
}
export interface ChainCapability {
  companyId: string;
  supplierType: string;
  itemId: string | null;
  country: string | null;
  source: "observed" | "seed" | "user";
  url: string | null;
}
export interface ManualLink {
  parentCompanyId: string;
  supplierType: string;
  companyId: string;
  action: "set" | "removed";
  at: string;
}
export interface ContactPointLite {
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
}
export interface ChainData {
  companies: ReadonlyMap<string, ChainCompanyInfo>;
  relations: readonly ChainRelation[];
  capabilities: readonly ChainCapability[];
  manual: readonly ManualLink[];
  peopleByCompany: ReadonlyMap<string, TeamPerson[]>;
  confirmedPersonIds: ReadonlySet<string>;
  contactPoints: ReadonlyMap<string, ContactPointLite>;
}

export interface ChainRoot {
  leadId: string;
  companyId: string;
  name: string;
  typeKey: string;
  country: string | null;
  siteCountry: string | null;
  projectId: string | null;
  projectType: string | null;
  triggerDate: string | null;
  /** The tier-1 buyer view (its sell items, team, evidence). */
  view: Pick<BuyerView, "sellItems" | "competitorFor" | "team" | "found" | "total" | "buyingReasonEvidenceIds" | "role" | "shortName">;
}

export interface ChainOptions {
  /** Tier-2 node ids to expand; "all" expands every tier-2 node. Default: identified tier-2 nodes. */
  expand?: "all" | readonly string[];
}

// ───────────────────────── regions ─────────────────────────

const REGIONS: Record<string, string> = {};
const addRegion = (name: string, codes: string[]) => codes.forEach((c) => (REGIONS[c] = name));
addRegion("GCC", ["SA", "AE", "QA", "OM", "KW", "BH"]);
addRegion("South Asia", ["IN", "PK", "BD", "LK", "NP"]);
addRegion("SE Asia", ["MY", "SG", "ID", "TH", "VN", "PH"]);
addRegion("Europe", ["NO", "SE", "DK", "FI", "IS", "DE", "GB", "UK", "NL", "BE", "FR", "IT", "ES", "PL", "AT", "CH", "PT", "IE", "LU", "CZ"]);

export function regionOf(country: string | null | undefined): string | null {
  return country ? (REGIONS[country.toUpperCase()] ?? null) : null;
}

// ───────────────────────── would buy (needs map + competitor check) ─────────────────────────

/** Items a company of this type would buy from the client, and the items it competes on. */
export function wouldBuyFor(typeKey: string, opts: { triggerDate: string | null; projectType: string | null; companyName?: string | null; extraMakes?: readonly string[] }): { wouldBuy: SellItem[]; competitorFor: string[] } {
  const def = getSupplierType(typeKey);
  if (!def) return { wouldBuy: [], competitorFor: [] };
  const known = opts.companyName ? findKnownCompany(opts.companyName) : null;
  const competitors = new Map<string, string>();
  for (const id of [...def.makes, ...(known?.makes ?? []), ...(opts.extraMakes ?? [])]) if (getCatalogueItem(id)) competitors.set(id, def.role === "distributor" ? "They stock it" : "They make it");
  let items: SellItem[];
  if (def.buys) {
    items = def.buys
      .map((id) => getCatalogueItem(id))
      .filter((i): i is NonNullable<typeof i> => Boolean(i))
      .map((i) => ({ itemId: i.id, name: i.name, category: i.category, fit: competitors.has(i.id) ? "competitor" : "good", why: `${def.label}s use ${i.shortName}`, evidenceIds: [] }));
  } else {
    const projectType = (opts.projectType === "pipeline" || opts.projectType === "plant" || opts.projectType === "water" || opts.projectType === "drilling" ? opts.projectType : null) as "pipeline" | "plant" | "water" | "drilling" | null;
    const situation = (def.situation ?? null) as Situation;
    const rule = pickNeedsRule(def.role, situation);
    items = sellItemsFor({ role: def.role, situation, rule, triggerDate: opts.triggerDate, projectType, mentioned: new Map(), productRange: known?.makes ?? [], competitors }).map((planned) => {
      const item: Partial<typeof planned> = { ...planned };
      delete item.group;
      return item as SellItem;
    });
  }
  return {
    wouldBuy: items.filter((i) => i.fit !== "competitor"),
    competitorFor: items.filter((i) => i.fit === "competitor").map((i) => shortItemName(i.itemId)).concat(
      [...competitors.keys()].filter((id) => !items.some((i) => i.itemId === id)).map((id) => shortItemName(id)),
    ),
  };
}

// ───────────────────────── tree ─────────────────────────

const RANK: Record<ChainLinkStatus, number> = { confirmed: 0, likely: 1, possible: 2, not_identified: 3 };
const MAX_CANDIDATES = 5;
const MAX_IDENTIFIED_PER_TYPE = 3;

interface Found {
  companyId: string;
  typeKey: string;
  link: ChainLinkStatus;
  source: ChainLinkSource;
  why: string;
  evidenceIds: string[];
}

function edgesOf(typeKey: string, projectType: string | null): { type: string; supplies: string }[] {
  const def = getSupplierType(typeKey);
  if (def?.role === "owner") return [{ type: contractorTypeFor(projectType), supplies: "builds the project (contractor not named yet)" }];
  return getSupplyMap().buysFrom[typeKey] ?? [];
}

/** Latest manual action per (type, company) of a parent. */
function manualFor(data: ChainData, parentId: string): Map<string, ManualLink> {
  const latest = new Map<string, ManualLink>();
  for (const m of data.manual) {
    if (m.parentCompanyId !== parentId) continue;
    const key = `${m.supplierType}|${m.companyId}`;
    const prev = latest.get(key);
    if (!prev || prev.at <= m.at) latest.set(key, m);
  }
  return latest;
}

/** Pick the supplier type of a related company: one that the parent buys, else its own first type. */
function typeForRelated(data: ChainData, companyId: string, wanted: readonly string[], relKind: ChainRelation["kind"], fallback: string): string {
  const info = data.companies.get(companyId);
  const keys = [...(info?.typeKeys ?? []), ...data.capabilities.filter((c) => c.companyId === companyId).map((c) => c.supplierType)];
  const hit = keys.find((k) => wanted.includes(k));
  if (hit) return hit;
  if (keys[0]) return keys[0];
  if (relKind === "award") return fallback;
  const name = info?.name ?? "";
  if (/\bvalves?\b/i.test(name)) return "valve_maker";
  if (/\b(?:pipes?|tubes?|tubulars?)\b/i.test(name)) return "pipe_maker";
  if (/\b(?:fittings?|flanges?|bends?)\b/i.test(name)) return "fittings_maker";
  return relKind === "subcontract" ? "civil_contractor" : "stockist";
}

function relatedCompanies(data: ChainData, parentId: string, projectId: string | null, wanted: readonly string[], fallbackType: string, parentName: string): Found[] {
  const out = new Map<string, Found>();
  const put = (f: Found) => {
    const prev = out.get(f.companyId);
    if (!prev || RANK[f.link] < RANK[prev.link]) out.set(f.companyId, f);
  };
  // Manual links (your team) first; removals hide the company for this parent + type.
  const manual = manualFor(data, parentId);
  const removed = new Set<string>();
  for (const m of manual.values()) {
    if (m.action === "removed") removed.add(`${m.supplierType}|${m.companyId}`);
    else put({ companyId: m.companyId, typeKey: m.supplierType, link: "confirmed", source: "user", why: "Set by your team", evidenceIds: [] });
  }
  for (const r of data.relations) {
    if (r.buyerId !== parentId || r.supplierId === parentId) continue;
    const typeKey = typeForRelated(data, r.supplierId, wanted, r.kind, fallbackType);
    if (removed.has(`${typeKey}|${r.supplierId}`)) continue;
    const thisDeal = !projectId || !r.projectId || r.projectId === projectId;
    const verb = r.kind === "subcontract" ? "subcontract" : r.kind === "award" ? "contract" : "supply order";
    put({
      companyId: r.supplierId,
      typeKey,
      link: thisDeal ? "confirmed" : "likely",
      source: thisDeal ? "source" : "history",
      why: thisDeal ? `A source names a ${verb} from ${parentName}` : `Worked with ${parentName} before (${verb}${r.date ? `, ${r.date.slice(0, 7)}` : ""})`,
      evidenceIds: r.evidenceIds,
    });
  }
  return [...out.values()].filter((f) => !removed.has(`${f.typeKey}|${f.companyId}`));
}

function groupOf(data: ChainData, companyId: string): string {
  return data.companies.get(companyId)?.groupKey ?? companyId;
}

function candidatesFor(data: ChainData, typeKey: string, countries: readonly (string | null)[], exclude: ReadonlySet<string>, removed: ReadonlySet<string>): ChainCandidate[] {
  const excludedGroups = new Set([...exclude].map((id) => groupOf(data, id)));
  const def = getSupplierType(typeKey);
  const items = new Set(def?.directoryItems ?? []);
  const wanted = countries.filter((c): c is string => Boolean(c)).map((c) => c.toUpperCase());
  const regions = new Set(wanted.map(regionOf).filter((r): r is string => Boolean(r)));
  const best = new Map<string, { score: number; cand: ChainCandidate }>();
  for (const cap of data.capabilities) {
    if (exclude.has(cap.companyId) || removed.has(cap.companyId) || excludedGroups.has(groupOf(data, cap.companyId))) continue;
    if (cap.supplierType !== typeKey && !(cap.itemId && items.has(cap.itemId))) continue;
    const info = data.companies.get(cap.companyId);
    if (!info) continue;
    const country = (cap.country ?? info.country)?.toUpperCase() ?? null;
    const score = country && wanted.includes(country) ? 2 : country && regions.has(regionOf(country) ?? "") ? 1 : 0;
    if (!score) continue;
    const verb = def?.does ?? `is a ${labelOfType(typeKey).toLowerCase()}`;
    const where = score === 2 ? countryName(country) : `${countryName(country)} (${regionOf(country)})`;
    const sourceWord = cap.source === "seed" ? " — their website" : cap.source === "user" ? " — added by your team" : "";
    const cand: ChainCandidate = { companyId: info.id, name: info.name, country, why: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} in ${where}${sourceWord}` };
    const prev = best.get(info.id);
    const s = score * 10 + (cap.source === "user" ? 3 : cap.source === "observed" ? 2 : 1);
    if (!prev || prev.score < s) best.set(info.id, { score: s, cand });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.cand.name.localeCompare(b.cand.name)).map((b) => b.cand);
}

function teamOf(data: ChainData, typeKey: string, companyId: string | null, name: string, website: string | null) {
  const def = getSupplierType(typeKey);
  const role = def?.role ?? "distributor";
  if (!companyId) return { found: 0, total: slotDefs(role).length };
  const team = buildTeam(role, name, data.peopleByCompany.get(companyId) ?? [], { confirmedPersonIds: data.confirmedPersonIds, website });
  return { found: team.filter((s) => s.person).length, total: team.length };
}

function makeNode(
  data: ChainData,
  root: ChainRoot,
  args: { nodeId: string; tier: ChainTier; parentNodeId: string; typeKey: string; supplies: string; found: Found | null; candidates: ChainCandidate[]; expandable: boolean },
): ChainNode {
  const { found } = args;
  const info = found ? data.companies.get(found.companyId) : undefined;
  const def: SupplierTypeDef | undefined = getSupplierType(args.typeKey);
  const extraMakes = found ? data.capabilities.filter((c) => c.companyId === found.companyId && c.itemId && c.supplierType === args.typeKey).map((c) => c.itemId!) : [];
  const buys = wouldBuyFor(args.typeKey, { triggerDate: root.triggerDate, projectType: root.projectType, companyName: info?.name ?? null, extraMakes });
  const team = teamOf(data, args.typeKey, info?.id ?? null, info?.name ?? def?.label ?? args.typeKey, info?.website ?? null);
  const leadId = info?.leadId ?? null;
  return {
    nodeId: args.nodeId,
    tier: args.tier,
    parentNodeId: args.parentNodeId,
    companyId: info?.id ?? null,
    leadId,
    derivedKey: info && !leadId ? derivedKeyOf(root.leadId, info.id, args.typeKey, args.tier) : null,
    name: info?.name ?? labelOfType(args.typeKey),
    whatTheyDo: labelOfType(args.typeKey),
    supplies: args.supplies,
    link: found?.link ?? "not_identified",
    linkWhy: found?.why ?? (args.candidates.length ? `${args.candidates.length} possible compan${args.candidates.length === 1 ? "y" : "ies"} in the directory` : "Not identified yet — find candidates"),
    linkSource: found?.source ?? null,
    evidenceIds: found?.evidenceIds ?? [],
    wouldBuy: buys.wouldBuy,
    competitorFor: buys.competitorFor,
    found: team.found,
    total: team.total,
    candidates: args.candidates,
    expandable: args.expandable,
  };
}

/** Key of a derived buyer: `<root lead>.<company>.<type>.<tier>` (POST /api/mvp/buyers/derive). */
export function derivedKeyOf(rootLeadId: string, companyId: string, typeKey: string, tier: ChainTier): string {
  return `${rootLeadId}.${companyId}.${typeKey}.${tier}`;
}

export function parseDerivedKey(key: string): { rootLeadId: string; companyId: string; typeKey: string; tier: ChainTier } | null {
  const m = key.match(/^([0-9a-f-]{36})\.([0-9a-f-]{36})\.([a-z_]{2,40})\.([23])$/i);
  if (!m || !getSupplierType(m[3])) return null;
  return { rootLeadId: m[1], companyId: m[2], typeKey: m[3], tier: Number(m[4]) as ChainTier };
}

/** Children of one node (supplier types it buys from), with identified companies and candidates. */
function childrenOf(
  data: ChainData,
  root: ChainRoot,
  parent: { nodeId: string; tier: ChainTier; typeKey: string; companyId: string | null; name: string },
  ancestors: ReadonlySet<string>,
): { nodes: ChainNode[]; edges: number } {
  const tier = (parent.tier + 1) as ChainTier;
  const edges = edgesOf(parent.typeKey, root.projectType);
  const wanted = edges.map((e) => e.type);
  const prefix = tier === 2 ? "t2:" : `t3:${parent.nodeId.replace(/^t2:/, "")}:`;
  const ancestorGroups = new Set([...ancestors].map((id) => groupOf(data, id)));
  const related = parent.companyId
    ? relatedCompanies(data, parent.companyId, root.projectId, wanted, wanted[0] ?? "stockist", parent.name).filter((f) => !ancestors.has(f.companyId) && !ancestorGroups.has(groupOf(data, f.companyId)))
    : [];
  const removedByType = new Map<string, Set<string>>();
  if (parent.companyId)
    for (const m of manualFor(data, parent.companyId).values()) if (m.action === "removed") (removedByType.get(m.supplierType) ?? removedByType.set(m.supplierType, new Set()).get(m.supplierType)!).add(m.companyId);
  const used = new Set<string>(ancestors);
  for (const f of related) used.add(f.companyId);
  const countries = [root.siteCountry, root.country, parent.companyId ? (data.companies.get(parent.companyId)?.country ?? null) : null];
  const nodes: ChainNode[] = [];
  const allTypes = [...edges];
  for (const f of related) if (!allTypes.some((e) => e.type === f.typeKey)) allTypes.push({ type: f.typeKey, supplies: getSupplierType(f.typeKey)?.does ?? "" });
  for (const edge of allTypes) {
    const mine = related.filter((f) => f.typeKey === edge.type).sort((a, b) => RANK[a.link] - RANK[b.link]).slice(0, MAX_IDENTIFIED_PER_TYPE);
    const childEdges = tier < 3 && edgesOf(edge.type, root.projectType).length > 0;
    if (mine.length) {
      mine.forEach((f, i) => nodes.push(makeNode(data, root, { nodeId: `${prefix}${edge.type}${i ? `:${i + 1}` : ""}`, tier, parentNodeId: parent.nodeId, typeKey: edge.type, supplies: edge.supplies, found: f, candidates: [], expandable: childEdges })));
      continue;
    }
    const cands = candidatesFor(data, edge.type, countries, used, removedByType.get(edge.type) ?? new Set());
    const top = cands[0] ?? null;
    if (top) used.add(top.companyId);
    const found: Found | null = top ? { companyId: top.companyId, typeKey: edge.type, link: "possible", source: "directory", why: top.why, evidenceIds: [] } : null;
    nodes.push(makeNode(data, root, { nodeId: `${prefix}${edge.type}`, tier, parentNodeId: parent.nodeId, typeKey: edge.type, supplies: edge.supplies, found, candidates: cands.slice(top ? 1 : 0, (top ? 1 : 0) + MAX_CANDIDATES), expandable: childEdges }));
  }
  return { nodes, edges: edges.length };
}

/** Build the supply chain of one tier-1 buyer (max depth 3). */
export function buildSupplyChain(root: ChainRoot, data: ChainData, opts: ChainOptions = {}): SupplyChain {
  const rootInfo = data.companies.get(root.companyId);
  const tier1: ChainNode = {
    nodeId: "t1",
    tier: 1,
    parentNodeId: null,
    companyId: root.companyId,
    leadId: root.leadId,
    derivedKey: null,
    name: root.name,
    whatTheyDo: labelOfType(root.typeKey),
    supplies: "",
    link: "confirmed",
    linkWhy: "Won the work",
    linkSource: "source",
    evidenceIds: root.view.buyingReasonEvidenceIds,
    wouldBuy: root.view.sellItems.filter((i) => i.fit !== "competitor"),
    competitorFor: root.view.sellItems.filter((i) => i.fit === "competitor").map((i) => shortItemName(i.itemId)),
    found: root.view.found,
    total: root.view.total,
    candidates: [],
    expandable: false,
  };
  const nodes: ChainNode[] = [tier1];
  const tier2 = childrenOf(data, root, { nodeId: "t1", tier: 1, typeKey: root.typeKey, companyId: root.companyId, name: rootInfo?.name ?? root.name }, new Set([root.companyId]));
  for (const node of tier2.nodes) {
    nodes.push(node);
    const expand = opts.expand === "all" || (Array.isArray(opts.expand) ? opts.expand.includes(node.nodeId) : node.companyId !== null);
    if (!node.expandable || !expand) continue;
    const ancestors = new Set([root.companyId, ...(node.companyId ? [node.companyId] : [])]);
    const typeKey = node.whatTheyDo ? keyOfLabel(node.whatTheyDo) : null;
    if (!typeKey) continue;
    const tier3 = childrenOf(data, root, { nodeId: node.nodeId, tier: 2, typeKey, companyId: node.companyId, name: node.name }, ancestors);
    node.expandable = false;
    nodes.push(...tier3.nodes.map((n) => ({ ...n, expandable: false })));
  }
  const peopleTotal = nodes.reduce((sum, n) => sum + n.total, 0);
  const peopleFound = nodes.reduce((sum, n) => sum + n.found, 0);
  return { rootLeadId: root.leadId, rootCompanyId: root.companyId, nodes, peopleTotal, peopleFound };
}

/** Supplier-type key of a node (by its plain-words label). */
export function keyOfLabel(label: string): string | null {
  for (const [key, def] of Object.entries(getSupplyMap().types)) if (def.label === label) return key;
  return null;
}

/** The supplier-type key of a node. */
export function nodeTypeKey(node: Pick<ChainNode, "whatTheyDo">): string | null {
  return keyOfLabel(node.whatTheyDo);
}

// ───────────────────────── contacts across the chain (15 §E) ─────────────────────────

const google = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

/** Every node × buying-team slot, across tiers. */
export function chainContacts(chain: SupplyChain, data: ChainData, root: ChainRoot): ChainContactRow[] {
  const rows: ChainContactRow[] = [];
  for (const node of chain.nodes) {
    const typeKey = node.tier === 1 ? root.typeKey : nodeTypeKey(node);
    const def = typeKey ? getSupplierType(typeKey) : undefined;
    const role = node.tier === 1 ? root.view.role : (def?.role ?? "distributor");
    const buysText = node.wouldBuy.slice(0, 3).map((i) => shortItemName(i.itemId)).join(", ");
    if (node.companyId) {
      const info = data.companies.get(node.companyId);
      const team =
        node.tier === 1
          ? root.view.team
          : buildTeam(role, node.name, data.peopleByCompany.get(node.companyId) ?? [], { confirmedPersonIds: data.confirmedPersonIds, website: info?.website ?? null });
      for (const slot of team) {
        const cp = slot.person ? data.contactPoints.get(slot.person.id) : undefined;
        rows.push({
          tier: node.tier,
          nodeId: node.nodeId,
          companyId: node.companyId,
          companyName: node.name,
          companyIdentified: true,
          slotId: slot.slotId,
          role: slot.role,
          title: slot.title,
          why: node.tier > 1 && (slot.role === "decision_maker" || slot.role === "buyer") && buysText ? `Buys ${buysText}` : slot.description,
          person: slot.person
            ? { id: slot.person.id, name: slot.person.name, title: slot.person.title ?? "", email: cp?.email ?? null, phone: cp?.phone ?? null, linkedinUrl: cp?.linkedinUrl ?? null, evidenceIds: slot.person.evidenceIds }
            : null,
          status: slot.status,
          findLinks: slot.findLinks,
        });
      }
    } else {
      const where = countryName(root.siteCountry ?? root.country);
      for (const def2 of slotDefs(role, node.name)) {
        rows.push({
          tier: node.tier,
          nodeId: node.nodeId,
          companyId: null,
          companyName: node.name,
          companyIdentified: false,
          slotId: def2.slotId,
          role: def2.role,
          title: def2.title,
          why: (def2.role === "decision_maker" || def2.role === "buyer") && buysText ? `Buys ${buysText}` : def2.description,
          person: null,
          status: "company_first",
          findLinks: [
            { label: "Find candidates", url: google(`${node.whatTheyDo} ${node.supplies} ${where ?? ""}`.trim()) },
            ...node.candidates.slice(0, 2).map((c) => findLinks(c.name, def2)[0]).filter(Boolean),
          ],
        });
      }
    }
  }
  return rows;
}
