// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Scoring is built separately; the pipeline only needs its contract.
vi.mock("@/mvp/scoring", () => ({ buildSignalsAndScore: vi.fn(async () => ({ created: 3, updated: 1 })) }));

import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { buildSignalsAndScore } from "@/mvp/scoring";
import type { RunEventRow, RunRow } from "@/mvp/types";
import { extractDocument } from "./extract";
import { INTERRUPTED_ERROR, failStaleRuns } from "./active-runs";
import { executeRun, startRun, waitForRun } from "./index";
import { resolveDocument } from "./resolve";
import { fixtureDocs } from "./sources/fixtures";
import { storeDocument } from "./read";

let db: Db;
const saved = { offline: process.env.MVP_OFFLINE, groq: process.env.GROQ_API_KEY };

beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
  process.env.MVP_OFFLINE = "1";
  delete process.env.GROQ_API_KEY;
}, 120_000);

afterAll(async () => {
  setDbForTests(undefined);
  await db?.close();
  if (saved.offline === undefined) delete process.env.MVP_OFFLINE;
  else process.env.MVP_OFFLINE = saved.offline;
  if (saved.groq !== undefined) process.env.GROQ_API_KEY = saved.groq;
});

async function count(table: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0].n;
}

async function resolveFixture(id: string, runId: string) {
  const raw = fixtureDocs().find((d) => d.fixtureId === id)!;
  const stored = await storeDocument(db, runId, { ...raw, text: raw.text! });
  const ex = await extractDocument({ text: stored.text, url: raw.url }, { db });
  return db.tx((tx) =>
    resolveDocument(tx, { documentId: stored.id, url: raw.url, tier: raw.tier, publisherKey: raw.publisherKey!, market: raw.market ?? null, publishedAt: raw.publishedAt, text: stored.text }, ex),
  );
}

