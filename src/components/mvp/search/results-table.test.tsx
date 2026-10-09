import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BuyerRow } from "@/mvp/buyers/types";
import { ResultsTable } from "./results-table";

afterEach(cleanup);
const row: BuyerRow = {
  leadId: "11111111-1111-4111-8111-111111111111", name: "Kalpataru Projects", subRoleLabel: null, role: "epc_contractor", roleLabel: "EPC contractor",
  buyingReason: "Won a gas pipeline contract", sellSummary: "Line pipe, valves", competitorNote: null, country: "IN", fitScore: 64, howSure: "high", stage: "ready",
  found: 0, total: 7, isSample: false, triggerDate: null, whatTheyDo: "Pipeline builder", tier: 1, foundVia: null, dealsCount: 1, derivedKey: null,
  storedLeadId: "11111111-1111-4111-8111-111111111111", link: null,
  searches: [{ runId: "r1", label: "steel pipe · 8 Oct" }, { runId: "r2", label: "line pipe · 1 Oct" }],
  searchedProduct: "Line pipe (API 5L)", emailStatus: "Meeting booked", opportunityId: null,
};
const show = (rows: BuyerRow[]) => render(<ResultsTable rows={rows} selected={new Set()} openId="" onToggle={() => {}} onOpen={() => {}} />);

describe("Leads table columns (docs/mvp/17 §4.4)", () => {
  it("shows the search, what we can sell from that search and the email status", () => {
    show([row]);
    const table = screen.getByRole("table");
    for (const name of ["Company", "Role in the chain", "Why they buy", "What we can sell", "Where", "From search", "Email", "Fit", "Contacts"])
      expect(within(table).getByRole("columnheader", { name })).toBeTruthy();
    expect(within(table).getByText("Line pipe (API 5L)")).toBeTruthy();
    expect(within(table).queryByText("Line pipe, valves")).toBeNull();
    expect(within(table).getByText("steel pipe · 8 Oct")).toBeTruthy();
    expect(within(table).getByText("+1 more")).toBeTruthy();
    expect(within(table).getByText("Meeting booked")).toBeTruthy();
    expect(within(table).getByTestId("tier-cell").textContent).toMatch(/Tier 1/);
  });
  it("falls back honestly when a row has no search, email or score", () => {
    show([{ ...row, searches: [], searchedProduct: null, emailStatus: null, fitScore: 0 }]);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Line pipe, valves")).toBeTruthy();
    expect(within(table).getByText("Not scored")).toBeTruthy();
    expect(within(table).queryByText("Meeting booked")).toBeNull();
  });
});
