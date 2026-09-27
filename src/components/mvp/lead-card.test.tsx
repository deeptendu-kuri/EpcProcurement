import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LeadListItem } from "@/mvp/types";
import { LeadCard } from "./lead-card";

afterEach(cleanup);

const lead: LeadListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "supply_subcontract",
  class: "genuine",
  status: "new",
  score: 86,
  confidence: 0.9,
  confidenceBand: "high",
  buyerId: "b",
  buyerName: "Example Engineering Ltd",
  buyerCountry: "IN",
  projectId: "p",
  projectName: "Gas pipeline Phase 2",
  projectCountry: "IN",
  packageName: "Line pipe package",
  discipline: "pipeline",
  productNames: ["Line pipe"],
  reasons: [
    { text: "Won the EPC contract on 12 Sep (2 sources)", evidenceIds: [] },
    { text: 'Needs 24" X65 line pipe, ~120 km', evidenceIds: [] },
    { text: "Procurement manager identified", evidenceIds: [] },
    { text: "A fourth reason that must not show", evidenceIds: [] },
  ],
  closingDate: "2026-10-18",
  isSample: true,
  createdAt: "2026-09-27T10:00:00.000Z",
};

describe("LeadCard", () => {
  it("renders score, confidence, type, buyer → project, up to 3 reasons and badges", () => {
    render(<LeadCard lead={lead} />);
    expect(screen.getByText("NEW")).toBeTruthy();
    expect(screen.getByText("86")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("Supply · Line pipe")).toBeTruthy();
    expect(screen.getByText("Sample data")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Example Engineering Ltd → Gas pipeline Phase 2/ })).toBeTruthy();
    expect(screen.getByText("(India)")).toBeTruthy();
    expect(screen.getByText(/closes 18 Oct 2026/)).toBeTruthy();
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "Won the EPC contract on 12 Sep (2 sources)",
      'Needs 24" X65 line pipe, ~120 km',
      "Procurement manager identified",
    ]);
  });

  it("hides the sample and new badges for live, accepted leads and never shows internal words", () => {
    const { container } = render(<LeadCard lead={{ ...lead, isSample: false, status: "accepted", closingDate: null }} />);
    expect(screen.queryByText("Sample data")).toBeNull();
    expect(screen.queryByText("NEW")).toBeNull();
    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(container.textContent).not.toMatch(/gate|verdict|client-safe|match score|\bplay\b/i);
  });

  it("accepts and rejects with a reason", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(<LeadCard lead={lead} onAccept={onAccept} onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalledWith(lead.id);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText("Reason for rejecting"), { target: { value: "too_small" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onReject).toHaveBeenCalledWith(lead.id, "too_small");
  });
});
