// @vitest-environment node
/**
 * Supply-chain explorer (docs/mvp/15): plain-words roles, consultants and wholesalers, one row per
 * company, the tree (tiers, link statuses, candidates, manual links), derived buyers in search and
 * contacts across the chain. Pure — no database.
 */
import { describe, expect, it } from "vitest";
import { getSupplyMap } from "@/mvp/config/supply-map";
import { getDirectorySeed } from "@/mvp/config/supply-map";
import { resolveBuyerRole } from "./roles";
import { searchContactRecords, searchRecords } from "./search";
import { buildSupplyChain, chainContacts, type ChainData, type ChainRoot } from "./supply-tree";
import { derivedRecords, rootOf } from "./chain-db";
import { buildBuyerView, type BuyerInput, type BuyerRecord } from "./view";
import { BANNED_LABEL_RE, isConsultant, isWholesaler, supplierTypeKeyFor } from "./what-they-do";

const NOW = new Date("2026-10-15T09:00:00Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KPIL = U(10);
const WELSPUN = U(12);
const VALVECO = U(13);
const STOCKIST = U(14);
const STEELMILL = U(15);
const GULFSTOCK = U(16);
const PROJECT = U(20);

function kpilInput(over: { lead?: Partial<BuyerInput["lead"]>; buyer?: Partial<BuyerInput["buyer"]> } = {}): BuyerInput {
  return {
    now: NOW,
    lead: {
      id: U(1), kind: "supply_subcontract", buyer_company_id: KPIL, class: "research", status: "new", score: 64, confidence_band: "high",
      reasons: [], closing_date: null, is_sample: false, created_at: "2026-09-23T00:00:00Z", updated_at: null, client_product_ids: [],
      tender_ref: null, project_id: PROJECT, package_id: null, buyer_type: "epc_contractor", signal_ids: [U(30)],
      ...over.lead,
    },
    buyer: { id: KPIL, canonical_name: "Kalpataru Projects International Limited (KPIL)", country: "IN", types: ["main_epc"], domain: null, parent_company_id: null, listed_exchange: null, ...over.buyer },
    parent: null,
    project: { id: PROJECT, name: "Gas pipeline project", owner_company_id: U(11), country: "IN", site: "Gujarat", sector: "oil_gas", project_type: "pipeline", estimated_value: 40e9, currency: "INR", value_usd: 480e6, specs: {} },
    owner: { id: U(11), canonical_name: "GAIL (India) Ltd", country: "IN", types: ["owner"] },
    packages: [{ id: U(40), discipline: "pipeline", name: "Gas pipeline", scope_text: null, needed_by: null, procurement_route: null }],
    requirements: [],
    parties: [
      { id: U(50), company_id: KPIL, role: "main_epc", package_id: U(40), scope_text: null, contract_value: 40e9, currency: "INR", value_usd: 480e6, award_date: "2026-09-10", companyName: "Kalpataru Projects International Limited (KPIL)" },
    ],
    signals: [{ id: U(30), type: "contract_awarded", signal_date: "2026-09-10", company_id: KPIL, summary: "KPIL won a gas pipeline contract", evidence_ids: [U(60)] }],
    people: [],
    peopleByCompany: new Map(),
    evidence: {
      [U(60)]: { id: U(60), quote: "KPIL wins gas pipeline contract", sentence: "KPIL wins gas pipeline contract worth INR 40 billion.", url: "https://example.com/kpil", source: "Example News", publishedAt: "2026-09-10T00:00:00Z", verified: true },
    },
    buyerEvidenceIds: [U(60)],
    confirmedPersonIds: new Set(),
  };
}

function data(over: Partial<ChainData> = {}): ChainData {
  const company = (id: string, name: string, country: string | null, typeKeys: string[] = [], leadId: string | null = null) => [id, { id, name, country, typeKeys, leadId, website: null }] as const;
  return {
    companies: new Map([
      company(KPIL, "Kalpataru Projects International Limited (KPIL)", "IN", ["pipeline_builder"], U(1)),
      company(WELSPUN, "Welspun Corp", "IN", ["pipe_maker"]),
      company(VALVECO, "Bharat Valve Works", "IN", ["valve_maker"]),
      company(STOCKIST, "Mumbai Pipe Stockists", "IN"),
      company(STEELMILL, "JSW Steel", "IN"),
      company(GULFSTOCK, "Gulf Stockist LLC", "AE"),
    ]),
    relations: [
      { buyerId: KPIL, supplierId: WELSPUN, kind: "supply", projectId: PROJECT, date: "2026-09-20", evidenceIds: [U(61)] },
      { buyerId: KPIL, supplierId: VALVECO, kind: "supply", projectId: U(21), date: "2025-03-01", evidenceIds: [U(62)] },
    ],
    capabilities: [
      { companyId: STOCKIST, supplierType: "stockist", itemId: null, country: "IN", source: "observed", url: null },
      { companyId: GULFSTOCK, supplierType: "stockist", itemId: null, country: "AE", source: "observed", url: null },
      { companyId: STEELMILL, supplierType: "steel_mill", itemId: "plates", country: "IN", source: "seed", url: "https://example.com/jsw" },
    ],
    manual: [],
    peopleByCompany: new Map(),
    confirmedPersonIds: new Set(),
    contactPoints: new Map(),
    ...over,
  };
}

const kpil = buildBuyerView(kpilInput());
const root: ChainRoot = rootOf(kpil);

describe("buyer-first wording (15 §A)", () => {
  it("shows what they do in plain words, never EPC / owner", () => {
    expect(kpil.view.whatTheyDo).toBe("Pipeline builder");
    expect(kpil.view.roleLabel).toBe("Pipeline builder");
    expect(kpil.row.whatTheyDo).toBe("Pipeline builder");
    for (const text of [kpil.view.headline, kpil.view.buyingReason, kpil.view.roleLabel, kpil.row.buyingReason, kpil.row.sellSummary])
      expect(text).not.toMatch(BANNED_LABEL_RE);
    expect(kpil.view.tier).toBe(1);
    expect(kpil.view.foundVia).toBeNull();
    expect(kpil.view.deals[0]).toMatchObject({ leadId: U(1), date: "2026-09-10", valueUsd: 480e6, sourceCount: 1 });
  });

  it("an open tender of a municipality reads 'Municipality · open tender'", () => {
    const rec = buildBuyerView({
      ...kpilInput({ lead: { kind: "bid", buyer_type: "owner" }, buyer: { canonical_name: "Trondheim kommune", country: "NO", types: ["owner"] } }),
      owner: null,
      parties: [],
      signals: [{ id: U(30), type: "tender_released", signal_date: "2026-09-10", company_id: KPIL, summary: "Tender for water pipes", evidence_ids: [] }],
    });
    expect(rec.view.whatTheyDo).toBe("Municipality · open tender");
    expect(rec.view.buyingReason).not.toMatch(BANNED_LABEL_RE);
    expect(rec.view.buyingReason).not.toMatch(/\bowner\b/i);
  });

  it("a consultant is not a buyer (15 §A4)", () => {
    expect(isConsultant("Norconsult AS")).toBe(true);
    expect(isConsultant("Sweco rådgivende ingeniører")).toBe(true);
    expect(isConsultant("Kalpataru Projects")).toBe(false);
    const rec = buildBuyerView(kpilInput({ lead: { buyer_type: "owner", kind: "bid" }, buyer: { canonical_name: "Norconsult", country: "NO", types: ["owner"] } }));
    expect(rec.view.stage).toBe("not_buyer");
    expect(rec.row.buyingReason).toBe("Consultant — specifies, does not buy");
    expect(searchRecords([rec], {}, NOW).total).toBe(0);
  });

  it("a wholesaler is a stockist, never a builder (15 §A5)", () => {
    expect(isWholesaler("Brødrene Dahl A/S")).toBe(true);
    expect(isWholesaler("Nordic VVS-grossist AS")).toBe(true);
    expect(isWholesaler("Acme", "VVS-grossisten Acme leverer rør")).toBe(true);
    expect(isWholesaler("City Gas Distribution Ltd")).toBe(false);
    expect(resolveBuyerRole("epc_contractor", "Brødrene Dahl A/s", [], "")).toBe("distributor");
    const rec = buildBuyerView(kpilInput({ buyer: { canonical_name: "Brødrene Dahl A/s", country: "NO" } }));
    expect(rec.view.role).toBe("distributor");
    expect(rec.view.whatTheyDo).toBe("Stockist");
    expect(supplierTypeKeyFor("subcontractor", "piping", { name: "X HDD", text: "horizontal directional drilling crossings" })).toBe("crossing_contractor");
  });

  it("groups leads of one company into one row with its deals (15 §A3)", () => {
    const second = buildBuyerView(kpilInput({ lead: { id: U(2), score: 50, project_id: U(21), signal_ids: [] } }));
    const res = searchRecords([kpil, second], {}, NOW);
    expect(res.total).toBe(1);
    expect(res.rows[0].leadId).toBe(U(1));
    expect(res.rows[0].dealsCount).toBe(2);
    const contacts = searchContactRecords([kpil, second], {}, NOW);
    expect(new Set(contacts.rows.map((r) => r.leadId))).toEqual(new Set([U(1)]));
  });
});

describe("supply map (15 §B)", () => {
  it("covers the minimum types and the seed cites websites", () => {
    const map = getSupplyMap();
    expect(map.buysFrom.pipeline_builder.map((e) => e.type)).toEqual(["pipe_maker", "valve_maker", "fittings_maker", "coating_company", "crossing_contractor", "stockist", "civil_contractor"]);
    expect(map.buysFrom.pipe_maker.map((e) => e.type)).toEqual(["steel_mill", "coating_powder_supplier", "welding_consumables_maker", "testing_lab"]);
    for (const seed of getDirectorySeed()) expect(seed.url).toMatch(/^https:\/\//);
  });
});

describe("supply-chain tree (15 §B)", () => {
  const chain = buildSupplyChain(root, data());
  const byId = new Map(chain.nodes.map((n) => [n.nodeId, n]));

  it("a pipeline builder has one tier-2 node per supply-map type", () => {
    expect(chain.nodes[0]).toMatchObject({ nodeId: "t1", tier: 1, whatTheyDo: "Pipeline builder", link: "confirmed" });
    const tier2 = chain.nodes.filter((n) => n.tier === 2);
    expect(tier2.map((n) => n.whatTheyDo)).toEqual(["Pipe maker", "Valve maker", "Bends/fittings maker", "Coating company", "Drilling/crossing contractor", "Stockist", "Civil contractor"]);
    expect(tier2.every((n) => n.parentNodeId === "t1")).toBe(true);
  });

  it("link statuses: confirmed from a supply sentence, likely from history, possible from the directory", () => {
    expect(byId.get("t2:pipe_maker")).toMatchObject({ name: "Welspun Corp", link: "confirmed", linkSource: "source", evidenceIds: [U(61)], leadId: null });
    expect(byId.get("t2:pipe_maker")!.derivedKey).toBe(`${U(1)}.${WELSPUN}.pipe_maker.2`);
    expect(byId.get("t2:valve_maker")).toMatchObject({ name: "Bharat Valve Works", link: "likely", linkSource: "history" });
    expect(byId.get("t2:valve_maker")!.linkWhy).toMatch(/Worked with .* before/);
    const stockist = byId.get("t2:stockist")!;
    expect(stockist).toMatchObject({ name: "Mumbai Pipe Stockists", link: "possible", linkSource: "directory" });
    expect(stockist.linkWhy).toMatch(/in India/);
    // The UAE stockist is in another region, so it is not proposed for an Indian deal.
    expect(stockist.candidates.map((c) => c.name)).not.toContain("Gulf Stockist LLC");
    expect(byId.get("t2:coating_company")).toMatchObject({ companyId: null, link: "not_identified", name: "Coating company" });
  });

  it("a pipe maker has tier-3 suppliers; the seed steel mill is possible", () => {
    const tier3 = chain.nodes.filter((n) => n.parentNodeId === "t2:pipe_maker");
    expect(tier3.map((n) => n.whatTheyDo)).toEqual(["Steel plate/coil mill", "Coating materials supplier", "Welding consumables maker", "Testing lab"]);
    expect(tier3.every((n) => n.tier === 3 && !n.expandable)).toBe(true);
    expect(tier3[0]).toMatchObject({ name: "JSW Steel", link: "possible" });
    expect(tier3[0].wouldBuy).toEqual([]); // not in the catalogue
    expect(tier3[1].competitorFor.length).toBeGreaterThan(0);
    // Unidentified tier-2 nodes are expandable on demand.
    expect(byId.get("t2:coating_company")!.expandable).toBe(true);
    const expanded = buildSupplyChain(root, data(), { expand: ["t2:coating_company"] });
    expect(expanded.nodes.some((n) => n.parentNodeId === "t2:coating_company")).toBe(true);
  });

  it("would-buy comes from the needs map and competitor check", () => {
    const pipeMaker = byId.get("t2:pipe_maker")!;
    expect(pipeMaker.wouldBuy.map((i) => i.itemId)).toEqual(expect.arrayContaining(["coating-materials", "welding-consumables"]));
    expect(pipeMaker.wouldBuy.map((i) => i.itemId)).not.toContain("line-pipe");
    expect(pipeMaker.competitorFor).toContain("line pipe");
    expect(chain.peopleTotal).toBe(chain.nodes.reduce((s, n) => s + n.total, 0));
  });

  it("a user can set the company (confirmed, your team) and remove a wrong one", () => {
    const manual = buildSupplyChain(root, data({ manual: [{ parentCompanyId: KPIL, supplierType: "coating_company", companyId: GULFSTOCK, action: "set", at: "2026-10-01T00:00:00Z" }] }));
    const coating = manual.nodes.find((n) => n.nodeId === "t2:coating_company")!;
    expect(coating).toMatchObject({ companyId: GULFSTOCK, link: "confirmed", linkSource: "user", linkWhy: "Set by your team" });
    const removed = buildSupplyChain(root, data({ manual: [{ parentCompanyId: KPIL, supplierType: "pipe_maker", companyId: WELSPUN, action: "removed", at: "2026-10-01T00:00:00Z" }] }));
    expect(removed.nodes.find((n) => n.nodeId === "t2:pipe_maker")!.companyId).not.toBe(WELSPUN);
  });

  it("contacts across the chain: slots per node, company first when unidentified", () => {
    const rows = chainContacts(chain, data(), root);
    expect(rows.filter((r) => r.tier === 1).length).toBe(kpil.view.total);
    const coating = rows.filter((r) => r.nodeId === "t2:coating_company");
    expect(coating.length).toBeGreaterThan(0);
    expect(coating.every((r) => r.status === "company_first" && !r.companyIdentified && r.person === null)).toBe(true);
    expect(coating[0].findLinks[0].label).toBe("Find candidates");
    const welspun = rows.filter((r) => r.companyId === WELSPUN);
    expect(welspun.every((r) => r.status === "not_found")).toBe(true);
    expect(welspun.find((r) => r.role === "decision_maker")!.why).toMatch(/^Buys /);
    expect(rows.length).toBe(chain.peopleTotal);
  });
});

describe("derived buyers in SuperSearch (15 §D)", () => {
  const derived = derivedRecords([kpil], data());
  const all: BuyerRecord[] = [kpil, ...derived];

  it("identified tier-2/3 companies become buyers with tier and found-via", () => {
    const welspun = derived.find((r) => r.view.companyId === WELSPUN)!;
    expect(welspun.row).toMatchObject({ tier: 2, storedLeadId: null, link: "confirmed", foundVia: { leadId: U(1), name: kpil.view.name }, whatTheyDo: "Pipe maker" });
    expect(welspun.row.leadId).toBe(`derived:${welspun.row.derivedKey}`);
    expect(derived.find((r) => r.view.companyId === STEELMILL)!.row.tier).toBe(3);
    for (const r of derived) expect(`${r.row.buyingReason} ${r.view.headline}`).not.toMatch(BANNED_LABEL_RE);
  });

  it("filters by tier and how we know", () => {
    const tier1 = searchRecords(all, { tiers: [1] }, NOW);
    expect(tier1.rows.map((r) => r.leadId)).toEqual([U(1)]);
    const tier2 = searchRecords(all, { tiers: [2] }, NOW);
    expect(tier2.rows.every((r) => r.tier === 2)).toBe(true);
    const likely = searchRecords(all, { linkStatus: ["likely"] }, NOW);
    expect(likely.rows.map((r) => r.name)).toEqual(["Bharat Valve Works"]);
    const everything = searchRecords(all, {}, NOW);
    expect(everything.facets.tiers?.map((f) => f.value).sort()).toEqual(["1", "2", "3"]);
    expect(everything.facets.linkStatus?.find((f) => f.value === "possible")?.count).toBeGreaterThan(0);
  });

  it("the Contacts switch lists slots of tier-1 and derived buyers", () => {
    const contacts = searchContactRecords(all, {}, NOW);
    expect(contacts.total).toBeGreaterThan(kpil.view.total);
    expect(contacts.rows.some((r) => r.tier === 2 && r.derivedKey)).toBe(true);
  });
});
