// @vitest-environment node
/**
 * Buyers (docs/mvp/14): roles, needs map, competitor check, why-you, buying window, buying-team
 * slots, chain, headline, search — and the §11 data fixes (merge rules, place names).
 */
import { describe, expect, it } from "vitest";
import { companyKeys } from "@/mvp/pipeline/text";
import { isImplausibleValue, isPlaceName, sameCompanyVariant, sameOrder, toUsd } from "@/mvp/pipeline/merge";
import { getCatalogue, getNeedsMap, getStrengths } from "@/mvp/config/buyers-config";
import { findKnownCompany, resolveBuyerRole, supplierRoleFor } from "./roles";
import { competitorItems, pickNeedsRule, sellItemsFor } from "./needs";
import { whyYouFor, type WhyYouFacts } from "./why-you";
import { stepState, windowSteps } from "./window";
import { buildTeam } from "./team";
import { buildBuyerView, stageFromClass, type BuyerInput } from "./view";
import { searchContactRecords, searchRecords } from "./search";
import { parseBuyerSearch } from "./schema";

const NOW = new Date("2026-10-15T09:00:00Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function input(over: Partial<Omit<BuyerInput, "lead">> & { lead?: Partial<BuyerInput["lead"]> } = {}): BuyerInput {
  const { lead, ...rest } = over;
  return {
    now: NOW,
    lead: {
      id: U(1), kind: "supply_subcontract", buyer_company_id: U(10), class: "research", status: "new", score: 57, confidence_band: "medium",
      reasons: [], closing_date: null, is_sample: false, created_at: "2026-09-23T00:00:00Z", updated_at: null, client_product_ids: [],
      tender_ref: null, project_id: U(20), package_id: null, buyer_type: "manufacturer", signal_ids: [U(30)],
      ...lead,
    },
    buyer: { id: U(10), canonical_name: "East Pipes Integrated Company for Industry (EPIC)", country: "SA", types: ["manufacturer"], domain: null, parent_company_id: null, listed_exchange: null },
    parent: null,
    project: { id: U(20), name: "Aramco steel pipe order (Sep 2026)", owner_company_id: U(11), country: "SA", site: null, sector: "oil_gas", project_type: null, estimated_value: 771e6, currency: "SAR", value_usd: 205.6e6, specs: {} },
    owner: { id: U(11), canonical_name: "Saudi Arabian Oil Co. (Saudi Aramco)", country: "SA", types: ["owner"] },
    packages: [{ id: U(40), discipline: "pipeline", name: "Steel pipe supply", scope_text: null, needed_by: null, procurement_route: null }],
    requirements: [],
    parties: [
      { id: U(50), company_id: U(10), role: "supplier", package_id: U(40), scope_text: null, contract_value: 771e6, currency: "SAR", value_usd: 205.6e6, award_date: "2026-09-22", companyName: "East Pipes Integrated Company for Industry (EPIC)" },
      { id: U(51), company_id: U(11), role: "owner", package_id: null, scope_text: null, contract_value: null, currency: null, value_usd: null, award_date: null, companyName: "Saudi Arabian Oil Co. (Saudi Aramco)" },
    ],
    signals: [{ id: U(30), type: "contract_awarded", signal_date: "2026-09-22", company_id: U(10), summary: "East Pipes won a steel pipe order from Saudi Aramco", evidence_ids: [U(60)] }],
    people: [{ id: U(70), name: "Mohammed Darweesh", title: "Acting CEO", evidenceIds: [U(61)] }],
    peopleByCompany: new Map(),
    evidence: {
      [U(60)]: { id: U(60), quote: "signed by East Pipes Integrated Company for Industry", sentence: "The Welspun Aramco order is a steel-pipe manufacturing and supply contract signed by East Pipes Integrated Company for Industry, or EPIC, with Saudi Arabian Oil Co., to be delivered within 6 months.", url: "https://example.com/a", source: "Example News", publishedAt: "2026-09-22T00:00:00Z", verified: true },
      [U(61)]: { id: U(61), quote: "Mohammed Darweesh, Acting CEO", sentence: "Mohammed Darweesh, Acting CEO of EPIC, said the order will be delivered within 6 months.", url: "https://example.com/a", source: "Example News", publishedAt: "2026-09-22T00:00:00Z", verified: true },
    },
    buyerEvidenceIds: [U(60)],
    confirmedPersonIds: new Set(),
    ...rest,
  };
}

