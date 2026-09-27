// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getClientProfile } from "@/mvp/config/profile";
import { extractDocument } from "./extract";
import { filterDocument, queryTerms } from "./filter";
import { rulesP1, rulesP2, rulesP3, splitSentences } from "./rules-extract";
import { fixtureDocs } from "./sources/fixtures";
import { noticeToDoc } from "./sources/ted";
import { cleanText } from "./text";

const NOW = new Date("2026-09-27T12:00:00Z");
const docs = fixtureDocs(NOW);
const byId = (id: string) => {
  const doc = docs.find((d) => d.fixtureId === id);
  if (!doc) throw new Error(`fixture ${id} missing`);
  return { ...doc, text: cleanText(doc.text!) };
};

describe("fixtures", () => {
  it("are synthetic, sample-flagged and dated relative to today", () => {
    expect(docs.length).toBeGreaterThanOrEqual(10);
    for (const doc of docs) {
      expect(doc.isSample).toBe(true);
      expect(doc.url).toMatch(/^https:\/\/example\.(com|org)\//);
      expect(doc.text).not.toMatch(/\{\{date/);
    }
    expect(byId("fx-03").text).toContain("Bids must be submitted by 31 October 2026");
  });
});

describe("rules filter (05 §5)", () => {
  const profile = getClientProfile();
  const run = (id: string, markets = ["IN", "SA", "AE", "NO", "MY"]) => {
    const doc = byId(id);
    return filterDocument({ title: doc.title, text: doc.text, publishedAt: doc.publishedAt, markets, queryTerms: queryTerms("line pipe"), profile, sourceMarket: doc.market, now: NOW });
  };

  it("drops the look-alike market report", () => {
    expect(run("fx-08")).toMatchObject({ verdict: "drop", reason: "noise: market report" });
  });

  it("keeps the award and the tender", () => {
    expect(run("fx-01").verdict).toBe("relevant");
    expect(run("fx-01").markets).toContain("IN");
    expect(run("fx-03").verdict).toBe("relevant");
  });

  it("keeps the completed-2019 article (gate G4 rejects it later)", () => {
    expect(run("fx-09").verdict).toBe("relevant");
  });

  it("drops documents outside the run's markets and stale ones", () => {
    expect(run("fx-06", ["IN"]).verdict).toBe("drop");
    const stale = filterDocument({
      title: "Old award", text: "Example Gas awarded a pipeline contract in India.", publishedAt: "2023-01-01T00:00:00Z",
      markets: ["IN"], queryTerms: [], profile, now: NOW,
    });
    expect(stale).toMatchObject({ verdict: "drop" });
  });

  it("recognises Arabic and Malay trigger terms", () => {
    const arabic = filterDocument({ title: null, text: "ترسية عقد خط أنابيب في السعودية", publishedAt: NOW.toISOString(), markets: ["SA"], queryTerms: [], profile, now: NOW });
    expect(arabic.verdict).toBe("relevant");
  });
});

describe("rules extractor", () => {
  it("splits sentences without breaking on 'No.' or 'Ltd'", () => {
    const s = splitSentences("Tender No. EX-1. Example Ltd won it. Done");
    expect(s).toEqual(["Tender No. EX-1.", "Example Ltd won it.", "Done"]);
  });

  it("reads the EPC award filing (P1–P3)", () => {
    const { text } = byId("fx-01");
    const p1 = rulesP1(text);
    expect(p1.project_name?.value).toBe("Example Jamnagar-Kandla Gas Pipeline Project");
    expect(p1.stage).toBe("awarded");
    const roles = Object.fromEntries(p1.companies.map((c) => [c.name!.value, c.role]));
    expect(roles).toMatchObject({ "Example Infra Projects Ltd": "main_epc", "Example Gas Transmission Ltd": "owner" });
    expect(p1.contract_value?.value).toBe("Rs 1,450 crore");
    expect(p1.award_date?.value).toBe("14 September 2026");

    const p2 = rulesP2(text, p1);
    const pipe = p2.requirements.find((r) => r.discipline === "pipeline")!;
    expect(pipe.standard?.value).toBe("API 5L");
    expect(pipe.grade?.value).toBe("X65");
    expect(pipe.size_in?.value).toBe("24");
    expect(pipe.quantity?.value).toBe("120");
    expect(pipe.unit).toBe("km");
    expect(pipe.delivery_port?.value).toBe("Kandla");
    expect(p2.packages.find((p) => p.discipline === "pipeline")?.owner?.value).toBe("Example Infra Projects Ltd");

    const p3 = rulesP3(text);
    expect(p3.people[0]).toMatchObject({ name: { value: "Rajesh Kumar" }, title: { value: "Project Director" }, company: { value: "Example Infra Projects Ltd" } });
  });

  it("reads subcontract, supplier order, tender and completed patterns", () => {
    const sub = rulesP1(byId("fx-04").text);
    expect(Object.fromEntries(sub.companies.map((c) => [c.name!.value, c.role]))).toMatchObject({
      "Example Gulf Contracting LLC": "main_epc",
      "Example Emirates Piping Services LLC": "subcontractor",
      "Example Emirates Gas Company PJSC": "owner",
    });
    const order = rulesP1(byId("fx-05").text);
    expect(Object.fromEntries(order.companies.map((c) => [c.name!.value, c.role]))).toMatchObject({
      "Example Valves Manufacturing Pvt Ltd": "supplier",
      "Example Gulf Contracting LLC": "main_epc",
    });
    const tender = rulesP1(byId("fx-03").text);
    expect(tender.stage).toBe("epc_tender");
    expect(tender.tender_ref?.value).toBe("EX-SWT-2026-114");
    expect(tender.closing_date?.value).toBe("31 October 2026");
    expect(rulesP3(byId("fx-03").text).people[0]).toMatchObject({ name: { value: "Faisal Al-Harbi" }, title: { value: "Contracts Manager" } });
    expect(rulesP1(byId("fx-09").text).stage).toBe("completed");
  });

  it("only returns quotes that are substrings of the text, for every fixture", () => {
    for (const doc of docs) {
      const text = cleanText(doc.text!);
      const p1 = rulesP1(text);
      const p2 = rulesP2(text, p1);
      const p3 = rulesP3(text);
      const quotes = [
        p1.project_name?.quote, p1.stage_quote, p1.contract_value?.quote, p1.award_date?.quote, p1.closing_date?.quote, p1.tender_ref?.quote,
        ...p1.companies.flatMap((c) => [c.name?.quote, c.role_quote]),
        ...p2.packages.flatMap((p) => [p.name?.quote, p.owner?.quote]),
        ...p2.requirements.flatMap((r) => [r.item?.quote, r.standard?.quote, r.grade?.quote, r.size_in?.quote, r.quantity?.quote, r.delivery_port?.quote]),
        ...p3.people.flatMap((p) => [p.name?.quote, p.title?.quote, p.company?.quote]),
      ].filter((q): q is string => Boolean(q));
      for (const quote of quotes) expect(text.includes(quote), `${doc.fixtureId}: ${quote}`).toBe(true);
    }
  });
});

describe("extractDocument (demo mode)", () => {
  it("labels mock facts 'rule' and keeps only verified facts", async () => {
    const saved = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const doc = byId("fx-06");
      // A fake db that swallows llm_usage writes.
      const db = { query: async () => ({ rows: [] }), exec: async () => undefined };
      const ex = await extractDocument({ text: doc.text, url: doc.url }, { db });
      expect(ex.extractedBy).toBe("rule:mock-rules");
      expect(ex.stats.kept).toBeGreaterThan(5);
      expect(ex.companies.every((c) => c.name.agreement === "rule")).toBe(true);
      expect(ex.project.stage).toBe("awarded");
      expect(ex.requirements[0].deliveryPort?.value).toBe("Stavanger");
    } finally {
      if (saved !== undefined) process.env.GROQ_API_KEY = saved;
    }
  });

  it("maps TED award notices to rule evidence without AI", async () => {
    const doc = noticeToDoc({
      "publication-number": "656522-2026",
      "notice-type": "can-standard",
      "title-proc": { eng: "Framework agreement for pipeline works" },
      "buyer-name": { eng: ["Example Kommune"] },
      "buyer-country": ["NOR"],
      "winner-name": { eng: ["Example Rør AS", "Example Bygg AS"] },
      "winner-country": ["NOR", "NOR"],
      "total-value": 35000000,
      "total-value-cur": ["NOK"],
      "publication-date": "2026-09-23+02:00",
      "classification-cpv": ["45231300"],
    })!;
    expect(doc.market).toBe("NO");
    const ex = await extractDocument({ text: cleanText(doc.text!), url: doc.url, structured: doc.structured });
    expect(ex.extractedBy).toBe("rule:ted");
    expect(ex.companies.map((c) => [c.name.value, c.role])).toEqual([
      ["Example Kommune", "owner"],
      ["Example Rør AS", "main_epc"],
      ["Example Bygg AS", "main_epc"],
    ]);
    expect(ex.project.value?.value).toBe("35000000 NOK");
    expect(ex.packages[0].discipline).toBe("pipeline");
    expect(ex.stats.dropped).toBe(0);
  });
});
