// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import type { LeadRow, SignalRow } from "@/mvp/types";
import { getCompanyInsights } from "./graph";
import { buildSignalsAndScore } from "./index";

const NOW = new Date("2026-09-27T09:00:00Z");
let db: Db;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const TABLES = [
  "lead_score_history", "activities", "outreach_drafts", "leads", "signals", "fact_evidence", "relationships",
  "person_roles", "people", "requirements", "project_parties", "project_stage_events", "packages", "projects",
  "evidence", "source_documents", "companies", "runs",
];

beforeEach(async () => {
  for (const table of TABLES) await db.query(`delete from ${table}`);
});

// ───────────────────────── seed helpers ─────────────────────────

async function id(sql: string, params: unknown[]): Promise<string> {
  return (await db.query<{ id: string }>(sql, params)).rows[0].id;
}

async function run(kinds: string[] = ["bid", "supply_subcontract"]) {
  return id("insert into runs (status, adhoc_query) values ('running', $1) returning id", [
    JSON.stringify({ query: "line pipe", markets: ["IN"], leadKinds: kinds }),
  ]);
}

let docN = 0;
async function doc(runId: string | null, publisher: string, tier: "A" | "B" | "C", published: string, sample = false) {
  docN++;
  return id(
    `insert into source_documents (source_key, tier, publisher_key, url, canonical_url, content_hash, published_at, run_id, is_sample, status)
     values ('fixture', $1, $2, $3, $3, 'h', $4, $5, $6, 'extracted') returning id`,
    [tier, publisher, `https://${publisher}/doc-${docN}`, published, runId, sample],
  );
}

async function ev(documentId: string, publisher: string, tier: "A" | "B" | "C", opts: { agreement?: string; verified?: boolean } = {}) {
  return id(
    `insert into evidence (document_id, url, quote, extracted_by, quote_verified, agreement, tier, publisher_key)
     values ($1, 'https://x', 'quote', 'rule:test', $2, $3, $4, $5) returning id`,
    [documentId, opts.verified ?? true, opts.agreement ?? "rule", tier, publisher],
  );
}

async function link(entityType: string, entityId: string, evidenceId: string, field = "*") {
  await db.query("insert into fact_evidence (entity_type, entity_id, field, evidence_id) values ($1, $2, $3, $4)", [
    entityType, entityId, field, evidenceId,
  ]);
}

async function company(name: string, country = "IN", certainty = 1) {
  return id(
    `insert into companies (canonical_name, normalized_name, country, match_certainty, status, listed_exchange, domain, types)
     values ($1, lower($1), $2, $3, 'active', 'NSE', 'example.example', '{main_epc}') returning id`,
    [name, country, certainty],
  );
}

async function project(name: string, extra: { country?: string; stage?: string; specs?: unknown; owner?: string } = {}) {
  return id(
    `insert into projects (name, normalized_name, country, sector, current_stage, specs, owner_company_id)
     values ($1, lower($1), $2, 'oil_gas', $3, $4, $5) returning id`,
    [name, extra.country ?? "IN", extra.stage ?? "awarded", JSON.stringify(extra.specs ?? {}), extra.owner ?? null],
  );
}

async function party(projectId: string, companyId: string, role: string, awardDate: string | null) {
  return id(
    "insert into project_parties (project_id, company_id, role, award_date, status) values ($1, $2, $3, $4, 'awarded') returning id",
    [projectId, companyId, role, awardDate],
  );
}

// ───────────────────────── graph ─────────────────────────