describe("config", () => {
  it("catalogue, strengths and needs map are examples and consistent", () => {
    expect(getCatalogue().isExample).toBe(true);
    expect(getCatalogue().items.length).toBe(35);
    expect(getStrengths().strengths.map((s) => s.id)).toEqual(["stock-hubs", "fast-delivery", "one-stop", "certified", "approved-vendor", "local-content", "delivery-to-site"]);
    expect(() => getNeedsMap()).not.toThrow();
  });
});

describe("buyer roles (14 §2)", () => {
  it("maps the old supplier to manufacturer when it makes things, else distributor", () => {
    expect(supplierRoleFor("Acme Trading LLC", [], "supplied valves from stock")).toBe("distributor");
    expect(supplierRoleFor("Gulf Spools Fabrication", [], "")).toBe("fabricator");
    expect(supplierRoleFor("Man Industries", [], "pipe mill in Anjar")).toBe("manufacturer");
    expect(supplierRoleFor("East Pipes", [], "")).toBe("manufacturer");
    expect(resolveBuyerRole("supplier", "Nordic Supply AS", [], "")).toBe("distributor");
    expect(resolveBuyerRole("epc_contractor", "X", [], "")).toBe("epc_contractor");
  });

  it("stage comes from the class", () => {
    expect([stageFromClass("genuine"), stageFromClass("research"), stageFromClass("watch"), stageFromClass("rejected")]).toEqual(["ready", "check", "early", "not_buyer"]);
  });
});

describe("EPIC — a pipe mill that won a pipe order (14 §5, §6)", () => {
  const record = buildBuyerView(input());
  const view = record.view;
  const fit = (id: string) => view.sellItems.find((i) => i.itemId === id)?.fit;

  it("is a manufacturer / pipe mill that buys coating materials, welding consumables and plates", () => {
    expect(view.role).toBe("manufacturer");
    expect(view.subRoleLabel).toBe("Pipe mill");
    expect(fit("coating-materials")).toBe("good");
    expect(fit("welding-consumables")).toBe("good");
    expect(fit("plates")).toBe("good");
  });

  it("is a competitor for line pipe, hidden from the sell summary", () => {
    expect(fit("line-pipe")).toBe("competitor");
    expect(view.competitorFor).toContain("line-pipe");
    expect(record.row.sellSummary.toLowerCase()).not.toContain("line pipe");
    expect(record.row.competitorNote).toMatch(/Makes line pipe — competitor for pipe/);
  });

  it("known companies give the parent group; the chain shows owner, missing EPC and parent", () => {
    const roles = view.chain.map((c) => `${c.role}:${c.identified}`);
    expect(roles).toContain("owner:true");
    expect(roles).toContain("epc_contractor:false");
    expect(view.chain.find((c) => c.role === "parent_group")?.name).toBe("Welspun Corp");
  });

  it("reason, window, why-you, team, reach, proof and headline", () => {
    expect(view.buyingReason).toMatch(/^EPIC won a SAR 771M \(≈ USD 206M\) pipe order from Saudi Aramco, to deliver within 6 months\. To make and deliver it/);
    expect(record.row.buyingReason).toBe("Won Aramco pipe order · SAR 771M · Sep 2026");
    expect(view.window.map((s) => `${s.label}:${s.state}`)).toEqual(["Order won:done", "Materials & consumables:now", "Coating & testing:next", "Delivery:next"]);
    expect(view.whyYou.map((w) => w.strengthId)).toContain("stock-hubs");
    expect(view.whyYou[0].reason).toBe("Stock in Dammam — the buyer is in Saudi Arabia");
    expect(view.whyYou.every((w) => w.isExample)).toBe(true);
    expect(view.whyYou.length).toBeLessThanOrEqual(3);
    expect(view.found).toBe(1);
    expect(view.total).toBe(6);
    expect(view.team.find((s) => s.slotId === "ceo-md")?.person?.name).toBe("Mohammed Darweesh");
    expect(view.reach.country).toBe("SA");
    expect(view.proof[0].sentence).toMatch(/^The Welspun Aramco order is a steel-pipe/);
    expect(view.proof[0].highlight).toBe("signed by East Pipes Integrated Company for Industry");
    expect(view.headline).toMatch(/^EPIC \(Manufacturer, Saudi Arabia\) will likely buy steel plates, welding consumables and coating materials in .+ for its SAR 771M pipe order from Aramco\. Why you: Stock in Dammam/);
  });
});

