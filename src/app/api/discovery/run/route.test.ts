import { describe, expect, it } from "vitest";
import type { SearchResult, StructuredExtraction } from "@/types/providers";
import { buildSearchConfig, classifyDiscoveryIntent, discoveryCoverage, discoveryRunVerdict, materialTermsForQuery, matchScoreSkipReason, minimumLeadMatchScore, scoreLeadMatch, searchPreviewSkipReason, selectDiscoveryCandidates, strictProjectFitReason } from "./route";

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    query: "test",
    title: "Test result",
    url: "https://example.com/news/project-archive",
    snippet: "",
    sourceDomain: "example.com",
    ...overrides,
  };
}

function extraction(overrides: Partial<StructuredExtraction>): StructuredExtraction {
  return {
    relevant: true,
    companies: [{ name: "ADNOC", country: "UAE" }],
    awardedContractors: [],
    project: { name: "Taweelah C Combined Cycle Gas Turbine Power Plant", country: "UAE" },
    requirements: [],
    signalType: "EPC_AWARD",
    confidence: 0.9,
    ...overrides,
  };
}

describe("live discovery accuracy guardrails", () => {
  it("treats named project searches as exact project mode", () => {
    const config = buildSearchConfig({
      query: "Taweelah C Combined Cycle Gas Turbine (CCGT) Power Plant subcontracts",
      regions: ["UAE"],
      keywords: [],
    });

    expect(config?.queryMode).toBe("project");
    expect(config?.strictProjectQuery).toContain("Taweelah C");
    expect(config?.requiredMatchTerms).toEqual(expect.arrayContaining(["taweelah", "ccgt", "turbine"]));
  });

  it("rejects extracted projects that do not match the searched project phrase", () => {
    const config = buildSearchConfig({
      query: "Taweelah C Combined Cycle Gas Turbine (CCGT) Power Plant subcontracts",
      regions: ["UAE"],
      keywords: [],
    });

    const reason = strictProjectFitReason(extraction({
      companies: [{ name: "Saudi Aramco", country: "Saudi Arabia" }],
      project: { name: "Master Gas System 2 pipeline network", country: "Saudi Arabia" },
    }), config!);

    expect(reason).toContain("did not match the searched project phrase");
  });

  it("accepts extracted projects that match the searched project phrase", () => {
    const config = buildSearchConfig({
      query: "Taweelah C Combined Cycle Gas Turbine (CCGT) Power Plant subcontracts",
      regions: ["UAE"],
      keywords: [],
    });

    expect(strictProjectFitReason(extraction({}), config!)).toBeUndefined();
  });

  it("skips old completed opportunities before extraction", () => {
    const config = buildSearchConfig({ query: "pipeline EPC award", regions: ["GCC"], keywords: ["API 5L"] });
    const reason = searchPreviewSkipReason(result({
      title: "Pipeline EPC contract awarded in 2020",
      snippet: "Completed 2020 oil and gas pipeline EPC award archive",
      publishedAt: "2020-05-02",
    }), config!);

    expect(reason).toContain("old/completed 2020 opportunity");
  });

  it("skips generic supplier/catalog pages for material searches when no buyer action is present", () => {
    const config = buildSearchConfig({ query: "Line Pipes API 5L", regions: ["GCC"], keywords: [] });
    const reason = searchPreviewSkipReason(result({
      title: "API 5L line pipe supplier catalog",
      snippet: "Manufacturer product range, datasheet, and pipe specifications",
      url: "https://supplier.example.com/api-5l-line-pipe-catalog",
    }), config!);

    expect(reason).toContain("Generic supplier/catalog page skipped");
  });

  it("expands broad steel material searches beyond one exact product", () => {
    expect(materialTermsForQuery("pipes steel plates hollow sections galvanized sheets")).toEqual(expect.arrayContaining([
      "steel pipe",
      "steel plates",
      "hollow sections",
      "galvanized sheets",
    ]));
  });

  it("keeps carbon steel pipe searches product-specific without drifting into plate terms", () => {
    const terms = materialTermsForQuery("Carbon Steel Pipe");

    expect(terms.slice(0, 4)).toEqual(["carbon steel pipe", "steel pipe", "API 5L line pipe", "line pipe"]);
    expect(terms).not.toContain("steel plates");
  });

  it("builds buyer-aware material queries for carbon steel pipe searches", () => {
    const config = buildSearchConfig({ query: "Carbon Steel Pipe", regions: ["GCC"], keywords: [] })!;

    expect(config.intentClassification).toBeDefined();
    expect(config.discoveryPlay?.id).toBe("material_package");
    expect(config.intentClassification?.mode).toBe("material_sourcing");
    expect(config.intentClassification?.requiredTerms).toContain("carbon steel pipe");
    expect(config.queries.some((query) => query.includes('"carbon steel pipe" "Saudi Aramco" tender procurement'))).toBe(true);
    expect(config.queries.some((query) => query.includes('"steel plates"'))).toBe(false);
  });

  it("carries selected discovery play metadata into the search config", () => {
    const config = buildSearchConfig({ query: "Hail and Gasha pipeline subcontractors", regions: ["UAE"], keywords: [], playId: "contractor_map" })!;

    expect(config.discoveryPlay?.id).toBe("contractor_map");
    expect(config.discoveryPlay?.evidenceRules).toEqual(expect.arrayContaining(["Contractor named", "Scope/package extracted"]));
    expect(config.queries.some((query) => query.toLowerCase().includes("awarded contractor") || query.toLowerCase().includes("subcontract"))).toBe(true);
  });

  it("orchestrates material searches across tender, buyer, award, owner, and package angles", () => {
    const config = buildSearchConfig({ query: "Carbon Steel Pipe", regions: ["GCC"], keywords: [], playId: "material_package" })!;
    const joined = config.queries.join("\n").toLowerCase();

    expect(config.queries.length).toBeGreaterThanOrEqual(12);
    expect(joined).toContain("tender procurement");
    expect(joined).toContain("rfq bid package");
    expect(joined).toContain("supply contract");
    expect(joined).toContain("awarded contractor");
    expect(joined).toContain("project owner");
    expect(joined).toContain("saudi aramco");
  });

  it("plans deeper play-specific query sets for material package discovery", () => {
    const config = buildSearchConfig({ query: "Carbon Steel Pipe", regions: ["GCC"], keywords: [], playId: "material_package" })!;

    expect(config.queries.length).toBeGreaterThan(7);
    expect(config.queries).toEqual(expect.arrayContaining([
      '"carbon steel pipe" procurement package GCC',
      '"carbon steel pipe" supply contract GCC',
    ]));
  });

  it("selects discovery candidates across diverse source domains", () => {
    const config = buildSearchConfig({ query: "Carbon Steel Pipe", regions: ["GCC"], keywords: [], playId: "material_package" })!;
    const results = [
      ...Array.from({ length: 6 }, (_, index) => result({
        query: "q1",
        title: `Saudi Aramco carbon steel pipe procurement award ${index}`,
        url: `https://dominant.example.com/news/${index}`,
        snippet: "Saudi Aramco GCC carbon steel pipe procurement award supply contract",
        sourceDomain: "dominant.example.com",
      })),
      result({ query: "q2", title: "ADNOC carbon steel pipe tender", url: "https://adnoc.example.com/tender", snippet: "UAE ADNOC carbon steel pipe tender procurement", sourceDomain: "adnoc.example.com" }),
      result({ query: "q3", title: "Oman carbon steel pipe supply contract", url: "https://oman-procurement.example.com/notice", snippet: "Oman GCC carbon steel pipe supply contract procurement", sourceDomain: "oman-procurement.example.com" }),
    ];

    const selected = selectDiscoveryCandidates(results, config);
    const domains = new Set(selected.map((item) => item.sourceDomain));

    expect(selected.length).toBeGreaterThanOrEqual(3);
    expect(domains.size).toBeGreaterThanOrEqual(3);
  });

  it("balances discovery candidates across source classes", () => {
    const config = buildSearchConfig({ query: "Carbon Steel Pipe", regions: ["GCC"], keywords: [], playId: "material_package" })!;
    const results = [
      ...Array.from({ length: 5 }, (_, index) => result({
        query: "dominant",
        title: `Carbon steel pipe procurement award news ${index}`,
        url: `https://news.example.com/story/${index}`,
        snippet: "EPC award carbon steel pipe procurement GCC",
        sourceDomain: "news.example.com",
      })),
      result({ query: "tender", title: "Carbon steel pipe tender procurement notice", url: "https://tenders.example.com/notice/1", snippet: "Tender procurement notice GCC carbon steel pipe", sourceDomain: "tenders.example.com" }),
      result({ query: "company", title: "ADNOC carbon steel pipe supply contract", url: "https://adnoc.example.com/news/contract", snippet: "Company announcement supply contract carbon steel pipe", sourceDomain: "adnoc.example.com" }),
      result({ query: "portal", title: "Carbon steel pipe RFQ bid package", url: "https://procurement.example.com/rfq/pipe", snippet: "RFQ bid package carbon steel pipe GCC", sourceDomain: "procurement.example.com" }),
    ];

    const selected = selectDiscoveryCandidates(results, config);
    const selectedDomains = new Set(selected.map((item) => item.sourceDomain));

    expect(selectedDomains.size).toBeGreaterThanOrEqual(3);
    expect(selected.some((item) => item.sourceDomain === "tenders.example.com")).toBe(true);
    expect(selected.some((item) => item.sourceDomain === "adnoc.example.com")).toBe(true);
  });
  it("adds bounded recovery candidates when requested", () => {
    const config = buildSearchConfig({ query: "Carbon Steel Pipe", regions: ["GCC"], keywords: [], playId: "material_package" })!;
    const results = Array.from({ length: 18 }, (_, index) => result({
      query: `q${index % 6}`,
      title: `Carbon steel pipe tender procurement source ${index}`,
      url: `https://source-${index}.example.com/news/pipe`,
      snippet: "GCC carbon steel pipe tender procurement supply contract EPC package",
      sourceDomain: `source-${index}.example.com`,
    }));

    const normal = selectDiscoveryCandidates(results, config);
    const recovery = selectDiscoveryCandidates(results, config, { includeRecoveryCandidates: true });

    expect(recovery.length).toBeGreaterThan(normal.length);
    expect(recovery.length).toBeLessThanOrEqual(normal.length + 4);
  });
  it("summarizes run coverage from processed source outcomes", () => {
    const coverage = discoveryCoverage([
      {
        url: "https://source-a.example.com/news/1",
        title: "Accepted source",
        status: "CHECKED",
        stage: "complete",
        sourceQuality: { score: 12, category: "EPC/project news", matchedSignals: ["carbon steel pipe", "procurement"] },
      },
      {
        url: "https://source-b.example.com/tender/2",
        title: "Rejected source",
        status: "SKIPPED",
        stage: "complete",
        sourceQuality: { score: 8, category: "tender/procurement portal", matchedSignals: ["tender", "gcc"] },
      },
      {
        url: "https://source-c.example.com/notice/3",
        title: "Retry source",
        status: "NEEDS_RETRY",
        stage: "extraction",
        sourceQuality: { score: 6, category: "company announcement", matchedSignals: ["award"] },
      },
    ]);

    expect(coverage.domainsChecked).toBe(3);
    expect(coverage.sourceCategories).toEqual(expect.arrayContaining(["EPC/project news", "tender/procurement portal"]));
    expect(coverage.evidenceSignals).toEqual(expect.arrayContaining(["carbon steel pipe", "tender"]));
    expect(coverage.accepted).toBe(1);
    expect(coverage.retry).toBe(1);
    expect(coverage.sourceDiversity).toBeGreaterThan(40);
  });


  it("marks a run weak when no source passes the evidence gates", () => {
    const config = buildSearchConfig({ query: "Carbon Steel Pipe", regions: ["GCC"], keywords: [], playId: "material_package" })!;
    const verdict = discoveryRunVerdict([
      {
        url: "https://source.example.com/news/1",
        title: "Rejected source",
        status: "SKIPPED",
        stage: "complete",
        sourceQuality: { score: 8, category: "EPC/project news", matchedSignals: ["carbon steel pipe", "procurement"] },
        reason: "Source extracted fields, but it did not prove the requested material/product terms.",
      },
    ], config);

    expect(verdict.status).toBe("weak");
    expect(verdict.reasons).toEqual(expect.arrayContaining(["No saveable candidate passed the evidence gates."]));
  });

  it("marks thin accepted runs for review instead of client-safe", () => {
    const config = buildSearchConfig({ query: "Carbon Steel Pipe", regions: ["GCC"], keywords: [], playId: "material_package" })!;
    const verdict = discoveryRunVerdict([
      {
        url: "https://source.example.com/news/1",
        title: "Accepted source",
        status: "CHECKED",
        stage: "complete",
        sourceQuality: { score: 8, category: "EPC/project news", matchedSignals: ["carbon steel pipe", "procurement"] },
        matchScore: { total: 59, project: 16, material: 13, region: 12, freshness: 13, source: 8, contractor: 0, contactability: 8, reasons: ["Requirement/material matched: carbon steel pipe"] },
      },
    ], config);

    expect(verdict.status).toBe("review");
    expect(verdict.bestScore).toBe(59);
  });

  it("classifies material searches as material sourcing", () => {
    const intent = classifyDiscoveryIntent("Line Pipes API 5L", ["GCC"], [], "", ["API 5L line pipe"]);

    expect(intent.mode).toBe("material_sourcing");
    expect(intent.strictness).toBe("balanced");
    expect(intent.requiredTerms).toContain("API 5L line pipe");
  });

  it("classifies old/completed searches as historical research", () => {
    const intent = classifyDiscoveryIntent("completed pipeline EPC awards 2020", ["Saudi Arabia"], [], "", ["pipeline"]);

    expect(intent.mode).toBe("historical_research");
    expect(intent.explanation).toContain("old/completed");
  });

  it("scores exact matching project leads higher than unrelated sources", () => {
    const config = buildSearchConfig({
      query: "Taweelah C Combined Cycle Gas Turbine (CCGT) Power Plant subcontracts",
      regions: ["UAE"],
      keywords: [],
    })!;

    const matched = scoreLeadMatch(extraction({}), result({
      title: "Taweelah C CCGT power plant subcontractors announced",
      snippet: "ADNOC project in UAE with EPC package details.",
      url: "https://example.com/news/taweelah-c-ccgt",
      publishedAt: "2026-08-01",
    }), config, { score: 14, category: "EPC/project news", matchedSignals: ["taweelah", "ccgt", "uae"] });

    const unrelated = scoreLeadMatch(extraction({
      companies: [{ name: "Saudi Aramco", country: "Saudi Arabia" }],
      project: { name: "Master Gas System 2 pipeline network", country: "Saudi Arabia" },
    }), result({
      title: "Aramco pipeline contract",
      snippet: "Saudi Arabia pipeline award.",
      url: "https://example.com/news/aramco-pipeline",
      publishedAt: "2026-08-01",
    }), config, { score: 7, category: "EPC/project news", matchedSignals: ["pipeline"] });

    expect(matched.total).toBeGreaterThan(unrelated.total);
    expect(matched.reasons.join(" ")).toContain("Project terms matched");
  });

  it("uses stricter save thresholds for exact project searches than broad procurement searches", () => {
    const exactConfig = buildSearchConfig({
      query: "Taweelah C Combined Cycle Gas Turbine (CCGT) Power Plant subcontracts",
      regions: ["UAE"],
      keywords: [],
    })!;
    const broadConfig = buildSearchConfig({ query: "GCC procurement", regions: ["GCC"], keywords: [] })!;

    expect(minimumLeadMatchScore(exactConfig)).toBeGreaterThan(minimumLeadMatchScore(broadConfig));
  });

  it("blocks material sourcing saves when product evidence is missing even if the total score looks high", () => {
    const config = buildSearchConfig({ query: "Carbon Steel Pipe", regions: ["GCC"], keywords: [] })!;
    const reason = matchScoreSkipReason({
      total: 66,
      project: 16,
      material: 0,
      region: 12,
      freshness: 13,
      source: 10,
      contractor: 7,
      contactability: 8,
      reasons: ["Project extracted: random pipeline award"],
    }, config);

    expect(reason).toContain("did not prove the requested material/product terms");
  });

  it("blocks material sourcing saves when source quality is weak", () => {
    const config = buildSearchConfig({ query: "Carbon Steel Pipe", regions: ["GCC"], keywords: [] })!;
    const reason = matchScoreSkipReason({
      total: 70,
      project: 16,
      material: 18,
      region: 12,
      freshness: 13,
      source: 4,
      contractor: 0,
      contactability: 8,
      reasons: ["Requirement/material matched: carbon steel pipe"],
    }, config);

    expect(reason).toContain("source quality was too weak");
  });

  it("blocks contractor-map saves when no awarded contractor evidence exists", () => {
    const config = buildSearchConfig({ query: "Hail and Gasha package award", regions: ["UAE"], keywords: [], playId: "contractor_map" })!;
    const reason = matchScoreSkipReason({
      total: 76,
      project: 16,
      material: 14,
      region: 12,
      freshness: 13,
      source: 9,
      contractor: 0,
      contactability: 8,
      reasons: ["Project extracted: Hail and Gasha"],
    }, config);

    expect(reason).toContain("requires a named awarded EPC");
  });

  it("blocks project-owner saves when the owner account is not identifiable", () => {
    const config = buildSearchConfig({ query: "Taweelah C CCGT project", regions: ["UAE"], keywords: [], playId: "project_owner" })!;
    const reason = matchScoreSkipReason({
      total: 72,
      project: 24,
      material: 10,
      region: 12,
      freshness: 13,
      source: 8,
      contractor: 5,
      contactability: 0,
      reasons: ["Project terms matched: taweelah"],
    }, config);

    expect(reason).toContain("requires an identifiable owner/client account");
  });

  it("allows contractor-map saves when contractor, project, source, region, and freshness evidence pass", () => {
    const config = buildSearchConfig({ query: "Hail and Gasha package award", regions: ["UAE"], keywords: [], playId: "contractor_map" })!;
    const reason = matchScoreSkipReason({
      total: 80,
      project: 16,
      material: 13,
      region: 12,
      freshness: 13,
      source: 12,
      contractor: 12,
      contactability: 8,
      reasons: ["1 awarded contractor extracted"],
    }, config);

    expect(reason).toBe("");
  });
});

