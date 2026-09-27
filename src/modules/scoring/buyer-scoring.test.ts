import { describe, expect, it, vi } from "vitest";
import { calculateBuyerScore } from "./buyer-scoring";
import type { ProductRequirement, Signal, SourceEvidence } from "@/types/domain";

describe("calculateBuyerScore", () => {
  it("keeps score explainable and separate from confidence", () => {
    vi.setSystemTime(new Date("2026-08-27T00:00:00Z"));
    const signals: Signal[] = [
      {
        id: "signal-1",
        companyId: "company-1",
        sourceId: "source-1",
        signalType: "EPC_AWARD",
        signalStrength: 88,
        signalDate: "2026-08-24",
        confidence: 0.9,
        summary: "Awarded gas pipeline package",
      },
      {
        id: "signal-2",
        companyId: "company-1",
        sourceId: "source-2",
        signalType: "TENDER_RELEASED",
        signalStrength: 92,
        signalDate: "2026-08-26",
        confidence: 0.86,
        summary: "Tender released",
      },
    ];
    const requirements: ProductRequirement[] = [
      {
        id: "req-1",
        companyId: "company-1",
        sourceId: "source-1",
        productCategory: "Line Pipe",
        standard: "API 5L",
        grade: "X65",
        confidence: 0.91,
      },
    ];
    const sources: SourceEvidence[] = [
      {
        id: "source-1",
        url: "https://example.com/a",
        domain: "example.com",
        sourceType: "company",
        reliability: "High",
        title: "Award",
      },
      {
        id: "source-2",
        url: "https://example.com/b",
        domain: "example.com",
        sourceType: "tender",
        reliability: "Very High",
        title: "Tender",
      },
    ];

    const score = calculateBuyerScore({
      companyId: "company-1",
      signals,
      requirements,
      sources,
      hasTradeVerification: false,
    });

    expect(score.score).toBe(75);
    expect(score.confidence).toBe("High");
    expect(score.tradeScore).toBe(0);
    expect(score.reasons.map((reason) => reason.label)).toContain("Exact product specification detected");
  });
});
