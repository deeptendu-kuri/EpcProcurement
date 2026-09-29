// @vitest-environment node
/**
 * Supply chain against the database (docs/mvp/15): migrations 006–008, directory sync (observed +
 * seed), the chain of a pipeline builder, manual company links, derived buyers, add contact + confirm,
 * and the place-name cleanup.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { cleanupPlaceNameCompanies } from "@/mvp/pipeline/place-cleanup";
import { addContact, allSearchRecords, confirmPerson, deriveBuyer, getChainContacts, getSupplyChain, removeNodeCompany, setNodeCompany } from "./chain-db";
import { clearChainCache } from "./chain-db";
import { searchContactRecords, searchRecords } from "./search";

let db: Db;
const ids: Record<string, string> = {};

async function company(key: string, name: string, country: string, types: string[] = []) {
  const { rows } = await db.query<{ id: string }>("insert into companies (canonical_name, normalized_name, country, types) values ($1, lower($1), $2, $3) returning id", [name, country, types]);
  ids[key] = rows[0].id;
}

async function lead(key: string, companyKey: string, projectKey: string | null, buyerType: string, cls = "research") {
  const { rows } = await db.query<{ id: string }>(
    `insert into leads (kind, buyer_company_id, project_id, score, score_breakdown, gate_results, confidence_band, class, reasons, scoring_version, buyer_type)
     values ('supply_subcontract', $1, $2, 64, '{}'::jsonb, '[]'::jsonb, 'high', $3, '[]'::jsonb, 1, $4) returning id`,
    [ids[companyKey], projectKey ? ids[projectKey] : null, cls, buyerType],
  );
  ids[key] = rows[0].id;
}

beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
  await company("kpil", "Kalpataru Projects International Limited (KPIL)", "IN", ["main_epc"]);
  await company("gail", "GAIL (India) Ltd", "IN", ["owner"]);
  await company("valveco", "Bharat Valve Works", "IN", ["manufacturer"]);
  await company("place", "Shankar Chowk", "IN");
  const p = await db.query<{ id: string }>(
    "insert into projects (name, normalized_name, owner_company_id, country, sector, project_type) values ('Gas pipeline', 'gas pipeline', $1, 'IN', 'oil_gas', 'pipeline') returning id",
    [ids.gail],
  );
  ids.project = p.rows[0].id;
  await db.query("insert into project_parties (project_id, company_id, role, award_date) values ($1, $2, 'main_epc', '2026-09-10')", [ids.project, ids.kpil]);
  await lead("kpilLead", "kpil", "project", "epc_contractor");
  await lead("placeLead", "place", null, "manufacturer");
  // A supply relation stated by a source, with its evidence.
  const doc = await db.query<{ id: string }>("insert into evidence (url, quote, extracted_by, quote_verified, tier, publisher_key) values ('https://example.com/v', 'Bharat Valve Works bags valve order from KPIL', 'rule:test', true, 'B', 'example.com') returning id");
  const rel = await db.query<{ id: string }>("insert into relationships (from_company_id, to_company_id, type, project_id) values ($1, $2, 'supplied_by', $3) returning id", [ids.kpil, ids.valveco, ids.project]);
  await db.query("insert into fact_evidence (entity_type, entity_id, field, evidence_id) values ('relationship', $1, '*', $2)", [rel.rows[0].id, doc.rows[0].id]);
  ids.evidence = doc.rows[0].id;
}, 120_000);

afterAll(async () => {
  setDbForTests(undefined);
  clearChainCache();
  await db?.close();
});

describe("supply chain in the database", () => {
  it("place names are marked Not a buyer on startup", async () => {
    const res = await cleanupPlaceNameCompanies(db);
    expect(res.companies).toEqual(["Shankar Chowk"]);
    const { rows } = await db.query<{ class: string }>("select class from leads where id = $1", [ids.placeLead]);
    expect(rows[0].class).toBe("rejected");
  });

  it("builds the chain with a confirmed valve maker and seed pipe makers as possible", async () => {
    const chain = (await getSupplyChain(ids.kpilLead, {}, db))!;
    expect(chain.rootCompanyId).toBe(ids.kpil);
    const valve = chain.nodes.find((n) => n.nodeId === "t2:valve_maker")!;
    expect(valve).toMatchObject({ companyId: ids.valveco, link: "confirmed", linkSource: "source", evidenceIds: [ids.evidence] });
    const pipe = chain.nodes.find((n) => n.nodeId === "t2:pipe_maker")!;
    expect(pipe.link).toBe("possible"); // Welspun / Jindal SAW / Ratnamani from the cited seed list, same country
    expect(["Welspun Corp", "Jindal SAW", "Ratnamani Metals & Tubes"]).toContain(pipe.name);
    const seeds = await db.query<{ n: number }>("select count(*)::int as n from company_capabilities where source = 'seed' and url like 'https://%'");
    expect(seeds.rows[0].n).toBeGreaterThan(0);
  });

  it("sets and removes a node's company", async () => {
    const set = await setNodeCompany(ids.kpilLead, "t2:coating_company", "Gujarat Coating Services Pvt Ltd", null, db);
    const node = set.nodes.find((n) => n.nodeId === "t2:coating_company")!;
    expect(node).toMatchObject({ name: "Gujarat Coating Services Pvt Ltd", link: "confirmed", linkSource: "user" });
    const removed = await removeNodeCompany(ids.kpilLead, "t2:coating_company", null, db);
    expect(removed.nodes.find((n) => n.nodeId === "t2:coating_company")!.name).not.toBe("Gujarat Coating Services Pvt Ltd");
  });

  it("derived buyers appear in search and can be saved as a lead", async () => {
    const records = await allSearchRecords(db);
    const res = searchRecords(records, { tiers: [2] }, new Date());
    const valve = res.rows.find((r) => r.name === "Bharat Valve Works")!;
    expect(valve).toMatchObject({ tier: 2, link: "confirmed", storedLeadId: null, foundVia: { leadId: ids.kpilLead } });
    const { leadId, created } = await deriveBuyer(valve.derivedKey!, db);
    expect(created).toBe(true);
    const { rows } = await db.query<{ kind: string; class: string; chain_tier: number; found_via_lead_id: string }>("select kind, class, chain_tier, found_via_lead_id from leads where id = $1", [leadId]);
    expect(rows[0]).toEqual({ kind: "supply_subcontract", class: "research", chain_tier: 2, found_via_lead_id: ids.kpilLead });
    expect((await deriveBuyer(valve.derivedKey!, db)).created).toBe(false);
    clearChainCache();
    const after = searchRecords(await allSearchRecords(db), {}, new Date());
    const stored = after.rows.find((r) => r.name === "Bharat Valve Works")!;
    expect(stored).toMatchObject({ leadId, tier: 2, foundVia: { leadId: ids.kpilLead } });
    // The Contacts switch returns rows for the buyers and their chains.
    const contacts = searchContactRecords(await allSearchRecords(db), {}, new Date());
    expect(contacts.total).toBeGreaterThan(0);
  });

  it("adds a contact (Likely) and confirms the decision maker (Confirmed)", async () => {
    const { personId } = await addContact({ companyId: ids.kpil, slotId: "head-procurement", name: "Asha Mehta", title: "Head of Procurement", email: "asha@example.com", linkedinUrl: "https://www.linkedin.com/in/asha" }, db);
    let rows = (await getChainContacts(ids.kpilLead, {}, db))!;
    let row = rows.find((r) => r.tier === 1 && r.slotId === "head-procurement")!;
    expect(row.person).toMatchObject({ id: personId, name: "Asha Mehta", email: "asha@example.com", linkedinUrl: "https://www.linkedin.com/in/asha" });
    expect(row.status).toBe("likely");
    expect(await confirmPerson(personId, { slotId: "head-procurement" }, db)).toBe(true);
    rows = (await getChainContacts(ids.kpilLead, {}, db))!;
    row = rows.find((r) => r.tier === 1 && r.slotId === "head-procurement")!;
    expect(row.status).toBe("confirmed");
    const act = await db.query<{ n: number }>("select count(*)::int as n from activities where person_id = $1 and body like 'contact_confirmed:%'", [personId]);
    expect(act.rows[0].n).toBe(1);
    const points = await db.query<{ kind: string }>("select kind from contact_points where person_id = $1 order by kind", [personId]);
    expect(points.rows.map((p) => p.kind)).toEqual(["email", "linkedin"]);
  });
});
