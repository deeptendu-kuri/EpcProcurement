import { describe, expect, it } from "vitest";
import type { LeadListItem } from "@/mvp/types";
import { csvCell, leadsToCsv } from "./csv";
import { parseLeadQuery } from "../filter";

describe("leads CSV", () => {
  it("escapes quotes, commas and spreadsheet formulas", () => {
    expect(csvCell('24" X65, 120 km')).toBe('"24"" X65, 120 km"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
  });

  it("writes one row per lead with evidence URLs", () => {
    const lead = {
      id: "l1", kind: "bid", class: "genuine", status: "new", score: 80, confidence: 0.9, confidenceBand: "high",
      buyerId: "b", buyerName: "Example Water Authority", buyerCountry: "OM", projectId: null, projectName: "Line 3",
      projectCountry: "OM", packageName: null, discipline: null, productNames: ["Valves"],
      reasons: [{ text: "Tender open", evidenceIds: [] }, { text: "Closes 18 Oct", evidenceIds: [] }],
      closingDate: "2026-10-18", isSample: true, createdAt: "2026-09-27T00:00:00.000Z",
    } satisfies LeadListItem;
    const csv = leadsToCsv([lead], { l1: ["https://a.example/1", "https://b.example/2"] });
    const [header, row] = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(header.split(",")).toContain("Evidence URLs");
    expect(row).toContain("Genuine,80,High,Bid,Valves,Example Water Authority,Oman,Line 3,Oman");
    expect(row).toContain("Tender open | Closes 18 Oct");
    expect(row).toContain("https://a.example/1 https://b.example/2");
  });

  it("parses inbox filters (tab alias, default open status) and rejects bad ones", () => {
    expect(parseLeadQuery("http://x/api/mvp/leads?tab=research&market=in&kind=bid")).toEqual({
      filter: { class: "research", market: "IN", productId: undefined, kind: "bid", status: "open", runId: undefined, limit: undefined, offset: undefined },
    });
    expect("error" in parseLeadQuery("http://x/api/mvp/leads?status=nope")).toBe(true);
    expect("error" in parseLeadQuery("http://x/api/mvp/leads?run=not-a-uuid")).toBe(true);
  });
});
