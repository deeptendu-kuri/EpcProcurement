// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";

vi.mock("@/mvp/compliance", () => ({
  bidChecklist: vi.fn(async () => [
    { ruleKey: "IN_GEM_CPPP_REG", title: "GeM registration", status: "met", hard: true, note: "", sourceUrl: "https://gem.gov.in" },
  ]),
  contactCountry: (a: string | null, b: string | null, c: string | null) => a || b || c || null,
  outreachRules: vi.fn((country: string) => ({
    country,
    email: country === "SA" ? "consent_needed" : "opt_out_only",
    phone: "consent_needed",
    steps: ["Include opt-out"],
    sourceUrl: "",
  })),
}));
vi.mock("@/mvp/scoring/graph", () => ({
  getCompanyInsights: vi.fn(async (companyId: string) => ({
    companyId,
    awards5y: 1,
    sectors: ["oil_gas"],
    countries: ["IN"],
    regularSuppliers: [],
    regularPartners: [],
    typicalSubcontracted: [],
    typicalSelfPerformed: [],
    projects: [],
  })),
}));

import { addActivity, getLeadDetail, getRun, leadEvidenceUrls, listLeads, listRecentRuns, updateDraft, updateLead } from "./repo";

let db: Db;
const ids: Record<string, string> = {};

async function one<T = { id: string }>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

const breakdown = {
  criteria: [
    { id: "C1", label: "Scope fit", max: 25, total: 16, subs: [{ id: "1.1", label: "Discipline match", max: 10, points: 10, reason: "Pipeline", evidenceIds: [] }] },
  ],
  unknown: ["2.2"],
};

async function insertLead(opts: { kind: string; cls: string; score: number; projectId: string | null; packageId: string | null; status?: string; products?: string[]; reasons?: unknown[] }) {
  return one(
    `insert into leads (kind, buyer_company_id, project_id, package_id, client_product_ids, signal_ids, score, score_breakdown,
                        gate_results, confidence, confidence_band, class, reasons, status, scoring_version, is_sample, run_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0.9, 'high', $10, $11, $12, 1, true, $13) returning id`,
    [
      opts.kind, ids.buyer, opts.projectId, opts.packageId, opts.products ?? ["prod-line-pipe"], [ids.signal], opts.score,
      JSON.stringify(breakdown), JSON.stringify([{ id: "G4", pass: opts.cls !== "rejected", why: "Project completed in 2024" }]),
      opts.cls, JSON.stringify(opts.reasons ?? [{ text: "EPC contract awarded", evidenceIds: [ids.evidence] }]), opts.status ?? "new", ids.run,
    ],
  );
}

beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
  ids.run = (await one("insert into runs (adhoc_query, status) values ($1, 'running') returning id", [JSON.stringify({ query: "line pipe", markets: ["IN"], leadKinds: ["bid"] })])).id;
  await db.query("insert into run_events (run_id, stage, message) values ($1, 'collect', 'Collecting'), ($1, 'read', 'Reading')", [ids.run]);
  ids.doc = (await one(
    `insert into source_documents (source_key, source_name, tier, publisher_key, url, canonical_url, content_hash, is_sample)
     values ('fixture', 'Example Wire', 'B', 'example.com', 'https://example.com/a', 'https://example.com/a', 'h1', true) returning id`,
  )).id;
  ids.evidence = (await one(
    `insert into evidence (document_id, url, quote, extracted_by, quote_verified, agreement, tier, publisher_key)
     values ($1, 'https://example.com/a', 'won the EPC contract', 'rule:award', true, 'rule', 'B', 'example.com') returning id`,
    [ids.doc],
  )).id;
  ids.buyer = (await one("insert into companies (canonical_name, normalized_name, country) values ('Example EPC Ltd', 'example epc', 'IN') returning id")).id;
  ids.owner = (await one("insert into companies (canonical_name, normalized_name, country) values ('Example Gas Co', 'example gas', 'IN') returning id")).id;
  ids.project = (await one(
    "insert into projects (name, normalized_name, owner_company_id, country, current_stage) values ('Example Pipeline Phase 2', 'x', $1, 'IN', 'awarded') returning id",
    [ids.owner],
  )).id;
  ids.project2 = (await one("insert into projects (name, normalized_name, country) values ('Example Water Line', 'y', 'SA') returning id")).id;
  ids.package = (await one(
    "insert into packages (project_id, discipline, name, package_owner_company_id) values ($1, 'pipeline', 'Line pipe package', $2) returning id",
    [ids.project, ids.buyer],
  )).id;
  await db.query("insert into requirements (package_id, item_category, client_product_id, spec, quantity, unit) values ($1, 'line pipe', 'prod-line-pipe', $2, 120, 'km')", [ids.package, JSON.stringify({ grade: "X65", od_in: 24 })]);
  await db.query("insert into project_parties (project_id, company_id, role) values ($1, $2, 'main_epc'), ($1, $3, 'owner')", [ids.project, ids.buyer, ids.owner]);
  ids.stage = (await one("insert into project_stage_events (project_id, stage, event_date, evidence_id) values ($1, 'awarded', '2026-09-12', $2) returning id", [ids.project, ids.evidence])).id;
  ids.person = (await one("insert into people (full_name, normalized_name, current_company_id, title, country) values ('R. Example', 'r example', $1, 'Procurement Manager', 'SA') returning id", [ids.buyer])).id;
  await db.query("insert into person_roles (person_id, company_id, project_id, buying_role) values ($1, $2, $3, 'procurement_lead')", [ids.person, ids.buyer, ids.project]);
  await db.query("insert into fact_evidence (entity_type, entity_id, field, evidence_id) values ('project_party', (select id from project_parties where role = 'main_epc'), '*', $1)", [ids.evidence]);
  ids.signal = (await one(
    "insert into signals (type, signal_date, company_id, project_id, summary, fingerprint, evidence_ids) values ('contract_awarded', '2026-09-12', $1, $2, 'Award', 'fp1', $3) returning id",
    [ids.buyer, ids.project, [ids.evidence]],
  )).id;

  ids.genuine = (await insertLead({ kind: "supply_subcontract", cls: "genuine", score: 86, projectId: ids.project, packageId: ids.package })).id;
  ids.genuine2 = (await insertLead({ kind: "bid", cls: "genuine", score: 72, projectId: ids.project, packageId: null, products: ["prod-valves"] })).id;
  ids.research = (await insertLead({ kind: "bid", cls: "research", score: 60, projectId: ids.project2, packageId: null })).id;
  ids.rejected = (await insertLead({ kind: "supply_subcontract", cls: "rejected", score: 40, projectId: ids.project2, packageId: null })).id;
}, 120_000);

afterAll(async () => {
  setDbForTests(undefined);
  await db?.close();
});

describe("listLeads", () => {
  it("sorts by score, counts per class and maps display fields", async () => {
    const result = await listLeads({ class: "genuine" });
    expect(result.items.map((item) => item.score)).toEqual([86, 72]);
    expect(result.counts).toEqual({ genuine: 2, research: 1, watch: 0, rejected: 1 });
    const first = result.items[0];
    expect(first.buyerName).toBe("Example EPC Ltd");
    expect(first.projectName).toBe("Example Pipeline Phase 2");
    expect(first.packageName).toBe("Line pipe package");
    expect(first.productNames).toEqual(["Carbon steel line pipe (API 5L)"]);
    expect(first.isSample).toBe(true);
    expect(first.reasons[0].text).toBe("EPC contract awarded");
  });

  it("filters by market, product, kind and run", async () => {
    expect((await listLeads({ market: "SA" })).items.map((i) => i.id).sort()).toEqual([ids.research, ids.rejected].sort());
    expect((await listLeads({ productId: "prod-valves" })).items.map((i) => i.id)).toEqual([ids.genuine2]);
    expect((await listLeads({ kind: "bid", class: "genuine" })).items.map((i) => i.id)).toEqual([ids.genuine2]);
    expect((await listLeads({ runId: ids.run })).items).toHaveLength(4);
    expect((await listLeads({ limit: 1, offset: 1 })).items).toHaveLength(1);
  });

  it("returns evidence URLs per lead for the export", async () => {
    const urls = await leadEvidenceUrls([ids.genuine]);
    expect(urls[ids.genuine]).toEqual(["https://example.com/a"]);
  });
});

