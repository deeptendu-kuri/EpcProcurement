import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BuyerRow } from "@/mvp/buyers/types";
import { ResultsTable, ratingWord } from "./results-table";

afterEach(cleanup);
const row: BuyerRow = {
  leadId: "11111111-1111-4111-8111-111111111111", name: "Kalpataru Projects", subRoleLabel: null, role: "epc_contractor", roleLabel: "EPC contractor",
  buyingReason: "Won a gas pipeline contract", sellSummary: "Line pipe, valves", competitorNote: null, country: "IN", fitScore: 64, howSure: "high", stage: "ready",
  found: 0, total: 7, isSample: false, triggerDate: null, whatTheyDo: "Pipeline builder", tier: 1, foundVia: null, dealsCount: 1, derivedKey: null,
  storedLeadId: "11111111-1111-4111-8111-111111111111", link: null,
  searches: [{ runId: "r1", label: "steel pipe · 8 Oct" }, { runId: "r2", label: "line pipe · 1 Oct" }],
  searchedProduct: "Line pipe (API 5L)", emailStatus: "Meeting booked", opportunityId: null,
  alsoSell: ["Gate valves", "Flanges"], searchFit: "potential",
};
const show = (rows: BuyerRow[]) => render(<ResultsTable rows={rows} selected={new Set()} openId="" onToggle={() => {}} onOpen={() => {}} />);

describe("Leads table columns (docs/mvp/18 §2)", () => {
  it("shows the search second, what they will buy, what else we can sell, the rating and the email status", () => {
    show([row]);
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Select", "Company", "Search", "Will buy", "Also can sell", "Rating", "Email", "Contacts"]);
    expect(within(table).getByTestId("search-cell").textContent).toBe("steel pipe · 8 Oct+1 more search");
    expect(within(table).getByText("Line pipe (API 5L)")).toBeTruthy();
    expect(within(table).getByText("Their work uses it")).toBeTruthy();
    expect(within(table).queryByText("Line pipe, valves")).toBeNull();
    expect(within(table).getByText("Gate valves, Flanges")).toBeTruthy();
    expect(within(table).getByText("Meeting booked")).toBeTruthy();
    expect(within(table).getAllByTitle(/Buyer fit for this search/).map((e) => e.textContent)).toContain("64Good");
    expect(within(table).getByText("Pipeline builder")).toBeTruthy();
    expect(within(table).getByTestId("tier-cell").textContent).toMatch(/Tier 1/);
  });
  it("falls back honestly when a row has no search, email or rating", () => {
    show([{ ...row, searches: [], searchedProduct: null, emailStatus: null, fitScore: 0, alsoSell: [], searchFit: null }]);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Line pipe, valves")).toBeTruthy();
    expect(within(table).getByText("Not rated")).toBeTruthy();
    expect(within(table).getByTestId("search-cell").textContent).toBe("—");
    expect(within(table).queryByText("Meeting booked")).toBeNull();
  });
  it("turns the 0–100 fit into a word", () => {
    expect([80, 50, 20, 0].map((n) => ratingWord(n).word)).toEqual(["Strong", "Good", "Possible", "Not rated"]);
  });
});
