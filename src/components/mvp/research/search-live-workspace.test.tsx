import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SearchWorkspaceData } from "@/mvp/research/workspace";
import type { FoundCompany } from "@/mvp/research/found";
import { SearchLiveWorkspace } from "./search-live-workspace";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const company = (over: Partial<FoundCompany>): FoundCompany => ({ id: "c", name: "Example", website: null, status: "not_checked", statusText: "Not checked yet", source: null, quote: null,
  pagesRead: 0, opportunityId: null, relevant: true, likelyRole: null, rating: null, ratingRole: null, ratingReason: null, alsoBuys: [], guessed: false, buyerType: null, match: null, ...over });
const data: SearchWorkspaceData = {
  run: { id: "11111111-1111-4111-8111-111111111111", query: "Steel plates", productId: "plates", product: "Steel plates", markets: ["IN", "MY"], status: "running", statusText: "Running",
    createdAt: "2026-10-09T14:27:00Z", finishedAt: null, error: null, stopReason: null },
  phase: "Rating and checking companies", running: true, minutes: 12,
  usage: { tokens: 48200, tokenLimit: 240000, aiCalls: 9, pagesRead: 31, pageLimit: 160, searches: 6, searchLimit: 12 },
  counts: { found: 3, rated: 3, likely: 2, verified: 1, checking: 0, notBuyers: 1 },
  buyers: [{ opportunityId: "22222222-2222-4222-8222-222222222222", name: "KRR Engineering", role: "fabricator", country: "IN", fit: 82, reason: "", email: "Intro sent" }],
  companies: [
    company({ id: "a", name: "KRR Engineering", rating: 82, ratingRole: "Pressure vessel fabricator", ratingReason: "Rolls plates into vessel shells and heads.", alsoBuys: ["Flanges"], opportunityId: "22222222-2222-4222-8222-222222222222", status: "saved" }),
    company({ id: "b", name: "Uni-Vessels Engineering", rating: 74, ratingRole: "Pressure vessel fabricator", ratingReason: "Builds pressure vessels.", status: "no_website", statusText: "Website not found yet" }),
    company({ id: "c", name: "Octave", rating: 30, ratingRole: "Not clear yet", ratingReason: "The source does not say what it does." }),
    company({ id: "d", name: "Lubrex FZE", rating: 4, relevant: false, ratingRole: "Lubricant trader", ratingReason: "Trades lubricants." }),
  ],
  events: [{ id: 2, ts: "2026-10-09T14:39:00Z", message: "Shortlist: rated 4 companies; 2 look like buyers." }],
};

describe("Search workspace (docs/mvp/18 §4)", () => {
  it("shows time, AI tokens, pages and the counts while the search runs", () => {
    render(<SearchLiveWorkspace runId={data.run.id} initial={data} />);
    expect(screen.getByRole("heading", { name: "Steel plates" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Running · Rating and checking companies");
    const stats = within(screen.getByRole("region", { name: "Search status" }));
    expect(stats.getByText("12 min")).toBeTruthy();
    expect(stats.getByText("48.2k")).toBeTruthy();
    expect(stats.getByText("of 240k for this search · 9 calls")).toBeTruthy();
    expect(stats.getByText("31")).toBeTruthy();
    expect(screen.getByRole("link", { name: /See leads \(1\)/ }).getAttribute("href")).toBe(`/crm?run=${data.run.id}`);
  });
  it("lists likely buyers first with what they will buy and why, and keeps non-buyers apart", () => {
    render(<SearchLiveWorkspace runId={data.run.id} initial={data} />);
    const rows = screen.getAllByTestId("shortlist-row");
    expect(rows.map((r) => within(r).getAllByText(/Engineering|Octave|Lubrex/)[0].textContent)).toEqual(["KRR Engineering", "Uni-Vessels Engineering"]);
    expect(rows[0].textContent).toContain("Will buy Steel plates: Rolls plates into vessel shells and heads.");
    expect(rows[0].textContent).toContain("Also buys: Flanges");
    expect(within(rows[0]).getByText("Verified buyer")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /All found/ }));
    expect(screen.getAllByTestId("shortlist-row")).toHaveLength(3);
    expect(screen.getAllByTestId("shortlist-row")[2].textContent).toContain("Unlikely: ");
    fireEvent.click(screen.getByRole("tab", { name: /Not buyers/ }));
    expect(screen.getAllByTestId("shortlist-row")[0].textContent).toContain("Lubrex FZE");
  });
  it("checks the top rated companies in one click", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "Checking 1 company." }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SearchLiveWorkspace runId={data.run.id} initial={{ ...data, companies: [...data.companies, company({ id: "e", name: "Kawan Engineering", rating: 66 })] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Check top 3" }));
    await waitFor(() => expect(screen.getByText("Checking 1 company.")).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/mvp/research/${data.run.id}/companies`);
    expect(JSON.parse(String(init.body))).toEqual({ candidateIds: ["b", "c", "e"] });
  });
  it("stops a running search after asking, keeping what it found", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ runId: data.run.id, state: "cancelled" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SearchLiveWorkspace runId={data.run.id} initial={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop search" }));
    const dialog = within(screen.getByRole("alertdialog", { name: "Stop this search?" }));
    expect(dialog.getByText(/found so far are kept/)).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Stop search" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Stopped by you"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/mvp/runs/${data.run.id}`);
    expect(JSON.parse(String(init.body))).toEqual({ action: "cancel" });
    expect(screen.queryByRole("button", { name: "Stop search" })).toBeNull();
  });
  it("offers no stop button once a search has finished", () => {
    render(<SearchLiveWorkspace runId={data.run.id} initial={{ ...data, running: false, run: { ...data.run, status: "done", statusText: "Finished" } }} />);
    expect(screen.queryByRole("button", { name: "Stop search" })).toBeNull();
  });
});
