// @vitest-environment node
/**
 * News award articles → leads (docs/mvp/07 §1, §2, §3 G5). A trade-press award report names the
 * awardee, the client and the scope but often no project and no package; the pipeline must still
 * build project + party + package + signal, and the lead must land in Needs research (one source)
 * rather than Rejected.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { buildSignalsAndScore } from "@/mvp/scoring";
import type { GateResult, LeadRow } from "@/mvp/types";
import { adoptRuleFacts, checkAndAgree, deriveFromAward, extractDocument, tidyCompanyName } from "./extract";
import { headlineCase, isParentMention, rulesP1 } from "./rules-extract";
import { companyKeys, companyNameParts, displayCompanyName } from "./text";
import { storeDocument } from "./read";
import { resolveDocument } from "./resolve";
import { EMPTY_P2, EMPTY_P3, type P1Output } from "./schemas";

const NOW = new Date("2026-09-27T09:00:00Z");
const KEYS = ["MVP_OFFLINE", "GROQ_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
  for (const key of KEYS) delete process.env[key]; // demo mode: the rules extractor answers
}, 120_000);

afterAll(async () => {
  setDbForTests(undefined);
  await db?.close();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const AWARD = [
  "Desco Infratech secures Rs 62 crore gas pipeline contract from Adani Total Gas",
  "Desco Infratech Ltd has secured a contract worth Rs 62 crore from Adani Total Gas Ltd for laying of steel gas pipelines in Ahmedabad, Gujarat.",
  "The scope includes supply of 12-inch API 5L X52 line pipe, 40 km, delivered to Mundra port.",
].join("\n");

const ORDER = [
  "East Pipes Integrated Company secures SAR 46 million steel pipes order from Saudi Aramco",
  "East Pipes Integrated Company for Industry said it signed the order with Saudi Aramco for water transmission pipes in the Eastern Province.",
].join("\n");

async function ingest(text: string, url: string, publisherKey: string, market: string, daysAgo = 3) {
  const { rows } = await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', $1::jsonb) returning id", [
    JSON.stringify({ query: "pipeline", markets: ["IN", "SA", "AE", "MY"], leadKinds: ["bid", "supply_subcontract"] }),
  ]);
  const runId = rows[0].id;
  const publishedAt = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  const raw = { sourceKey: "bing:test", sourceName: "News · test", tier: "B" as const, publisherKey, url, title: text.split("\n")[0], publishedAt, text, language: "en", isSample: false };
  const stored = await storeDocument(db, runId, raw);
  const ex = await extractDocument({ text: stored.text, url }, { db, runId });
  await db.tx((tx) => resolveDocument(tx, { documentId: stored.id, url, tier: "B", publisherKey, market, publishedAt, text: stored.text }, ex));
  await buildSignalsAndScore(runId, { db, now: NOW });
  return { runId, ex };
}

async function leadsFor(buyer: string): Promise<(LeadRow & { buyer: string; project: string })[]> {
  return (
    await db.query<LeadRow & { buyer: string; project: string }>(
      `select l.*, c.canonical_name as buyer, p.name as project from leads l
         join companies c on c.id = l.buyer_company_id left join projects p on p.id = l.project_id
        where c.canonical_name ilike $1`,
      [`%${buyer}%`],
    )
  ).rows;
}

describe("news award → candidate → lead", () => {
  beforeEach(async () => {
    await db.exec("truncate runs, source_documents, evidence, fact_evidence, companies, projects, signals, leads cascade");
  });

  it("an EPC award with no named project yields project, owner, awardee role, package, signal and a Needs-research lead", async () => {
    const { ex } = await ingest(AWARD, "https://news-one.example/desco-award", "news-one.example", "IN");
    expect(ex.project.stage).toBe("awarded");
    expect(ex.project.name?.value).toBe("Adani Total Gas pipeline contract – Desco Infratech");
    expect(ex.companies.find((c) => c.name.value === "Desco Infratech")?.role).toBe("main_epc");
    expect(ex.companies.find((c) => c.name.value === "Adani Total Gas")?.role).toBe("owner");

    const project = (await db.query<{ name: string; country: string; current_stage: string; owner: string }>(
      "select p.name, p.country, p.current_stage, c.canonical_name as owner from projects p join companies c on c.id = p.owner_company_id",
    )).rows;
    expect(project).toEqual([{ name: "Adani Total Gas pipeline contract – Desco Infratech", country: "IN", current_stage: "awarded", owner: "Adani Total Gas" }]);
    const packages = (await db.query<{ discipline: string; owner: string }>(
      "select k.discipline, c.canonical_name as owner from packages k join companies c on c.id = k.package_owner_company_id",
    )).rows;
    expect(packages).toContainEqual({ discipline: "pipeline", owner: "Desco Infratech" });
    const signals = (await db.query<{ type: string; signal_date: string }>("select type, signal_date from signals")).rows;
    expect(signals).toContainEqual({ type: "contract_awarded", signal_date: "2026-09-24" });

    const leads = await leadsFor("Desco");
    expect(leads).toHaveLength(1);
    const lead = leads[0];
    expect(lead.kind).toBe("supply_subcontract");
    expect(lead.class).toBe("research");
    const failed = (lead.gate_results as (GateResult & { cap?: string })[]).filter((g) => !g.pass);
    expect(failed).toEqual([expect.objectContaining({ id: "G5", cap: "research" })]);
    expect(lead.reasons[0].text).toMatch(/find a second independent source/);
  });

  it("a second independent publisher corroborates the same award: one project, G5 passes, class rises", async () => {
    await ingest(AWARD, "https://news-one.example/desco-award", "news-one.example", "IN", 3);
    await ingest(AWARD.replace("Desco Infratech Ltd has secured", "Desco Infratech Ltd has bagged"), "https://news-two.example/desco", "news-two.example", "IN", 2);
    expect((await db.query("select id from projects")).rows).toHaveLength(1);
    const [lead] = await leadsFor("Desco");
    const g5 = (lead.gate_results as GateResult[]).find((g) => g.id === "G5")!;
    expect(g5.pass).toBe(true);
    expect(g5.why).toMatch(/2 independent sources/);
    expect(["research", "genuine"]).toContain(lead.class);
    expect(lead.class).not.toBe("rejected");
  });

  it("a supply order ('S bags order from Z') yields supplied_by and a supply lead for the buyer", async () => {
    const { ex } = await ingest(ORDER, "https://news-three.example/east-pipes", "news-three.example", "SA");
    expect(ex.companies.find((c) => c.name.value === "East Pipes Integrated Company")?.role).toBe("supplier");
    const edges = (await db.query<{ from_c: string; to_c: string; type: string }>(
      `select a.canonical_name as from_c, b.canonical_name as to_c, r.type from relationships r
         join companies a on a.id = r.from_company_id join companies b on b.id = r.to_company_id`,
    )).rows;
    expect(edges).toContainEqual({ from_c: "Saudi Aramco", to_c: "East Pipes Integrated Company", type: "supplied_by" });
    const signals = (await db.query<{ type: string }>("select type from signals")).rows.map((s) => s.type);
    expect(signals).toContain("supply_order_announced");
    const leads = await leadsFor("Aramco");
    expect(leads.length).toBeGreaterThanOrEqual(1);
    expect(leads[0].kind).toBe("supply_subcontract");
    expect(leads[0].class).not.toBe("rejected");
  });
});

describe("model disagreement on the awardee role", () => {
  const text = "INOX India bags first orbital welding order, to work on piping at Tata Electronics' Dholera chip facility.";
  const company = (role: string) => ({ name: { value: "INOX India", quote: "INOX India bags first orbital welding order" }, role, role_quote: text, country: null });
  const p1 = (role: string): P1Output => ({ project_name: null, stage: "unknown", stage_quote: null, companies: [company(role)] as P1Output["companies"] });

  it("supplier vs main_epc is settled by the award sentence instead of dropping the role", () => {
    const ex = checkAndAgree(text, {
      a: { p1: p1("supplier"), p2: EMPTY_P2, p3: EMPTY_P3 },
      b: { p1: p1("main_epc"), p2: EMPTY_P2, p3: EMPTY_P3 },
      mode: "compare",
      extractedBy: "model:test",
    });
    expect(ex.companies[0].role).toBe("main_epc");
    expect(ex.companies[0].roleFact?.agreement).toBe("both");
    const derived = deriveFromAward(ex, text);
    expect(derived.project.stage).toBe("awarded");
    expect(derived.packages).toEqual([expect.objectContaining({ discipline: "piping", owner: expect.objectContaining({ value: "INOX India" }) })]);
  });

  it("a real dispute (owner vs main_epc) still drops the role", () => {
    const ex = checkAndAgree(text, {
      a: { p1: p1("owner"), p2: EMPTY_P2, p3: EMPTY_P3 },
      b: { p1: p1("main_epc"), p2: EMPTY_P2, p3: EMPTY_P3 },
      mode: "compare",
      extractedBy: "model:test",
    });
    expect(ex.companies[0].role).toBe("unknown");
  });
});

describe("rules extractor on news headlines (07 §2)", () => {
  const roles = (text: string) => Object.fromEntries(rulesP1(text).companies.map((c) => [c.name?.value, c.role]));

  it("reads Title Case market-news headlines", () => {
    const t = "Desco Infratech In Focus After Securing Rs2.34 Crore Gas Pipeline Contract From Adani Total Gas";
    expect(headlineCase(t)).toHaveLength(t.length);
    expect(roles(t)).toEqual({ "Desco Infratech": "main_epc", "Adani Total Gas": "owner" });
    expect(rulesP1(t).stage).toBe("awarded");
  });

  it("reads decimal amounts and market-news fillers", () => {
    expect(roles("Man Industries shares surge 10% on securing Rs 600.5 crore pipe orders from GAIL")).toEqual({ "Man Industries": "supplier", GAIL: "unknown" });
    expect(roles("Welspun Corp's associate firm wins ₹2,000 crore steel pipe contract from Aramco")).toEqual({});
    expect(roles("Jindal SAW bags Rs 1,200 crore order for supply of line pipes.")).toEqual({ "Jindal SAW": "supplier" });
  });

  it("model facts missed by the models are added from the rules, labelled rule", () => {
    const t = "Desco Infratech In Focus After Securing Rs2.34 Crore Gas Pipeline Contract From Adani Total Gas";
    const model = checkAndAgree(t, {
      a: {
        p1: { project_name: null, stage: "unknown", stage_quote: null, companies: [{ name: { value: "Desco Infratech", quote: "Desco Infratech In Focus" }, role: "unknown", role_quote: null, country: null }] } as P1Output,
        p2: EMPTY_P2,
        p3: EMPTY_P3,
      },
      b: null,
      mode: "single",
      extractedBy: "model:test",
    });
    const ex = deriveFromAward(adoptRuleFacts(model, rulesP1(t), t), t);
    expect(ex.companies.map((c) => [c.name.value, c.role, c.roleFact?.agreement])).toEqual([
      ["Desco Infratech", "main_epc", "rule"],
      ["Adani Total Gas", "owner", "rule"],
    ]);
    expect(ex.project.stage).toBe("awarded");
    expect(ex.project.name?.value).toBe("Adani Total Gas pipeline contract – Desco Infratech");
    expect(ex.packages[0]).toMatchObject({ discipline: "pipeline", owner: { value: "Desco Infratech" } });
  });
});

describe("rules extractor: signed supply orders", () => {
  it("'S signs … pipes order from/with Z' makes S a supplier and names Z", () => {
    const names = (t: string) => rulesP1(t).companies.map((c) => [c.name?.value, c.role]);
    expect(names("East Pipes Integrated Co for Industry Signs SAR46 Million Steel Pipes Order from Saudi Aramco")).toEqual([
      ["East Pipes Integrated Co for Industry", "supplier"],
      ["Saudi Aramco", "unknown"],
    ]);
    expect(names("East Pipes signs $12.27 million contract with Saudi Aramco for steel pipes.")[1]).toEqual(["Saudi Aramco", "unknown"]);
  });
});

describe("company name hygiene", () => {
  it("strips run-together datelines and drops bare place names", () => {
    expect(tidyCompanyName("Wednesday.GMDA")).toBe("GMDA");
    expect(tidyCompanyName("UAE")).toBeNull();
    expect(tidyCompanyName("Saudi Arabia")).toBeNull();
    expect(tidyCompanyName("Saudi Aramco")).toBe("Saudi Aramco");
    expect(tidyCompanyName("Dubai Electricity and Water Authority")).toBe("Dubai Electricity and Water Authority");
  });
});

describe("buyer names on the rules / award path (live-run findings)", () => {
  it("drops a place name returned as the buyer and strips datelines in rules output", () => {
    const uae = rulesP1("UAE awards contract for new jet fuel pipeline to Emarat Engineering.");
    expect(uae.companies.map((c) => c.name?.value)).toEqual(["Emarat Engineering"]);
    const gmda = rulesP1("Wednesday.GMDA awards contract for 200MLD water pipeline to Larsen Infra Projects.");
    expect(Object.fromEntries(gmda.companies.map((c) => [c.name?.value, c.role]))).toEqual({ GMDA: "owner", "Larsen Infra Projects": "main_epc" });
    expect(tidyCompanyName("UAE's Emarat")).toBe("Emarat");
    expect(tidyCompanyName("Dubai-based Emarat")).toBe("Emarat");
  });

  it("the award → lead conversion never names a place or a dateline as buyer or project client", async () => {
    await db.exec("truncate runs, source_documents, evidence, fact_evidence, companies, projects, signals, leads cascade");
    const text = "Wednesday.GMDA awards contract for 200MLD water pipeline to Larsen Infra Projects.\nThe water pipeline will serve areas along the Dwarka Expressway.";
    const { ex } = await ingest(text, "https://news-gmda.example/gmda", "news-gmda.example", "IN");
    expect(ex.companies.map((c) => c.name.value)).not.toContain("Wednesday.GMDA");
    expect(ex.project.name?.value).toMatch(/^GMDA /);
    const uae = await ingest("UAE awards contract for new jet fuel pipeline to Emarat Engineering.", "https://news-uae.example/uae", "news-uae.example", "AE");
    expect(uae.ex.companies.map((c) => c.name.value)).not.toContain("UAE");
    const names = (await db.query<{ canonical_name: string }>("select canonical_name from companies")).rows.map((r) => r.canonical_name);
    expect(names).not.toContain("UAE");
    expect(names).not.toContain("Wednesday.GMDA");
  });
});

describe("entity resolution: aliases, project country, parent companies", () => {
  beforeEach(async () => {
    await db.exec("truncate runs, source_documents, evidence, fact_evidence, companies, projects, signals, leads cascade");
  });

  it("parses 'X (Y)' and 'X, or Y' aliases and well-known groups", () => {
    expect(companyNameParts("Saudi Arabian Oil Co. (Saudi Aramco)")).toEqual({ main: "Saudi Arabian Oil Co.", aliases: ["Saudi Aramco"] });
    expect(companyNameParts("East Pipes Integrated Company for Industry, or EPIC")).toEqual({ main: "East Pipes Integrated Company for Industry", aliases: ["EPIC"] });
    expect(displayCompanyName("East Pipes Integrated Company for Industry, or EPIC")).toBe("East Pipes Integrated Company for Industry (EPIC)");
    const keys = (n: string) => companyKeys(n).keys;
    expect(keys("Aramco")).toContain("known:aramco");
    expect(keys("Saudi Arabian Oil Co. (Saudi Aramco)")).toContain("known:aramco");
    expect(keys("East Pipes Integrated Company for Industry (EPIC)")).toContain("epic");
  });

  it("merges Aramco / Saudi Aramco / Saudi Arabian Oil Co. (Saudi Aramco) and EPIC variants into one company each", async () => {
    await ingest(
      "East Pipes Integrated Company for Industry, or EPIC, signs SAR 46 million steel pipes order with Saudi Arabian Oil Co. (Saudi Aramco).",
      "https://argaam.example/epic", "argaam.example", "SA",
    );
    await ingest("EPIC bags Rs 2,000 crore steel pipe order from Aramco.", "https://indian-paper.example/epic", "indian-paper.example", "IN");
    const companies = (await db.query<{ canonical_name: string; country: string }>("select canonical_name, country from companies order by canonical_name")).rows;
    const aramco = companies.filter((c) => /aramco/i.test(c.canonical_name));
    const epic = companies.filter((c) => /epic|east pipes/i.test(c.canonical_name));
    expect(aramco).toHaveLength(1);
    expect(aramco[0].country).toBe("SA");
    expect(epic).toHaveLength(1);
    expect(epic[0].canonical_name).toBe("East Pipes Integrated Company for Industry (EPIC)");
  });

  it("takes the project country from the award sentence, not the publisher's market", async () => {
    await ingest("EPIC bags Rs 2,000 crore steel pipe order from Saudi Aramco.", "https://indian-paper.example/epic-2", "indian-paper.example", "IN");
    const projects = (await db.query<{ country: string }>("select country from projects")).rows;
    expect(projects).toEqual([{ country: "SA" }]);
  });

  it("the parent of the awarded unit is not the buyer of the order", () => {
    expect(isParentMention("Welspun Corp's US unit Welspun Tubular LLC wins $412 million pipe supply order from Kinder Morgan", "Welspun Corp")).toBe(true);
    expect(isParentMention("Welspun Corp associate EPIC bags order from Aramco", "Welspun Corp")).toBe(true);
    expect(isParentMention("EPIC bags order from Aramco", "Aramco")).toBe(false);
    const text = "Welspun Corp's associate EPIC bags Rs 2,000 crore steel pipe order from Saudi Aramco.";
    const ex = checkAndAgree(text, {
      a: {
        p1: {
          project_name: null, stage: "unknown", stage_quote: null,
          companies: [
            { name: { value: "Welspun Corp", quote: "Welspun Corp's associate EPIC" }, role: "unknown", role_quote: null, country: null },
            { name: { value: "EPIC", quote: "associate EPIC bags" }, role: "supplier", role_quote: text, country: null },
            { name: { value: "Saudi Aramco", quote: "from Saudi Aramco" }, role: "unknown", role_quote: null, country: null },
          ],
        } as P1Output,
        p2: EMPTY_P2,
        p3: EMPTY_P3,
      },
      b: null,
      mode: "single",
      extractedBy: "model:test",
    });
    const derived = deriveFromAward(ex, text);
    expect(derived.project.name?.value).toBe("Saudi Aramco pipeline supply contract – EPIC");
    expect(derived.packages[0].owner?.value).toBe("Saudi Aramco");
  });
});