describe("EPC pipeline contractor (Desco-like)", () => {
  const record = buildBuyerView(
    input({
      lead: { buyer_type: "epc_contractor", class: "genuine", buyer_company_id: U(12), signal_ids: [U(31)] },
      buyer: { id: U(12), canonical_name: "Desco Infratech", country: "IN", types: ["main_epc"], domain: null, parent_company_id: null, listed_exchange: null },
      project: { id: U(21), name: "Adani Total Gas pipeline EPC", owner_company_id: U(13), country: "IN", site: null, sector: "oil_gas", project_type: "pipeline", estimated_value: null, currency: null, value_usd: null, specs: {} },
      owner: { id: U(13), canonical_name: "Adani Total Gas", country: "IN", types: ["owner"] },
      parties: [{ id: U(52), company_id: U(12), role: "main_epc", package_id: null, scope_text: null, contract_value: null, currency: null, value_usd: null, award_date: "2026-09-10", companyName: "Desco Infratech" }],
      signals: [{ id: U(31), type: "contract_awarded", signal_date: "2026-09-10", company_id: U(12), summary: "Desco Infratech won a pipeline EPC contract", evidence_ids: [] }],
      people: [],
      buyerEvidenceIds: [],
    }),
  );
  it("will buy line pipe, valves, bends, fittings…; no competitor items", () => {
    const view = record.view;
    expect(view.role).toBe("epc_contractor");
    expect(view.stage).toBe("ready");
    expect(view.subRoleLabel).toBe("Pipeline contractor");
    const ids = view.sellItems.map((i) => i.itemId);
    for (const id of ["line-pipe", "ball-valves", "gate-globe-check", "induction-bends", "bw-fittings", "flanges", "welding-consumables"]) expect(ids).toContain(id);
    expect(view.competitorFor).toEqual([]);
    expect(view.sellItems[0].itemId).toBe("line-pipe");
    expect(view.total).toBe(7);
    expect(view.found).toBe(0);
    expect(view.team[0].findLinks.map((l) => l.url)).toEqual([
      "https://www.google.com/search?q=Desco%20Infratech%20head%20of%20procurement",
      "https://www.linkedin.com/search/results/people/?keywords=Desco%20Infratech%20head%20of%20procurement",
      "https://www.google.com/search?q=Desco%20Infratech%20contact",
    ]);
    expect(view.headline).toMatch(/^Desco Infratech \(EPC contractor, India\) will likely buy line pipe, ball valves and induction bends/);
  });
});

describe("competitor for all products → Not a buyer (14 §6)", () => {
  it("a valve maker whose only rule items are made by it is not a buyer", () => {
    const comp = competitorItems({ role: "manufacturer", situation: "valve_maker", name: "X Valves", text: "", known: null });
    expect([...comp.keys()]).toEqual(expect.arrayContaining(["ball-valves", "gate-globe-check", "butterfly-valves", "control-relief-valves"]));
    const rule = pickNeedsRule("manufacturer", "valve_maker");
    const all = new Map(rule!.groups.flatMap((g) => g.items.map((i) => [i.id, "They make it"] as const)));
    const items = sellItemsFor({ role: "manufacturer", situation: "valve_maker", rule, triggerDate: null, projectType: null, mentioned: new Map(), competitors: all });
    expect(items.every((i) => i.fit === "competitor")).toBe(true);
  });

  it("'manufacturer of …' text marks items", () => {
    const comp = competitorItems({ role: "manufacturer", situation: "equipment_maker", name: "Y", text: "Y is a leading manufacturer of flanges and forged fittings.", known: null });
    expect(comp.has("flanges")).toBe(true);
    expect(comp.has("forged-fittings")).toBe(true);
  });
});

describe("why you (14 §7): only when the condition matches verified facts", () => {
  const base: WhyYouFacts = { buyerCountry: null, siteCountry: null, site: null, deliveryPort: null, deliveryMonths: null, urgent: false, standards: [], ownerName: null, categories: 0, publicTender: false };
  it("shows nothing when nothing is known", () => {
    expect(whyYouFor(base)).toEqual([]);
  });
  it("matches each condition", () => {
    const ids = (f: Partial<WhyYouFacts>) => whyYouFor({ ...base, ...f }, getStrengths(), 10).map((w) => w.strengthId);
    expect(ids({ buyerCountry: "OM" })).toEqual(["stock-hubs", "delivery-to-site"]);
    expect(ids({ deliveryMonths: 6 })).toEqual(["fast-delivery"]);
    expect(ids({ deliveryMonths: 12 })).toEqual([]);
    expect(ids({ categories: 3 })).toEqual(["one-stop"]);
    expect(ids({ categories: 2 })).toEqual([]);
    expect(ids({ standards: ["API 5L"] })).toEqual(["certified"]);
    expect(ids({ ownerName: "Saudi Arabian Oil Co." })).toEqual(["certified", "approved-vendor", "local-content"]);
    expect(ids({ publicTender: true, siteCountry: "IN" })).toEqual(["stock-hubs", "local-content"]);
    expect(ids({ deliveryPort: "Jubail" })).toEqual(["delivery-to-site"]);
    expect(ids({ buyerCountry: "AE" })).toEqual(["stock-hubs"]);
  });
  it("shows at most 3", () => {
    expect(whyYouFor({ ...base, buyerCountry: "SA", deliveryMonths: 3, categories: 5, standards: ["API 5L"] }).length).toBe(3);
  });
});