describe("resolve", () => {
  beforeEach(async () => {
    await db.exec("truncate runs, source_documents, evidence, fact_evidence, companies, projects cascade");
  });

  it("dedupes the same project from two publishers into one project with evidence from both", async () => {
    const { rows } = await db.query<{ id: string }>("insert into runs (status) values ('running') returning id");
    const runId = rows[0].id;
    const a = await resolveFixture("fx-01", runId);
    const b = await resolveFixture("fx-02", runId);
    expect(a.projectId).toBeTruthy();
    expect(b.projectId).toBe(a.projectId);
    expect(b.newProject).toBe(false);

    const projects = await db.query<{ name: string; country: string; current_stage: string; value_usd: number; owner: string }>(
      "select p.name, p.country, p.current_stage, p.value_usd, c.canonical_name as owner from projects p join companies c on c.id = p.owner_company_id",
    );
    expect(projects.rows).toHaveLength(1);
    expect(projects.rows[0]).toMatchObject({ country: "IN", current_stage: "awarded", owner: "Example Gas Transmission Ltd" });
    expect(projects.rows[0].value_usd).toBeGreaterThan(100_000_000);

    const publishers = await db.query<{ publisher_key: string }>(
      `select distinct e.publisher_key from fact_evidence fe join evidence e on e.id = fe.evidence_id
        where fe.entity_type = 'project' and fe.entity_id = $1 and fe.field = 'name'`,
      [a.projectId],
    );
    expect(publishers.rows.map((r) => r.publisher_key).sort()).toEqual(["example-energy-news", "example-exchange"]);

    // One EPC contractor company, one main_epc party, one awarded_to edge.
    const epc = await db.query<{ n: number; certainty: number }>(
      "select count(*)::int as n, max(match_certainty)::float as certainty from companies where normalized_name = 'example infra projects'",
    );
    expect(epc.rows[0]).toMatchObject({ n: 1, certainty: 0.9 });
    expect(await count("project_parties where role = 'main_epc'")).toBe(1);
    expect(await count("relationships where type = 'awarded_to'")).toBe(1);

    // Requirement with spec, product match and provenance.
    const req = await db.query<{ spec: Record<string, unknown>; quantity: number; unit: string; delivery_port: string; client_product_id: string }>(
      "select spec, quantity, unit, delivery_port, client_product_id from requirements where item_category = 'line pipe'",
    );
    expect(req.rows).toHaveLength(1);
    expect(req.rows[0]).toMatchObject({ spec: { standard: "API 5L", grade: "X65", od_in: 24 }, quantity: 120, unit: "km", delivery_port: "Kandla", client_product_id: "prod-line-pipe" });

    // People from both articles with buying roles.
    const roles = await db.query<{ full_name: string; buying_role: string }>(
      "select p.full_name, r.buying_role from people p join person_roles r on r.person_id = p.id order by p.full_name",
    );
    expect(roles.rows).toEqual([
      { full_name: "Priya Sharma", buying_role: "procurement_lead" },
      { full_name: "Rajesh Kumar", buying_role: "project_director" },
    ]);

    // Every evidence row is verified and labelled 'rule' in demo mode.
    const evidence = await db.query<{ quote_verified: boolean; agreement: string }>("select quote_verified, agreement from evidence");
    expect(evidence.rows.length).toBeGreaterThanOrEqual(6);
    expect(evidence.rows.every((e) => e.quote_verified && e.agreement === "rule")).toBe(true);
  });

  it("never shares an evidence row between facts with different agreement labels", async () => {
    const { rows } = await db.query<{ id: string }>("insert into runs (status) values ('running') returning id");
    const raw = fixtureDocs().find((d) => d.fixtureId === "fx-01")!;
    const stored = await storeDocument(db, rows[0].id, { ...raw, text: raw.text! });
    const ex = await extractDocument({ text: stored.text, url: raw.url }, { db });
    const name = ex.project.name!;
    // Project name stored first as `both`; the site shares its quote and extractor but is `single`.
    ex.project.name = { ...name, agreement: "both", extractedBy: "model-a" };
    ex.project.location = { ...name, agreement: "single", extractedBy: "model-a" };
    const stats = await db.tx((tx) =>
      resolveDocument(tx, { documentId: stored.id, url: raw.url, tier: raw.tier, publisherKey: raw.publisherKey!, market: raw.market ?? null, publishedAt: raw.publishedAt, text: stored.text }, ex),
    );
    const linked = await db.query<{ field: string; agreement: string }>(
      `select fe.field, e.agreement from fact_evidence fe join evidence e on e.id = fe.evidence_id
        where fe.entity_type = 'project' and fe.entity_id = $1 and fe.field in ('name', 'site') and e.quote = $2`,
      [stats.projectId, name.quote],
    );
    expect(Object.fromEntries(linked.rows.map((r) => [r.field, r.agreement]))).toEqual({ name: "both", site: "single" });
    const rowsForQuote = await db.query<{ agreement: string }>(
      "select agreement from evidence where document_id = $1 and quote = $2 and extracted_by = 'model-a' order by agreement",
      [stored.id, name.quote],
    );
    expect(rowsForQuote.rows.map((r) => r.agreement)).toEqual(["both", "single"]);
  });

  it("builds supplied_by and subcontracted_to edges", async () => {
    const { rows } = await db.query<{ id: string }>("insert into runs (status) values ('running') returning id");
    await resolveFixture("fx-04", rows[0].id);
    await resolveFixture("fx-05", rows[0].id);
    const edges = await db.query<{ type: string; from_name: string; to_name: string; discipline: string | null }>(
      `select r.type, f.canonical_name as from_name, t.canonical_name as to_name, r.discipline
         from relationships r join companies f on f.id = r.from_company_id join companies t on t.id = r.to_company_id order by r.type`,
    );
    expect(edges.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "subcontracted_to", from_name: "Example Gulf Contracting LLC", to_name: "Example Emirates Piping Services LLC", discipline: "piping" }),
        expect.objectContaining({ type: "supplied_by", from_name: "Example Gulf Contracting LLC", to_name: "Example Valves Manufacturing Pvt Ltd", discipline: "piping" }),
        expect.objectContaining({ type: "awarded_to", from_name: "Example Emirates Gas Company PJSC", to_name: "Example Gulf Contracting LLC" }),
      ]),
    );
    expect(await count("projects")).toBe(1);
  });
});

