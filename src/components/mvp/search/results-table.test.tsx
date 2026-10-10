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
  it("shows a work-based search's proof as bullets: their work and why it needs the item (docs/mvp/20)", () => {
    show([{ ...row, need: { work: "KPIL received a Letter of Award for the EPC of a gas pipeline project in the UAE.", why: "A gas pipeline is built from line pipe." } }]);
    const bullets = within(screen.getByTestId("need-bullets")).getAllByRole("listitem").map((li) => li.textContent);
    expect(bullets).toEqual(["Their work: KPIL received a Letter of Award for the EPC of a gas pipeline project in the UAE.", "Why: A gas pipeline is built from line pipe."]);
    expect(screen.queryByText("Won a gas pipeline contract")).toBeNull();
  });
  it("reads the need proof out of a work-based search's reason", async () => {
    const { needOf } = await import("@/mvp/buyers");
    expect(needOf("KPIL received a Letter of Award. Why it needs Line pipe (API 5L): A gas pipeline is built from line pipe."))
      .toEqual({ work: "KPIL received a Letter of Award.", why: "A gas pipeline is built from line pipe." });
    expect(needOf("Won a contract. Potential need: Station valves")).toBeNull();
  });
  it("marks companies a search first found this week (new work since the last check)", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    render(<ResultsTable rows={[{ ...row, firstFoundAt: "2026-10-08T09:00:00Z" }, { ...row, leadId: "33333333-3333-4333-8333-333333333333", name: "Older Buyer", firstFoundAt: "2026-09-20T09:00:00Z" }]}
      selected={new Set()} openId="" onToggle={() => {}} onOpen={() => {}} now={now} />);
    expect(screen.getAllByText("New this week")).toHaveLength(1);
    expect(screen.getByText("New this week").closest("tr")?.getAttribute("data-lead-id")).toBe(row.leadId);
  });
  it("turns the 0–100 fit into a word", () => {
    expect([80, 50, 20, 0].map((n) => ratingWord(n).word)).toEqual(["Strong", "Good", "Possible", "Not rated"]);
  });
});