describe("relationship graph (07 §6)", () => {
  async function supplyEdge(buyer: string, supplier: string, date: string, publisher: string) {
    const rel = await id(
      "insert into relationships (from_company_id, to_company_id, type, discipline, event_date) values ($1, $2, 'supplied_by', 'pipeline', $3) returning id",
      [buyer, supplier, date],
    );
    await link("relationship", rel, await ev(await doc(null, publisher, "B", date), publisher, "B"));
  }

  it("regular supplier = 2 independent publishers within 36 months", async () => {
    const x = await company("Example EPC");
    const y = await company("Example Pipe Mill");
    await supplyEdge(x, y, "2025-05-01", "news-one.example");
    await supplyEdge(x, y, "2026-02-01", "news-two.example");
    const insights = await getCompanyInsights(x, db, NOW);
    expect(insights.regularSuppliers).toHaveLength(1);
    expect(insights.regularSuppliers[0]).toMatchObject({ companyId: y, name: "Example Pipe Mill", discipline: "pipeline", evidenceCount: 2 });
  });

  it("same publisher twice is not a regular supplier", async () => {
    const x = await company("Example EPC");
    const y = await company("Example Pipe Mill");
    await supplyEdge(x, y, "2025-05-01", "news-one.example");
    await supplyEdge(x, y, "2026-02-01", "news-one.example");
    expect((await getCompanyInsights(x, db, NOW)).regularSuppliers).toHaveLength(0);
  });

  it("edges older than 36 months don't count", async () => {
    const x = await company("Example EPC");
    const y = await company("Example Pipe Mill");
    await supplyEdge(x, y, "2022-01-01", "news-one.example");
    await supplyEdge(x, y, "2026-02-01", "news-two.example");
    expect((await getCompanyInsights(x, db, NOW)).regularSuppliers).toHaveLength(0);
  });

  it("typical subcontracted / self-performed packages need 2 projects; awards counted over 5 years", async () => {
    const x = await company("Example EPC");
    const sub = await company("Example Pipeline Sub");
    for (const [i, year] of [[1, 2023], [2, 2025]] as const) {
      const p = await project(`Old project ${i}`);
      await party(p, x, "main_epc", `${year}-01-01`);
      await db.query(
        "insert into relationships (from_company_id, to_company_id, type, project_id, discipline, event_date) values ($1, $2, 'subcontracted_to', $3, 'pipeline', $4)",
        [x, sub, p, `${year}-03-01`],
      );
      await db.query("insert into packages (project_id, discipline, name, package_owner_company_id) values ($1, 'civil_structural', 'Civil', $2)", [p, x]);
    }
    const old = await project("Ancient project");
    await party(old, x, "main_epc", "2019-01-01");
    const insights = await getCompanyInsights(x, db, NOW);
    expect(insights.typicalSubcontracted).toEqual(["pipeline"]);
    expect(insights.typicalSelfPerformed).toEqual(["civil_structural"]);
    expect(insights.awards5y).toBe(2);
    expect(insights.projects).toHaveLength(3);
  });
});

// ───────────────────────── end to end ─────────────────────────