describe("getLeadDetail", () => {
  it("returns null for unknown or malformed ids", async () => {
    expect(await getLeadDetail("not-a-uuid")).toBeNull();
    expect(await getLeadDetail("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("assembles project, supply chain, people, evidence and compliance", async () => {
    const detail = (await getLeadDetail(ids.genuine))!;
    expect(detail.buyer.canonical_name).toBe("Example EPC Ltd");
    expect(detail.projectOwner?.canonical_name).toBe("Example Gas Co");
    expect(detail.stageEvents.map((e) => e.stage)).toEqual(["awarded"]);
    expect(detail.packages[0].owner?.id).toBe(ids.buyer);
    expect(detail.packages[0].requirements[0].spec).toEqual({ grade: "X65", od_in: 24 });
    expect(detail.parties.map((p) => p.company?.canonical_name).sort()).toEqual(["Example EPC Ltd", "Example Gas Co"]);
    expect(detail.people[0].companyName).toBe("Example EPC Ltd");
    expect(detail.people[0].roles[0].buying_role).toBe("procurement_lead");
    expect(detail.compliance.outreach[0]).toMatchObject({ personId: ids.person, country: "SA" });
    expect(detail.compliance.bid).toHaveLength(1);
    expect(detail.evidence[ids.evidence]).toMatchObject({ quote: "won the EPC contract", sourceName: "Example Wire", isSample: true });
    expect(detail.signals.map((s) => s.id)).toContain(ids.signal);
    expect(detail.breakdown.unknown).toEqual(["2.2"]);
    expect(detail.buyerInsights?.awards5y).toBe(1);
  });
});

describe("writes", () => {
  it("updates the status, records a status change and clears the reject reason on reopen", async () => {
    const rejected = await updateLead(ids.genuine2, { status: "rejected", reject_reason: "too_small" });
    expect(rejected).toMatchObject({ status: "rejected", reject_reason: "too_small" });
    expect(rejected?.updated_at).toBeTruthy();
    const reopened = await updateLead(ids.genuine2, { status: "accepted" });
    expect(reopened).toMatchObject({ status: "accepted", reject_reason: null });
    const { rows } = await db.query<{ type: string; body: string }>("select type, body from activities where lead_id = $1 order by created_at", [ids.genuine2]);
    expect(rows.map((r) => r.body)).toEqual(["new → rejected (too_small)", "rejected → accepted"]);
    expect(await updateLead("00000000-0000-4000-8000-000000000000", { status: "accepted" })).toBeNull();
  });

  it("does not record a status change when only the next step changes", async () => {
    await updateLead(ids.research, { next_action: "Call procurement" });
    const { rows } = await db.query("select * from activities where lead_id = $1", [ids.research]);
    expect(rows).toHaveLength(0);
  });

  it("adds notes and marks drafts as sent", async () => {
    const note = await addActivity({ leadId: ids.genuine, type: "note", body: "Spoke to the buyer" });
    expect(note.type).toBe("note");
    const draft = await one("insert into outreach_drafts (lead_id, person_id, subject, body) values ($1, $2, 'Hi', 'Body') returning id", [ids.genuine, ids.person]);
    const sent = await updateDraft(draft.id, { body: "Edited", status: "sent_externally" });
    expect(sent).toMatchObject({ body: "Edited", subject: "Hi", status: "sent_externally" });
    const { rows } = await db.query<{ type: string }>("select type from activities where lead_id = $1 and type = 'email_sent'", [ids.genuine]);
    expect(rows).toHaveLength(1);
  });

  it("refuses to mark a blocked draft as sent", async () => {
    const draft = await one("insert into outreach_drafts (lead_id, blocked_reason) values ($1, 'Consent needed') returning id", [ids.genuine]);
    await expect(updateDraft(draft.id, { status: "sent_externally" })).rejects.toThrow("Consent needed");
  });
});

describe("runs", () => {
  it("returns a run with events after a cursor and lists recent runs", async () => {
    const run = (await getRun(ids.run))!;
    expect(run.events.map((e) => e.stage)).toEqual(["collect", "read"]);
    const later = (await getRun(ids.run, run.events[0].id))!;
    expect(later.events.map((e) => e.stage)).toEqual(["read"]);
    expect(run.adhoc_query?.query).toBe("line pipe");
    expect((await listRecentRuns(5))[0].id).toBe(ids.run);
    expect(await getRun("nope")).toBeNull();
  });
});