describe("buying window states (14 §5)", () => {
  it("done / now / next by today", () => {
    expect(stepState("2026-01-01", "2026-02-01", "2026-03-01")).toBe("done");
    expect(stepState("2026-01-01", "2026-04-01", "2026-03-01")).toBe("now");
    expect(stepState("2026-05-01", "2026-06-01", "2026-03-01")).toBe("next");
  });
  it("steps from the trigger date; without a date the first step is now", () => {
    const rule = pickNeedsRule("epc_contractor", "pipeline")!;
    const steps = windowSteps(rule, "2026-09-01", new Date("2026-12-15T00:00:00Z"));
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "now", "now"]);
    expect(steps[1]).toMatchObject({ label: "Long-lead items", from: "2026-09-01" });
    const undated = windowSteps(rule, null, NOW);
    expect(undated.map((s) => s.state)).toEqual(["done", "now", "next", "next"]);
  });
});

describe("buying-team slots (14 §8)", () => {
  it("fills slots by title, specific first, likely / confirmed", () => {
    const team = buildTeam("epc_contractor", "Acme", [
      { id: "p1", name: "A One", title: "Procurement Officer", evidenceIds: [] },
      { id: "p2", name: "B Two", title: "Head of Procurement", evidenceIds: [] },
      { id: "p3", name: "C Three", title: "QA/QC Manager", evidenceIds: [] },
      { id: "p4", name: "D Four", title: "Chief Financial Officer", evidenceIds: [] },
    ], { confirmedPersonIds: new Set(["p2"]) });
    const bySlot = Object.fromEntries(team.map((s) => [s.slotId, s]));
    expect(bySlot["head-procurement"].person?.name).toBe("B Two");
    expect(bySlot["head-procurement"].status).toBe("confirmed");
    expect(bySlot["category-buyer"].person?.name).toBe("A One");
    expect(bySlot["category-buyer"].status).toBe("likely");
    expect(bySlot["qaqc"].person?.name).toBe("C Three");
    expect(bySlot["project-manager"].status).toBe("not_found");
    expect(bySlot["vendor-registration"].findLinks[0].url).toContain("vendor%20registration");
    expect(team.filter((s) => s.person).length).toBe(3);
  });
});

describe("search (14 §9)", () => {
  const epic = buildBuyerView(input());
  const desco = buildBuyerView(
    input({
      lead: { id: U(2), buyer_type: "epc_contractor", class: "genuine", score: 60 },
      buyer: { id: U(12), canonical_name: "Desco Infratech", country: "IN", types: ["main_epc"], domain: null, parent_company_id: null, listed_exchange: null },
      parties: [],
      people: [],
    }),
  );
  const records = [epic, desco];
  it("filters by role, location, sell item (competitors never match) and counts contacts", () => {
    expect(searchRecords(records, { roles: { any: ["manufacturer"] } }, NOW).rows.map((r) => r.name)).toEqual([epic.view.name]);
    expect(searchRecords(records, { location: { any: ["India"] } }, NOW).total).toBe(1);
    expect(searchRecords(records, { location: { not: ["SA"] } }, NOW).rows[0].name).toBe("Desco Infratech");
    expect(searchRecords(records, { sell: { any: ["line-pipe"] } }, NOW).rows.map((r) => r.name)).toEqual(["Desco Infratech"]);
    expect(searchRecords(records, { sell: { any: ["line-pipe"], hideCompetitors: false } }, NOW).total).toBe(2);
    const all = searchRecords(records, {}, NOW);
    expect(all.contactsTotal).toBe(epic.view.total + desco.view.total);
    expect(all.contactsFound).toBe(1);
    expect(all.facets.roles.map((f) => f.value).sort()).toEqual(["epc_contractor", "manufacturer"]);
    expect(searchRecords(records, { sort: "fit" }, NOW).rows[0].name).toBe("Desco Infratech");
  });
  it("contacts rows, found first", () => {
    const res = searchContactRecords(records, { contacts: { departments: ["Management"] } }, NOW);
    expect(res.rows[0].person?.name).toBe("Mohammed Darweesh");
    expect(res.found).toBe(1);
  });
  it("validates the search", () => {
    expect(parseBuyerSearch({ roles: { any: ["manufacturer"] } }).ok).toBe(true);
    expect(parseBuyerSearch({ roles: { any: ["wizard"] } }).ok).toBe(false);
    expect(parseBuyerSearch({ unknown: 1 }).ok).toBe(false);
  });
});

