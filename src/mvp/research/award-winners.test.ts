// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import { storeDocument } from "@/mvp/pipeline/read";
import { shortlistAwardWinners } from "./engine";

describe("award winners join the shortlist (elbow search, 10 Oct)", () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); }, 60_000);
  afterAll(async () => { await db?.close(); });

  it("adds contractors and owners from a verified award, not open tenders or suppliers", async () => {
    const run = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', '{}'::jsonb) returning id")).rows[0].id;
    await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [run]);
    const doc = await storeDocument(db, run, { sourceKey: "test", sourceName: "News", tier: "B", url: "https://news.example/example-epc-wins", title: "Example EPC wins offshore contract",
      publishedAt: "2026-09-30", isSample: false, text: "Example EPC Company wins $600 million offshore EPC contracts with Example Oil Company." });
    const trigger = async (name: string, kind: string, role: string) => {
      const company = (await db.query<{ id: string }>("insert into companies (canonical_name, normalized_name) values ($1, lower($1)) returning id", [name])).rows[0].id;
      return { id: (await db.query<{ id: string }>(`insert into company_triggers (company_id, run_id, product_id, kind, role, title, evidence_ids, strength)
        values ($1,$2,'bw-fittings',$3,$4,$5,'{}','confirmed') returning id`, [company, run, kind, role, `${name} contract`])).rows[0].id, kind, role, title: "Example EPC Company wins $600 million offshore EPC contracts with Example Oil Company." };
    };
    const triggers = [await trigger("Example EPC Company", "award", "contractor"), await trigger("Example Oil Company", "award", "owner"),
      await trigger("Example Tender Board", "tender", "owner"), await trigger("Example Pipe Mill", "order", "supplier")];
    expect(await shortlistAwardWinners(db, run, doc.id, triggers)).toBe(2);
    const rows = (await db.query<{ company: string; identity_quote: string }>("select company, identity_quote from research_candidates where run_id=$1 order by company", [run])).rows;
    expect(rows.map((r) => r.company)).toEqual(["Example EPC Company", "Example Oil Company"]);
    expect(rows[0].identity_quote).toMatch(/wins \$600 million offshore EPC contracts/);
  });
});

describe("only recent award winners join the shortlist", () => {
  it("skips an award older than 18 months", async () => {
    const { createTestDb } = await import("@/mvp/db");
    const db = await createTestDb();
    try {
      const run = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', '{}'::jsonb) returning id")).rows[0].id;
      await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [run]);
      const company = (await db.query<{ id: string }>("insert into companies (canonical_name, normalized_name) values ('Example Old EPC', 'example old epc') returning id")).rows[0].id;
      const id = (await db.query<{ id: string }>(`insert into company_triggers (company_id, run_id, product_id, kind, role, title, evidence_ids, strength)
        values ($1,$2,'bw-fittings','award','contractor','Example Old EPC wins contract','{}','confirmed') returning id`, [company, run])).rows[0].id;
      const doc = (await db.query<{ id: string }>("insert into source_documents(source_key,publisher_key,url,canonical_url,content_hash,text) values('t','t','https://n.example/a','https://n.example/a','h','Example Old EPC wins contract') returning id")).rows[0].id;
      const now = new Date("2026-10-10T00:00:00Z");
      expect(await shortlistAwardWinners(db, run, doc, [{ id, kind: "award", role: "contractor", title: "Example Old EPC wins contract", date: "2024-01-15" }], now)).toBe(0);
      expect(await shortlistAwardWinners(db, run, doc, [{ id, kind: "award", role: "contractor", title: "Example Old EPC wins contract", date: "2026-03-01" }], now)).toBe(1);
    } finally { await db.close(); }
  }, 60_000);
});
