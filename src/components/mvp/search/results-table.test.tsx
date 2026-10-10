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
  it("shows the search second, what they will buy, the rating, the email status and an Open details button last", () => {
    show([row]);
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Select", "Company", "Search", "Will buy", "Rating", "Email", "Contacts", "Details"]);
    expect(within(table).getByTestId("search-cell").textContent).toBe("steel pipe · 8 Oct+1 more search");
    expect(within(table).getByText("Line pipe (API 5L)")).toBeTruthy();
    expect(within(table).getByText("Their work uses it")).toBeTruthy();
    expect(within(table).queryByText("Line pipe, valves")).toBeNull();
    // "Also can sell" was removed after the 10 Oct client meeting.
    expect(within(table).queryByText("Gate valves, Flanges")).toBeNull();
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
  it("opens the opportunity workspace from the last column and comes back to this Leads view", () => {
    render(<ResultsTable rows={[{ ...row, opportunityId: "22222222-2222-4222-8222-222222222222" }]} selected={new Set()} openId="" onToggle={() => {}} onOpen={() => {}} returnTo="/crm?run=all&page=2" />);
    const link = screen.getByRole("link", { name: "Open details of Kalpataru Projects" });
    expect(link.getAttribute("href")).toBe("/opportunities/22222222-2222-4222-8222-222222222222?returnTo=%2Fcrm%3Frun%3Dall%26page%3D2");
  });
  it("keeps Open details visible but disabled without a saved opportunity", () => {
    show([row]);
    const button = screen.getByRole("button", { name: "Open details" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("No saved opportunity for this search yet");
  });
  it("turns the 0–100 fit into a word", () => {
    expect([80, 50, 20, 0].map((n) => ratingWord(n).word)).toEqual(["Strong", "Good", "Possible", "Not rated"]);
  });
});
