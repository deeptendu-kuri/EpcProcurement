// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, getDb, listMigrations, migrate, pgTimestampToIso, setDbForTests, type Db } from "./index";

const SLICE_TABLES = [
  "runs", "run_events", "source_documents", "evidence", "fact_evidence", "companies", "projects",
  "project_stage_events", "packages", "requirements", "project_parties", "people", "person_roles",
  "relationships", "signals", "leads", "lead_score_history", "activities", "outreach_drafts", "llm_usage",
];

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function insertCompany(name = "Example Engineering Ltd"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into companies (canonical_name, normalized_name, country) values ($1, lower($1), 'IN') returning id",
    [name],
  );
  return rows[0].id;
}

const emptyLead = { breakdown: JSON.stringify({ criteria: [], unknown: [] }), gates: "[]", reasons: "[]" };

describe("slice database", () => {
  it("applies every migration and creates all slice tables", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const names = rows.map((row) => row.table_name);
    for (const table of SLICE_TABLES) expect(names).toContain(table);

    const applied = await db.query<{ name: string }>("select name from schema_migrations order by name");
    expect(applied.rows.map((row) => row.name)).toEqual(listMigrations().map((migration) => migration.name));
  });

  it("does not re-apply migrations", async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it("generates uuids and returns ISO timestamps and numbers", async () => {
    const { rows } = await db.query<{ id: string; created_at: string; match_certainty: number }>(
      "insert into companies (canonical_name, normalized_name, match_certainty) values ('A', 'a', 0.85) returning id, created_at, match_certainty",
    );
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(rows[0].match_certainty).toBe(0.85);
  });

  it("enforces check constraints instead of enums", async () => {
    const buyer = await insertCompany("Check Co");
    await expect(
      db.query(
        "insert into leads (kind, buyer_company_id, score_breakdown, gate_results, class, reasons, scoring_version) values ('bid', $1, $2, $3, 'excellent', $4, 1)",
        [buyer, emptyLead.breakdown, emptyLead.gates, emptyLead.reasons],
      ),
    ).rejects.toThrow();
  });

  it("keeps one lead per (buyer, project, package, kind) even when project/package are null", async () => {
    const buyer = await insertCompany("Unique Co");
    const insert = () =>
      db.query(
        "insert into leads (kind, buyer_company_id, score_breakdown, gate_results, class, reasons, scoring_version) values ('supply_subcontract', $1, $2, $3, 'watch', $4, 1)",
        [buyer, emptyLead.breakdown, emptyLead.gates, emptyLead.reasons],
      );
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it("keeps canonical_url and signal fingerprint unique", async () => {
    const doc = "insert into source_documents (source_key, publisher_key, url, canonical_url, content_hash) values ('fixture', 'example.com', $1, $1, 'h')";
    await db.query(doc, ["https://example.com/a"]);
    await expect(db.query(doc, ["https://example.com/a"])).rejects.toThrow();

    const signal = "insert into signals (type, signal_date, summary, fingerprint) values ('contract_awarded', '2026-09-01', 's', 'fp-1')";
    await db.query(signal);
    await expect(db.query(signal)).rejects.toThrow();
  });

  it("stores jsonb and arrays and returns dates as YYYY-MM-DD", async () => {
    const { rows } = await db.query<{ evidence_ids: string[]; signal_date: string }>(
      "insert into signals (type, signal_date, summary, fingerprint, evidence_ids) values ('tender_released', '2026-10-05', 's', 'fp-2', $1) returning evidence_ids, signal_date",
      [["00000000-0000-0000-0000-000000000001"]],
    );
    expect(rows[0].evidence_ids).toEqual(["00000000-0000-0000-0000-000000000001"]);
    expect(rows[0].signal_date).toBe("2026-10-05");
  });

  it("getDb() delegates to the injected database", async () => {
    setDbForTests(db);
    try {
      const { rows } = await getDb().query<{ one: number }>("select 1 as one");
      expect(rows[0].one).toBe(1);
      expect(await getDb().tx(async (tx) => (await tx.query<{ two: number }>("select 2 as two")).rows[0].two)).toBe(2);
    } finally {
      setDbForTests(undefined);
    }
  });

  it("rolls back a failed transaction", async () => {
    await expect(
      db.tx(async (tx) => {
        await tx.query("insert into runs (status) values ('queued')");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const { rows } = await db.query<{ count: number }>("select count(*)::int as count from runs");
    expect(rows[0].count).toBe(0);
  });
});

describe("pgTimestampToIso", () => {
  it("converts Postgres timestamp text to ISO UTC", () => {
    expect(pgTimestampToIso("2026-09-27 10:00:00.5+00")).toBe("2026-09-27T10:00:00.500Z");
    expect(pgTimestampToIso("2026-09-27 12:00:00+02")).toBe("2026-09-27T10:00:00.000Z");
    expect(pgTimestampToIso("2026-09-27 10:00:00")).toBe("2026-09-27T10:00:00.000Z");
  });
});
