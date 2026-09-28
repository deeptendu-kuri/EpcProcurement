// @vitest-environment node
/**
 * Supplier leads, separate orders, full-sentence proof and dates (docs/mvp/07 §1, 13 §11).
 * A pipe maker that wins a supply order is a buyer too; two orders of one buyer stay two orders.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { contactSearches, evidenceSentence } from "@/mvp/repo";
import { buildSignalsAndScore } from "@/mvp/scoring";
import type { LeadRow, Reason } from "@/mvp/types";
import { checkAndAgree, deriveFromAward, extractDocument } from "./extract";
import { storeDocument } from "./read";
import { awardDateFor, resolveDocument } from "./resolve";
import { EMPTY_P2, EMPTY_P3, type P1Output } from "./schemas";
import { sentenceAround, shortCompanyName } from "./text";

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

const order = (millions: number) =>
  [
    `East Pipes Integrated Company secures SAR ${millions} million steel pipes order from Saudi Aramco`,
    "East Pipes Integrated Company for Industry said it signed the order with Saudi Aramco for water transmission pipes in the Eastern Province.",
  ].join("\n");

async function ingest(text: string, url: string, publisherKey: string, publishedAt: string) {
  const { rows } = await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', $1::jsonb) returning id", [
    JSON.stringify({ query: "pipeline", markets: ["IN", "SA", "AE", "MY"], leadKinds: ["bid", "supply_subcontract"] }),
  ]);
  const runId = rows[0].id;
  const raw = { sourceKey: "bing:test", sourceName: "News · test", tier: "B" as const, publisherKey, url, title: text.split("\n")[0], publishedAt, text, language: "en", isSample: false };
  const stored = await storeDocument(db, runId, raw);
  const ex = await extractDocument({ text: stored.text, url, publishedAt }, { db, runId });
  await db.tx((tx) => resolveDocument(tx, { documentId: stored.id, url, tier: "B", publisherKey, market: "IN", publishedAt, text: stored.text }, ex));
  await db.query("update source_documents set status = 'extracted' where id = $1", [stored.id]);
  await buildSignalsAndScore(runId, { db, now: NOW });
  return ex;
}

type LeadWithNames = LeadRow & { buyer: string; project: string };
async function leads(): Promise<LeadWithNames[]> {
  return (
    await db.query<LeadWithNames>(
      `select l.*, c.canonical_name as buyer, p.name as project from leads l
         join companies c on c.id = l.buyer_company_id left join projects p on p.id = l.project_id order by p.name, c.canonical_name`,
    )
  ).rows;
}

describe("supplier orders become supplier leads (07 §1, 13 §11)", () => {
  beforeEach(async () => {
    await db.exec("truncate runs, source_documents, evidence, fact_evidence, companies, projects, signals, leads cascade");
  });

  it("two orders of one buyer stay two projects, each named '<Buyer> <product> order (Mon YYYY)'", async () => {
    await ingest(order(485), "https://paper-one.example/epic-dec", "paper-one.example", "2025-12-09T03:07:00.000Z");
    await ingest(order(771), "https://paper-two.example/epic-sep", "paper-two.example", "2026-09-21T06:00:00.000Z");
    const projects = (await db.query<{ name: string }>("select name from projects order by name")).rows.map((r) => r.name);
    expect(projects).toEqual(["Aramco steel pipe order (Dec 2025)", "Aramco steel pipe order (Sep 2026)"]);
  });

  it("the pipe maker gets a supplier lead whose first reason says what it won; Aramco is Watching until the EPC is known", async () => {
    await ingest(order(771), "https://paper-two.example/epic-sep", "paper-two.example", "2026-09-21T06:00:00.000Z");
    const all = await leads();
    const supplier = all.find((l) => /East Pipes/i.test(l.buyer));
    expect(supplier?.buyer_type).toBe("manufacturer");
    expect(supplier?.kind).toBe("supply_subcontract");
    expect((supplier?.reasons as Reason[])[0].text).toMatch(/^Won a steel pipe order from .*Aramco worth SAR 771M \(21 Sep 2026\) — they buy materials, consumables and services to deliver it$/);

    const owner = all.find((l) => /Aramco/i.test(l.buyer));
    expect(owner?.buyer_type).toBe("owner");
    expect(owner?.class).toBe("watch");
    expect((owner?.reasons as Reason[])[0].text).toMatch(/identify the EPC contractor/);
  });
});

describe("naming, dates and proof", () => {
  it("names a supply order after its buyer and month, never from fragments", () => {
    const text = "Welspun Corp's associate EPIC bags Rs 2,000 crore steel pipe order from Saudi Aramco.";
    const ex = checkAndAgree(text, {
      a: {
        p1: {
          project_name: null, stage: "unknown", stage_quote: null,
          companies: [
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
    expect(deriveFromAward(ex, text, "2026-09-21T06:00:00Z").project.name?.value).toBe("Aramco steel pipe order (Sep 2026)");
  });

  it("a pipe maker called 'main EPC' in a supply-order story is a supplier", () => {
    const text = [
      "Welspun Corp says EPIC bags Rs 1,165 crore steel pipe contract in Saudi Arabia",
      "East Pipes Integrated Company for Industry has entered into a contract with Saudi Arabian Oil Company worth SAR 485 million.",
    ].join("\n");
    const roleQuote = "East Pipes Integrated Company for Industry has entered into a contract with Saudi Arabian Oil Company worth SAR 485 million.";
    const ex = checkAndAgree(text, {
      a: {
        p1: {
          project_name: null, stage: "unknown", stage_quote: null,
          companies: [
            { name: { value: "East Pipes Integrated Company for Industry", quote: "East Pipes Integrated Company for Industry has entered" }, role: "main_epc", role_quote: roleQuote, country: null },
            { name: { value: "Saudi Arabian Oil Company", quote: "Saudi Arabian Oil Company worth" }, role: "owner", role_quote: roleQuote, country: null },
          ],
        } as P1Output,
        p2: EMPTY_P2,
        p3: EMPTY_P3,
      },
      b: null,
      mode: "single",
      extractedBy: "model:test",
    });
    const derived = deriveFromAward(ex, text, "2025-12-09T03:07:00Z");
    expect(derived.companies.find((c) => c.name.value.startsWith("East Pipes"))?.role).toBe("supplier");
    expect(derived.project.name?.value).toBe("Aramco steel pipe order (Dec 2025)");
  });

  it("short relation quotes are widened to their sentence; a role sentence must name the company", () => {
    const text = "Shares rose on Tuesday. EPIC has entered into a contract with Aramco for steel pipes. Welspun holds a stake.";
    const ex = checkAndAgree(text, {
      a: {
        p1: {
          project_name: null, stage: "awarded", stage_quote: "entered into a contract",
          companies: [
            { name: { value: "EPIC", quote: "EPIC" }, role: "supplier", role_quote: "has entered into a contract", country: null },
            { name: { value: "Welspun", quote: "Welspun" }, role: "owner", role_quote: "Shares rose on Tuesday", country: null },
          ],
          contract_value: null, award_date: null, tender_ref: null, closing_date: null, project_type: null, location: null,
        } as P1Output,
        p2: EMPTY_P2,
        p3: EMPTY_P3,
      },
      b: null,
      mode: "single",
      extractedBy: "model:test",
    });
    const epic = ex.companies.find((c) => c.name.value === "EPIC");
    expect(epic?.roleFact?.quote).toBe("EPIC has entered into a contract with Aramco for steel pipes.");
    expect(ex.project.stageFact?.quote).toBe("EPIC has entered into a contract with Aramco for steel pipes.");
    // "Shares rose on Tuesday." does not name Welspun: no role.
    expect(ex.companies.find((c) => c.name.value === "Welspun")?.role).toBe("unknown");
  });

  it("sentenceAround skips abbreviations and keeps the quote", () => {
    const text = "Saudi Arabian Oil Co. placed an order with East Pipes Integrated Co. worth SAR 771 mn. Delivery is in six months.";
    const at = text.indexOf("East Pipes");
    // "Co." and "mn." are not sentence ends; "months." is.
    expect(sentenceAround(text, at, at + 10).sentence).toBe(text);
    const short = "EPIC won the order. Delivery is in six months.";
    expect(sentenceAround(short, 0, 4).sentence).toBe("EPIC won the order.");
    expect(evidenceSentence(short, "six months", null, null)).toBe("Delivery is in six months.");
  });

  it("the award date is the text date unless it is after the article's own date", () => {
    expect(awardDateFor("2026-09-18", "2026-09-21T06:00:00Z", true, NOW)).toBe("2026-09-18");
    expect(awardDateFor("2027-03-01", "2026-09-21T06:00:00Z", true, NOW)).toBe("2026-09-21");
    expect(awardDateFor(null, "2025-12-09T03:07:00Z", true, NOW)).toBe("2025-12-09");
    expect(awardDateFor(null, "2025-12-09T03:07:00Z", false, NOW)).toBeNull();
  });

  it("short names and contact searches", () => {
    expect(shortCompanyName("Saudi Arabian Oil Co. (Saudi Aramco)")).toBe("Aramco");
    expect(shortCompanyName("East Pipes Integrated Company for Industry (EPIC)")).toBe("EPIC");
    const searches = contactSearches("East Pipes Integrated Company for Industry (EPIC)", null);
    expect(searches.map((s) => s.label)).toEqual(["Procurement manager", "Purchasing contact", "LinkedIn people", "Contact page"]);
    expect(searches.every((s) => /^https:\/\/www\.(google|linkedin)\.com\//.test(s.url))).toBe(true);
    expect(contactSearches("EPIC", "https://www.epic.com.sa")[3].url).toContain(encodeURIComponent("site:www.epic.com.sa contact"));
  });
});

describe("parent companies in stock stories", () => {
  it("the parent whose shares moved is not the owner of its associate's order", () => {
    const text = [
      "Welspun Corp shares hit a fresh intraday high on Monday after its Saudi associate EPIC secured a Rs 2,000 crore pipe supply order from Aramco.",
      "The contract covers the manufacturing and supply of steel pipes to Aramco.",
    ].join("\n");
    const ex = checkAndAgree(text, {
      a: {
        p1: {
          project_name: null, stage: "unknown", stage_quote: null,
          companies: [
            { name: { value: "Welspun Corp", quote: "Welspun Corp shares hit" }, role: "owner", role_quote: text.split("\n")[0], country: null },
            { name: { value: "EPIC", quote: "associate EPIC secured" }, role: "supplier", role_quote: text.split("\n")[0], country: null },
            { name: { value: "Aramco", quote: "order from Aramco" }, role: "unknown", role_quote: null, country: null },
          ],
        } as P1Output,
        p2: EMPTY_P2,
        p3: EMPTY_P3,
      },
      b: null,
      mode: "single",
      extractedBy: "model:test",
    });
    const derived = deriveFromAward(ex, text, "2026-09-21T06:00:00Z");
    expect(derived.companies.find((c) => c.name.value === "Welspun Corp")?.role).toBe("unknown");
    expect(derived.project.name?.value).toBe("Aramco pipe order (Sep 2026)");
    expect(derived.packages[0].owner?.value).toBe("Aramco");
  });
});