describe("buildSignalsAndScore", () => {
  /** The worked example in the database: award (Tier A filing + Tier B article), package, requirement. */
  async function seedAward(opts: { sample?: boolean } = {}) {
    const runId = await run();
    const buyer = await company("Example Pipelines Construction Ltd");
    const proj = await project("Example Gas Trunk Pipeline");
    const pty = await party(proj, buyer, "main_epc", "2026-09-07");
    const pkg = await id(
      "insert into packages (project_id, discipline, name, value_usd, status) values ($1, 'pipeline', 'Line pipe supply', 200000000, 'planned') returning id",
      [proj],
    );
    const req = await id(
      `insert into requirements (package_id, item_category, client_product_id, spec, quantity, unit, delivery_port)
       values ($1, 'line pipe', 'prod-line-pipe', $2, 120, 'km', 'Mundra') returning id`,
      [pkg, JSON.stringify({ od_in: 24, grade: "X65", standard: "API 5L" })],
    );
    const evA = await ev(await doc(runId, "nseindia.example", "A", "2026-09-07", opts.sample), "nseindia.example", "A");
    const evB = await ev(await doc(runId, "pipelinejournal.example", "B", "2026-09-09", opts.sample), "pipelinejournal.example", "B");
    await link("project_party", pty, evA);
    await link("project_party", pty, evB);
    await link("project", proj, evA);
    await link("package", pkg, evB);
    await link("requirement", req, evB);
    return { runId, buyer, proj, pty, pkg, evA, evB };
  }

  it("creates the signal and a supply lead from the award (no history yet → research, 67)", async () => {
    const s = await seedAward();
    const result = await buildSignalsAndScore(s.runId, { db, now: NOW });
    expect(result).toEqual({ created: 1, updated: 0 });

    const signals = (await db.query<SignalRow>("select * from signals")).rows;
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ type: "contract_awarded", company_id: s.buyer, project_id: s.proj, run_id: s.runId });
    expect(signals[0].evidence_ids.sort()).toEqual([s.evA, s.evB].sort());

    const lead = (await db.query<LeadRow>("select * from leads")).rows[0];
    expect(lead).toMatchObject({ kind: "supply_subcontract", buyer_company_id: s.buyer, package_id: s.pkg, class: "research", confidence_band: "high", scoring_version: 1, is_sample: false, run_id: s.runId });
    expect(lead.confidence).toBe(0.955);
    // vs the 07 §10 example: 4.1 = 8 (IN supply lead, API 5L monogram held) but 3.3 unknown (no award history),
    // 2.3 = 3 (latest signal 20 days old) and 2.4 = 1 (no hiring signal) → 67, so Research.
    expect(lead.score).toBe(67);
    expect(lead.score_breakdown.unknown).toEqual(["2.2", "3.3", "5.2"]);
    expect(lead.score_breakdown.criteria).toHaveLength(5);
    expect(lead.gate_results.every((g) => g.pass)).toBe(true);
    expect(lead.reasons.length).toBe(3);
    expect(lead.client_product_ids).toEqual(["prod-line-pipe"]);
    const history = await db.query("select * from lead_score_history where lead_id = $1", [lead.id]);
    expect(history.rows).toHaveLength(1);
  });

  it("is idempotent: a re-run updates, and a new source adds evidence to the same signal", async () => {
    const s = await seedAward({ sample: true });
    await buildSignalsAndScore(s.runId, { db, now: NOW });
    const run2 = await run();
    const evC = await ev(await doc(run2, "other-news.example", "B", "2026-09-10", true), "other-news.example", "B");
    await link("project_party", s.pty, evC);
    const result = await buildSignalsAndScore(run2, { db, now: NOW });
    expect(result).toEqual({ created: 0, updated: 1 });
    const signals = (await db.query<SignalRow>("select * from signals")).rows;
    expect(signals).toHaveLength(1);
    expect(signals[0].evidence_ids).toHaveLength(3);
    const lead = (await db.query<LeadRow>("select * from leads")).rows[0];
    expect(lead.is_sample).toBe(true);
    expect((await db.query("select * from lead_score_history")).rows).toHaveLength(2);
  });

  it("rejects when the only source is a single-model Tier C fact (G5/G6)", async () => {
    const runId = await run();
    const buyer = await company("Example Rumour Builders");
    const proj = await project("Example Rumoured Pipeline");
    const pty = await party(proj, buyer, "main_epc", "2026-09-01");
    await db.query("insert into packages (project_id, discipline, name) values ($1, 'pipeline', 'Pipeline works')", [proj]);
    await link("project_party", pty, await ev(await doc(runId, "blog.example", "C", "2026-09-01"), "blog.example", "C", { agreement: "single" }));
    await buildSignalsAndScore(runId, { db, now: NOW });
    const lead = (await db.query<LeadRow>("select * from leads")).rows[0];
    expect(lead.class).toBe("rejected");
    expect(lead.gate_results.filter((g) => !g.pass).map((g) => g.id)).toEqual(["G5", "G6"]);
  });

  it("creates a bid lead from an open tender in projects.specs", async () => {
    const runId = await run(["bid"]);
    const owner = await company("Example Gas Authority");
    const e = await ev(await doc(runId, "eprocure.example", "A", "2026-09-20"), "eprocure.example", "A");
    const proj = await project("Example City Gas Network", {
      owner,
      stage: "epc_tender",
      specs: { tenders: [{ ref: "EGA/2026/7", closing_date: "2026-11-05", issue_date: "2026-09-20", status: "open", is_government: true, evidence_ids: [e] }] },
    });
    await link("project", proj, e);
    await db.query("insert into packages (project_id, discipline, name) values ($1, 'piping', 'Piping and valves')", [proj]);
    const result = await buildSignalsAndScore(runId, { db, now: NOW });
    expect(result.created).toBe(1);
    const lead = (await db.query<LeadRow>("select * from leads")).rows[0];
    expect(lead).toMatchObject({ kind: "bid", buyer_company_id: owner, tender_ref: "EGA/2026/7", closing_date: "2026-11-05" });
    expect(lead.gate_results.every((g) => g.pass)).toBe(true);
    const sub21 = lead.score_breakdown.criteria[1].subs.find((x) => x.id === "2.1");
    expect(sub21?.points).toBe(8);
  });

  it("predicts a supply lead from the contractor's typical subcontracted packages", async () => {
    const x = await company("Example EPC Holdings");
    const sub = await company("Example Sub");
    for (const [i, year] of [[1, 2024], [2, 2025]] as const) {
      const p = await project(`History ${i}`);
      await party(p, x, "main_epc", `${year}-01-01`);
      const rel = await id(
        "insert into relationships (from_company_id, to_company_id, type, project_id, discipline, event_date) values ($1, $2, 'subcontracted_to', $3, 'pipeline', $4) returning id",
        [x, sub, p, `${year}-02-01`],
      );
      await link("relationship", rel, await ev(await doc(null, `hist${i}.example`, "B", `${year}-02-01`), `hist${i}.example`, "B"));
    }
    const runId = await run(["supply_subcontract"]);
    const proj = await project("Example New Refinery Line");
    const pty = await party(proj, x, "main_epc", "2026-09-15");
    await link("project_party", pty, await ev(await doc(runId, "exchange.example", "A", "2026-09-15"), "exchange.example", "A"));

    const result = await buildSignalsAndScore(runId, { db, now: NOW });
    expect(result.created).toBe(1);
    const pkg = (await db.query<{ id: string; status: string; discipline: string }>("select id, status, discipline from packages where project_id = $1", [proj])).rows;
    expect(pkg).toEqual([expect.objectContaining({ status: "planned", discipline: "pipeline" })]);
    const lead = (await db.query<LeadRow>("select * from leads")).rows[0];
    expect(lead.package_id).toBe(pkg[0].id);
    const prov = await db.query("select * from fact_evidence where entity_type = 'package' and entity_id = $1", [pkg[0].id]);
    expect(prov.rows.length).toBe(3); // award + 2 history edges
  });
});
