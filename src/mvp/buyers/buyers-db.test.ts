// @vitest-environment node
/**
 * Buyers end to end (docs/mvp/14): a pipe maker's supply order is ingested and scored, then read back
 * as a BuyerView (manufacturer, competitor for pipe, sells coating / welding / plates), found by
 * SuperSearch, and saved into a lead list. Also checks migration 004's role constraint.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { extractDocument } from "@/mvp/pipeline/extract";
import { storeDocument } from "@/mvp/pipeline/read";
import { resolveDocument } from "@/mvp/pipeline/resolve";
import { buildSignalsAndScore } from "@/mvp/scoring";
import { addToLeadList, createLeadList, getLeadList, removeFromLeadList } from "./lists";
import { allBuyerRecords, clearBuyerCache, loadBuyerRecords } from "./load";
import { searchBuyers } from "./index";
import { searchRecords } from "./search";

const NOW = new Date("2026-10-01T09:00:00Z");
const KEYS = ["MVP_OFFLINE", "GROQ_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
  for (const key of KEYS) delete process.env[key]; // demo mode: the rules extractor answers
  const text = [
    "East Pipes Integrated Company secures SAR 771 million steel pipes order from Saudi Aramco",
    "East Pipes Integrated Company for Industry said it signed the order with Saudi Aramco for water transmission pipes in the Eastern Province.",
  ].join("\n");
  const { rows } = await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', $1::jsonb) returning id", [
    JSON.stringify({ query: "pipeline", markets: ["IN", "SA", "AE", "MY"], leadKinds: ["bid", "supply_subcontract"] }),
  ]);
  const runId = rows[0].id;
  const url = "https://paper-two.example/epic-sep";
  const publishedAt = "2026-09-21T06:00:00.000Z";
  const stored = await storeDocument(db, runId, { sourceKey: "bing:test", sourceName: "News · test", tier: "B", publisherKey: "paper-two.example", url, title: text.split("\n")[0], publishedAt, text, language: "en", isSample: false });
  const ex = await extractDocument({ text: stored.text, url, publishedAt }, { db, runId });
  await db.tx((tx) => resolveDocument(tx, { documentId: stored.id, url, tier: "B", publisherKey: "paper-two.example", market: "IN", publishedAt, text: stored.text }, ex));
  await buildSignalsAndScore(runId, { db, now: NOW });
}, 120_000);

afterAll(async () => {
  setDbForTests(undefined);
  await db?.close();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("buyers from the database", () => {
  it("the pipe maker is a manufacturer buyer that competes on pipe", async () => {
    const records = await loadBuyerRecords({ db, now: NOW });
    const epic = records.find((r) => /East Pipes/i.test(r.view.name));
    expect(epic).toBeDefined();
    const view = epic!.view;
    expect(view.role).toBe("manufacturer");
    expect(view.subRoleLabel).toBe("Pipe maker");
    const good = view.sellItems.filter((i) => i.fit === "good").map((i) => i.itemId);
    expect(good).toEqual(expect.arrayContaining(["coating-materials", "welding-consumables", "plates"]));
    expect(view.competitorFor.some((id) => ["line-pipe", "di-pipe"].includes(id))).toBe(true);
    expect(view.proof.length).toBeGreaterThan(0);
    expect(view.proof[0].sentence.length).toBeGreaterThan(view.proof[0].highlight.length - 1);
    expect(view.chain.some((c) => c.role === "owner" && c.identified)).toBe(true);

    const res = searchRecords(records, { roles: { any: ["manufacturer"] }, stage: ["ready", "check", "early"] }, NOW);
    expect(res.rows.map((r) => r.leadId)).toContain(view.leadId);
  });

  it("migration 004 only allows the six roles", async () => {
    const { rows } = await db.query<{ id: string }>("select id from leads limit 1");
    await expect(db.query("update leads set buyer_type = 'supplier' where id = $1", [rows[0].id])).rejects.toThrow();
    await db.query("update leads set buyer_type = 'distributor' where id = $1", [rows[0].id]);
  });

  it("lead lists: create, add (once), remove", async () => {
    const records = await allBuyerRecords({ db, now: NOW });
    const ids = records.map((r) => r.view.leadId);
    const list = await createLeadList("Saudi mills", [ids[0]], null, db);
    expect(list.itemCount).toBe(1);
    expect(await addToLeadList(list.id, ids, db)).toBe(ids.length - 1);
    expect((await getLeadList(list.id, db))?.leadIds.length).toBe(ids.length);
    expect(await removeFromLeadList(list.id, [ids[0]], db)).toBe(1);
    expect((await getLeadList(list.id, db))?.itemCount).toBe(ids.length - 1);
  });
  it("Leads: rows carry their search, product and email status; the search filter narrows them (doc 17)", async () => {
    const { rows: leads } = await db.query<{ id: string; company_id: string }>(
      "select l.id, l.buyer_company_id as company_id from leads l join companies c on c.id = l.buyer_company_id where c.canonical_name ilike '%East Pipes%' limit 1");
    const { rows: runs } = await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('done', $1::jsonb) returning id",
      [JSON.stringify({ query: "steel pipe", productId: "line-pipe", markets: ["SA"] })]);
    const run = runs[0].id;
    const { rows: opps } = await db.query<{ id: string }>(
      `insert into search_opportunities (run_id, lead_id, company_id, keyword, product_id, product_name, buying_reason, evidence_ids, fit_score, material_fit_kind)
       values ($1, $2, $3, 'steel pipe', 'coating-materials', 'Pipe coating materials', 'Aramco order', '{}', 97, 'explicit') returning id`,
      [run, leads[0].id, leads[0].company_id]);
    await db.query("insert into funnel_threads (opportunity_id, company_id, product_id, reply_token, state) values ($1, $2, 'coating-materials', 'tok-doc17', 'active')",
      [opps[0].id, leads[0].company_id]);
    clearBuyerCache();

    const scoped = await searchBuyers({ run, stage: ["ready", "check", "early"] });
    expect(scoped.rows.length).toBeGreaterThan(0);
    for (const row of scoped.rows) {
      expect(row.searches?.[0]).toEqual({ runId: run, label: expect.stringMatching(/^steel pipe · /) });
      expect(row.searchedProduct).toBe("Pipe coating materials");
      expect(row.emailStatus).toBe("Intro sent");
      expect(row.opportunityId).toBe(opps[0].id);
      // Rated by the search's buyer fit; the searched product is not repeated under "also can sell".
      expect(row.fitScore).toBeGreaterThanOrEqual(97);
      expect(row.searchFit).toBe("explicit");
      expect(row.alsoSell).not.toContain("Pipe coating materials");
    }
    expect((await searchBuyers({ run, stage: ["ready", "check", "early"], minFit: 95 })).rows.length).toBe(scoped.rows.length);
    const other = await searchBuyers({ run: "99999999-9999-4999-8999-999999999999", stage: ["ready", "check", "early"] });
    expect(other.rows).toHaveLength(0);
    const all = await searchBuyers({ stage: ["ready", "check", "early"] });
    expect(all.rows.length).toBeGreaterThanOrEqual(scoped.rows.length);
  });
});
