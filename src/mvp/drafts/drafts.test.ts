// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { countWords, generateDraft, limitWords, OPT_OUT_LINE, templateDraft } from "./index";

const KEYS = ["GROQ_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
}, 120_000);

afterAll(async () => {
  setDbForTests(undefined);
  await db?.close();
});

beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

async function id(sql: string, params: unknown[] = []): Promise<string> {
  return (await db.query<{ id: string }>(sql, params)).rows[0].id;
}

async function seedLead(country: string) {
  const buyer = await id(
    "insert into companies (canonical_name, normalized_name, country) values ($1, lower($1), $2) returning id",
    [`Example Contractor ${country} ${Math.random().toString(36).slice(2, 6)}`, country],
  );
  const project = await id("insert into projects (name, normalized_name, country) values ('Example Gas Trunk Pipeline', 'x', $1) returning id", [country]);
  await db.query("insert into project_parties (project_id, company_id, role, award_date) values ($1, $2, 'main_epc', '2026-09-07')", [project, buyer]);
  const pkg = await id("insert into packages (project_id, discipline, name) values ($1, 'pipeline', 'Line pipe supply') returning id", [project]);
  await db.query(
    "insert into requirements (package_id, item_category, spec, quantity, unit, delivery_port) values ($1, 'line pipe', $2, 120, 'km', 'Mundra')",
    [pkg, JSON.stringify({ od_in: 24, grade: "X65" })],
  );
  const lead = await id(
    `insert into leads (kind, buyer_company_id, project_id, package_id, client_product_ids, score_breakdown, gate_results, class, reasons, scoring_version)
     values ('supply_subcontract', $1, $2, $3, '{prod-line-pipe}', '{}', '[]', 'genuine', '[]', 1) returning id`,
    [buyer, project, pkg],
  );
  return { buyer, project, pkg, lead };
}

describe("generateDraft", () => {
  it("is blocked for a Saudi contact (consent_needed) without calling AI", async () => {
    const { lead, buyer } = await seedLead("SA");
    const person = await id(
      "insert into people (full_name, normalized_name, current_company_id, country, title) values ('Example Person', 'example person', $1, 'SA', 'Procurement Manager') returning id",
      [buyer],
    );
    const draft = await generateDraft(lead, person);
    expect(draft.blockedReason).toMatch(/consent needed/);
    expect(draft.subject).toBe("");
    expect(draft.body).toBe("");
    const row = (await db.query<{ blocked_reason: string | null; body: string | null }>("select blocked_reason, body from outreach_drafts where id = $1", [draft.id])).rows[0];
    expect(row.blocked_reason).toBe(draft.blockedReason);
    expect(row.body).toBeNull();
    const usage = await db.query("select * from llm_usage");
    expect(usage.rows).toHaveLength(0);
  });

  it("drafts from lead facts for India with an opt-out line, ≤ 120 words", async () => {
    const { lead } = await seedLead("IN");
    const draft = await generateDraft(lead, null);
    expect(draft.blockedReason).toBeUndefined();
    expect(draft.subject).toContain("Example Gas Trunk Pipeline");
    expect(draft.body).toContain("24-inch X65 line pipe");
    expect(draft.body).toContain("Mundra");
    expect(draft.body).toContain("7 Sep 2026");
    expect(draft.body.endsWith(OPT_OUT_LINE)).toBe(true);
    expect(countWords(draft.body.replace(OPT_OUT_LINE, ""))).toBeLessThanOrEqual(120);
    const activity = await db.query("select * from activities where lead_id = $1 and type = 'email_draft'", [lead]);
    expect(activity.rows).toHaveLength(1);
  });

  it("allows a company-level draft in Norway (generic address, opt-out) but blocks a named person", async () => {
    const { lead, buyer } = await seedLead("NO");
    const company = await generateDraft(lead, null);
    expect(company.blockedReason).toBeUndefined();
    expect(company.body.endsWith(OPT_OUT_LINE)).toBe(true);
    const person = await id(
      "insert into people (full_name, normalized_name, current_company_id, title) values ('Example Nordic', 'example nordic', $1, 'Buyer') returning id",
      [buyer],
    );
    const named = await generateDraft(lead, person);
    expect(named.blockedReason).toMatch(/consent needed/);
  });

  it("uses the contact's company country, not the project market (German EPC on an Indian project)", async () => {
    const { lead } = await seedLead("IN");
    const epc = await id("insert into companies (canonical_name, normalized_name, country) values ('Example EPC GmbH', 'example epc gmbh', 'DE') returning id");
    const person = await id(
      "insert into people (full_name, normalized_name, current_company_id, title) values ('Example Manager', 'example manager', $1, 'Manager') returning id",
      [epc],
    );
    const draft = await generateDraft(lead, person);
    expect(draft.blockedReason).toMatch(/DE is consent needed/);
  });

  it("applies the strictest rule when the contact's country is unknown", async () => {
    const { lead } = await seedLead("IN");
    const nowhere = await id("insert into companies (canonical_name, normalized_name) values ('Example Unknown Co', 'example unknown co') returning id");
    await db.query("update leads set buyer_company_id = $1 where id = $2", [nowhere, lead]);
    const person = await id(
      "insert into people (full_name, normalized_name, current_company_id) values ('Example Nobody', 'example nobody', $1) returning id",
      [nowhere],
    );
    expect((await generateDraft(lead, person)).blockedReason).toMatch(/consent needed/);
  });

  it("falls back to the template when the live model call fails", async () => {
    process.env.GROQ_API_KEY = "test-key-not-real";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    const { lead } = await seedLead("IN");
    const draft = await generateDraft(lead, null);
    expect(draft.blockedReason).toBeUndefined();
    expect(draft.subject).toContain("Example Gas Trunk Pipeline");
    expect(draft.body.endsWith(OPT_OUT_LINE)).toBe(true);
    const row = (await db.query<{ model: string }>("select model from outreach_drafts where id = $1", [draft.id])).rows[0];
    expect(row.model).toMatch(/^template \(fallback from groq/);
  });

  it("throws for unknown leads", async () => {
    await expect(generateDraft("00000000-0000-4000-8000-000000000000", null)).rejects.toThrow("Lead not found");
  });
});

describe("draft helpers", () => {
  it("limitWords keeps at most 120 words", () => {
    const long = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    expect(countWords(limitWords(long))).toBeLessThanOrEqual(120);
  });
  it("template only uses given facts", () => {
    const { subject, body } = templateDraft({
      clientName: "Example Co (example - replace with client data)",
      clientProducts: ["Line pipe"],
      buyerName: "Buyer",
      projectName: null,
      projectCountry: null,
      packageName: null,
      discipline: null,
      awardDate: null,
      awardRole: null,
      requirement: null,
      deliveryPlace: null,
      contactName: null,
      contactTitle: null,
      kind: "supply_subcontract",
      closingDate: null,
      tenderRef: null,
    });
    expect(subject).toBe("Buyer: project");
    expect(body).not.toMatch(/undefined|null/);
    expect(body).toContain("Example Co supplies Line pipe");
  });
});
