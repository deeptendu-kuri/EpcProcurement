import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EvidenceView, ScoreBreakdown as Breakdown } from "@/mvp/types";
import { EvidenceProvider } from "./evidence";
import { ScoreBreakdown } from "./score-breakdown";

afterEach(cleanup);

const EVIDENCE_ID = "22222222-2222-4222-8222-222222222222";

const breakdown: Breakdown = {
  criteria: [
    {
      id: "C1", label: "Scope fit", max: 25, total: 16,
      subs: [
        { id: "1.1", label: "Discipline match", max: 10, points: 10, reason: "Pipeline is one of your disciplines", evidenceIds: [EVIDENCE_ID] },
        { id: "1.2", label: "Product / spec match", max: 6, points: 6, reason: "24-inch X65 is in range", evidenceIds: [] },
        { id: "1.3", label: "Project type match", max: 5, points: 0, reason: "Sector not in your list", evidenceIds: [] },
        { id: "1.4", label: "Size", max: 4, points: null, reason: "Value not published", evidenceIds: [] },
      ],
    },
    {
      id: "C2", label: "Timing", max: 20, total: 12,
      subs: [
        { id: "2.1", label: "Stage window", max: 8, points: 8, reason: "Awarded 2 weeks ago", evidenceIds: [] },
        { id: "2.2", label: "Deadline ahead", max: 5, points: null, reason: "", evidenceIds: [] },
      ],
    },
  ],
  unknown: ["1.4", "2.2"],
};

const evidence: Record<string, EvidenceView> = {
  [EVIDENCE_ID]: {
    id: EVIDENCE_ID, document_id: null, url: "https://example.com/award", quote: "awarded the pipeline EPC contract",
    char_start: 0, char_end: 10, extracted_by: "rule:award", quote_verified: true, agreement: "rule", tier: "A",
    publisher_key: "example.com", observed_at: "2026-09-12T00:00:00.000Z", created_at: "2026-09-12T00:00:00.000Z",
    sourceName: "Example Exchange", sourceKey: "fixture", documentTitle: null, publishedAt: "2026-09-12T00:00:00.000Z", isSample: true,
  },
};

describe("ScoreBreakdown", () => {
  it("shows the criteria totals in one line", () => {
    render(<ScoreBreakdown breakdown={breakdown} score={28} />);
    expect(screen.getByText("Scope")).toBeTruthy();
    expect(screen.getByText("Timing")).toBeTruthy();
    expect(screen.getByText("= 28")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show all 6 checks" })).toBeTruthy();
  });

  it("renders unknown sub-criteria as “Not found yet” with ✓ / ✗ for the rest", () => {
    render(<ScoreBreakdown breakdown={breakdown} score={28} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 6 checks" }));
    expect(screen.getAllByText("Not found yet")).toHaveLength(2);
    const size = screen.getByText("Size").closest("li")!;
    expect(within(size).getByText("Not found yet")).toBeTruthy();
    expect(within(size).getByLabelText("Unknown")).toBeTruthy();
    expect(size.textContent).toContain("0 / 4");
    expect(within(screen.getByText("Discipline match").closest("li")!).getByLabelText("Yes")).toBeTruthy();
    expect(within(screen.getByText("Project type match").closest("li")!).getByLabelText("No")).toBeTruthy();
  });

  it("opens the proof panel with the quote and source from ⓘ", () => {
    render(
      <EvidenceProvider evidence={evidence}>
        <ScoreBreakdown breakdown={breakdown} score={28} defaultExpanded />
      </EvidenceProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Discipline match \(1 source\)/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("awarded the pipeline EPC contract")).toBeTruthy();
    expect(within(dialog).getByText("Example Exchange")).toBeTruthy();
    expect(within(dialog).getByText("Quote found on the page")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: /Open page/ }).getAttribute("href")).toBe("https://example.com/award");
  });

  it("says when the lead is not scored", () => {
    render(<ScoreBreakdown breakdown={{ criteria: [], unknown: [] }} score={null} />);
    expect(screen.getByText("This lead has not been scored yet.")).toBeTruthy();
  });
});