describe("offline run over fixtures", () => {
  beforeAll(async () => {
    await db.exec("truncate runs, source_documents, evidence, fact_evidence, companies, projects cascade");
  });

  it("completes with status done, progress events and sample-flagged documents", async () => {
    const runId = await startRun({ query: "line pipe", markets: ["IN", "SA", "AE", "NO", "MY"], leadKinds: ["bid", "supply_subcontract"] });
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    await waitForRun(runId);

    const run = (await db.query<RunRow>("select * from runs where id = $1", [runId])).rows[0];
    expect(run.status).toBe("done");
    expect(run.error).toBeNull();
    expect(run.counters).toMatchObject({ sourcesTotal: 1, sourcesDone: 1, itemsRead: 13, relevant: 12, newLeads: 3, updatedLeads: 1 });
    expect(run.counters.factsKept).toBeGreaterThan(50);
    expect(vi.mocked(buildSignalsAndScore)).toHaveBeenCalledWith(runId);

    const events = (await db.query<RunEventRow>("select * from run_events where run_id = $1 order by id", [runId])).rows;
    const stages = new Set(events.map((e) => e.stage));
    for (const stage of ["collect", "read", "filter", "extract", "check", "resolve", "score", "done"]) expect(stages).toContain(stage);
    expect(events.at(-1)!.message).toContain("Searched 1 of 1 sources");
    expect(events.at(-1)!.message).toContain("3 new leads");

    const docs = await db.query<{ status: string; is_sample: boolean; filter_reason: string | null; url: string }>("select status, is_sample, filter_reason, url from source_documents");
    expect(docs.rows).toHaveLength(13);
    expect(docs.rows.every((d) => d.is_sample)).toBe(true);
    const report = docs.rows.find((d) => d.url.includes("market-2026"))!;
    expect(report).toMatchObject({ status: "filtered_out", filter_reason: "noise: market report" });
    expect(docs.rows.filter((d) => d.status === "extracted")).toHaveLength(12);

    const completed = await db.query<{ status: string; current_stage: string }>("select status, current_stage from projects where name like '%Yanbu%'");
    expect(completed.rows[0]).toMatchObject({ status: "completed", current_stage: "completed" });
    const tender = await db.query<{ specs: Record<string, unknown> }>("select specs from projects where name like '%Jubail-Riyadh%'");
    expect(tender.rows[0].specs).toMatchObject({ tender_ref: "EX-SWT-2026-114" });
    expect(tender.rows[0].specs.closing_date).toMatch(/^\d{4}-\d\d-\d\d$/);
    // Scoring reads tenders from specs.tenders[] (src/mvp/scoring/util.ts readTenders).
    const tenders = tender.rows[0].specs.tenders as Record<string, unknown>[];
    expect(tenders).toHaveLength(1);
    expect(tenders[0]).toMatchObject({ ref: "EX-SWT-2026-114", status: "open", route: "open_tender" });
    expect(tenders[0].buyer_company_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tenders[0].package_id).toMatch(/^[0-9a-f-]{36}$/);
    expect((tenders[0].evidence_ids as string[]).length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("is idempotent: re-running the same fixtures creates no duplicates", async () => {
    const tables = ["source_documents", "evidence", "fact_evidence", "companies", "projects", "packages", "requirements", "project_parties", "people", "person_roles", "relationships", "project_stage_events"];
    const before = await Promise.all(tables.map(count));
    const runId = await startRun({ query: "line pipe", markets: ["IN", "SA", "AE", "NO", "MY"], leadKinds: ["bid", "supply_subcontract"] });
    await waitForRun(runId);
    const after = await Promise.all(tables.map(count));
    expect(Object.fromEntries(tables.map((t, i) => [t, after[i]]))).toEqual(Object.fromEntries(tables.map((t, i) => [t, before[i]])));
    const run = (await db.query<RunRow>("select * from runs where id = $1", [runId])).rows[0];
    expect(run.status).toBe("done");
    // Known documents are re-attached to the new run so scoring sees them.
    expect(await count(`source_documents where run_id = '${runId}'`)).toBe(12);
  }, 60_000);

  it("RunInput.offline searches the sample data only, even when live mode is on", async () => {
    const before = process.env.MVP_OFFLINE;
    process.env.MVP_OFFLINE = "0";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must not be used"));
    try {
      const runId = await startRun({ query: "line pipe", markets: ["IN", "SA"], leadKinds: ["bid", "supply_subcontract"], offline: true });
      await waitForRun(runId);
      const run = (await db.query<RunRow & { adhoc_query: Record<string, unknown> }>("select * from runs where id = $1", [runId])).rows[0];
      expect(run.status).toBe("done");
      expect(run.adhoc_query).toMatchObject({ offline: true });
      expect(run.counters).toMatchObject({ sourcesTotal: 1, sourcesDone: 1 });
      expect(fetchSpy).not.toHaveBeenCalled();
      const events = (await db.query<RunEventRow>("select * from run_events where run_id = $1 order by id", [runId])).rows;
      expect(events[0].message).toContain("sample data");
      // Without the flag the input carries no offline key.
      process.env.MVP_OFFLINE = "1";
      const plain = await startRun({ query: "line pipe", markets: ["IN"], leadKinds: ["bid"], offline: false });
      await waitForRun(plain);
      const plainRow = (await db.query<{ adhoc_query: Record<string, unknown> }>("select adhoc_query from runs where id = $1", [plain])).rows[0];
      expect(plainRow.adhoc_query).not.toHaveProperty("offline");
    } finally {
      fetchSpy.mockRestore();
      if (before === undefined) delete process.env.MVP_OFFLINE;
      else process.env.MVP_OFFLINE = before;
    }
  }, 60_000);

  it("marks the run failed (not thrown) when something breaks", async () => {
    const { rows } = await db.query<{ id: string }>("insert into runs (status) values ('queued') returning id");
    const broken = { ...db, query: async () => { throw new Error("db down"); } } as unknown as Db;
    await expect(executeRun(rows[0].id, { query: "x", markets: ["IN"], leadKinds: ["bid"] }, broken)).resolves.toBeUndefined();
  });

  it("ends as failed with the error when scoring fails", async () => {
    vi.mocked(buildSignalsAndScore).mockRejectedValueOnce(new Error("scoring exploded"));
    const runId = await startRun({ query: "line pipe", markets: ["IN"], leadKinds: ["bid"] });
    await waitForRun(runId);
    const run = (await db.query<RunRow>("select * from runs where id = $1", [runId])).rows[0];
    expect(run.status).toBe("failed");
    expect(run.error).toContain("Scoring failed: scoring exploded");
    const events = (await db.query<RunEventRow>("select * from run_events where run_id = $1 order by id", [runId])).rows;
    expect(events.map((e) => e.stage)).not.toContain("done");
    expect(events.at(-1)!.stage).toBe("error");
  }, 60_000);

  it("marks runs left running by a stopped process as failed (interrupted)", async () => {
    const old = await db.query<{ id: string }>(
      "insert into runs (status, started_at, created_at) values ('running', now() - interval '1 hour', now() - interval '1 hour') returning id",
    );
    const fresh = await db.query<{ id: string }>("insert into runs (status, started_at) values ('running', now()) returning id");
    expect(await failStaleRuns(db)).toBe(1);
    const rows = (await db.query<RunRow>("select * from runs where id = any($1::uuid[])", [[old.rows[0].id, fresh.rows[0].id]])).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[old.rows[0].id]).toMatchObject({ status: "failed", error: INTERRUPTED_ERROR });
    expect(byId[fresh.rows[0].id].status).toBe("running");
    const events = (await db.query<RunEventRow>("select * from run_events where run_id = $1", [old.rows[0].id])).rows;
    expect(events).toEqual([expect.objectContaining({ stage: "error", message: INTERRUPTED_ERROR })]);
  });
});