describe("data fixes (14 §11)", () => {
  it("merges one order reported in different currencies", () => {
    const a = { buyerId: "b", ownerId: "o", products: ["pipeline"], awardDate: "2026-09-21", amount: 771e6, currency: "SAR" };
    const b = { buyerId: "b", ownerId: "o", products: ["pipeline"], awardDate: "2026-09-25", amount: 1706e7, currency: "INR" };
    expect(toUsd(771e6, "SAR")).toBe(205600000);
    expect(sameOrder(a, b)).toBe(true);
    expect(sameOrder(a, { ...b, awardDate: "2026-11-30" })).toBe(false);
    expect(sameOrder(a, { ...b, amount: 2500e7 })).toBe(false);
    expect(sameOrder(a, { ...b, ownerId: "other" })).toBe(false);
    expect(sameOrder(a, { ...b, products: ["valves"] })).toBe(false);
  });

  it("merges company name variants", () => {
    expect(sameCompanyVariant("Welspun Corp", "Welspun Corp Associate")).toBe(true);
    expect(sameCompanyVariant("Welspun Corp Unit", "Welspun Corp Ltd")).toBe(true);
    expect(sameCompanyVariant("Welspun Corp", "Jindal SAW")).toBe(false);
    const shared = (x: string, y: string) => companyKeys(x).keys.some((k) => companyKeys(y).keys.includes(k));
    expect(shared("Welspun Corp Associate", "Welspun Corp")).toBe(true);
    expect(shared("Saudi Arabian Oil Co", "Saudi Aramco")).toBe(true);
  });

  it("drops place names and implausible values", () => {
    expect(isPlaceName("Ruwais")).toBe(true);
    expect(isPlaceName("Hafeet", "The plant in Hafeet will open. Work near Hafeet starts soon.")).toBe(true);
    expect(isPlaceName("Hafeet", "Hafeet awarded the contract. The plant in Hafeet will open.")).toBe(false);
    expect(isPlaceName("Hafeet Pipes", "a plant in Hafeet Pipes")).toBe(false);
    expect(isImplausibleValue(25e9)).toBe(true);
    expect(isImplausibleValue(2e9)).toBe(false);
  });
});

describe("integration fixes from the live run", () => {
  it("matches a unit / associate of a known company", () => {
    expect(findKnownCompany("Welspun Corp Unit")?.names[0]).toBe("Welspun Corp");
    expect(findKnownCompany("Welspun Corp Associate")?.names[0]).toBe("Welspun Corp");
    expect(supplierRoleFor("Welspun Corp Unit")).toBe("manufacturer");
  });

  it("does not make an owner a competitor from text about the company that won its order", () => {
    const text = "Arabian Pipes Co. signed a contract with Saudi Aramco for the manufacturing and supply of steel pipes.";
    expect(competitorItems({ role: "owner", situation: "pipeline", name: "Saudi Aramco", text, known: null }).size).toBe(0);
    expect(competitorItems({ role: "epc_contractor", situation: "pipeline", name: "Desco Infratech", text, known: null }).size).toBe(0);
  });

  it("drops street and junction names", () => {
    expect(isPlaceName("Shankar Chowk")).toBe(true);
    expect(isPlaceName("Gurugram")).toBe(true);
    expect(isPlaceName("Shankar Pipes Ltd")).toBe(false);
  });
});

describe("known companies override a guessed supply-side role", () => {
  it("keeps Welspun a manufacturer even when stored as distributor", () => {
    expect(resolveBuyerRole("distributor", "Welspun Corp Unit")).toBe("manufacturer");
    expect(resolveBuyerRole("owner", "Saudi Aramco")).toBe("owner");
  });
});
