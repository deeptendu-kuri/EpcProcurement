import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { DashboardData } from "@/mvp/dashboard";
const data = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/mvp/dashboard", () => ({ dashboardData: async () => data.value }));
vi.mock("@/components/mvp/tour/guide-button", () => ({ GuideButton: () => <button type="button">Take a quick guide</button> }));
import DashboardPage from "./page";
afterEach(cleanup);

const run = (id: string, query: string, status = "done") => ({ id, status, created_at: "2026-10-09T10:00:00Z", adhoc_query: { query, productId: "plates", markets: ["MY", "IN"], leadKinds: ["supply_subcontract"] }, counters: {}, result_count: 2 });
const example: DashboardData = {
  searches: [{ run: run("run-a", "Steel plates") as never, found: 12, toCheck: 9, conversations: 1, meetings: 1, tokens: 237775, minutes: 38 },
    { run: run("run-b", "Example pipe", "running") as never, found: null, toCheck: null, conversations: 0, meetings: 0, tokens: 0, minutes: 4 }],
  earlierSearches: [],
  actions: { review: 1, meetings: [{ opportunityId: "opp-1", company: "Example Engineering", product: "Steel plates", start: "2026-10-10T08:00:00Z", meetUrl: "https://meet.example/abc" }],
    nextMeeting: { opportunityId: "opp-1", company: "Example Engineering", product: "Steel plates", start: "2026-10-10T08:00:00Z", meetUrl: "https://meet.example/abc" },
    inProgress: 2, newBuyers: 3, toCheck: 9, running: [{ id: "run-b", label: "Example pipe" }] },
  pipeline: { found: 12, buyers: 4, emailed: 2, replied: 1, meetings: 1 },
  latestSearchId: "run-a",
};

describe("Dashboard (docs/mvp/18 §3): today, pipeline and every search", () => {
  it("lists only what needs the user today, each one click away", async () => {
    data.value = example;
    render(await DashboardPage());
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
    const today = within(screen.getByRole("heading", { name: "Today" }).parentElement!);
    expect(today.getByRole("link", { name: /1 email waiting for your review/ }).getAttribute("href")).toBe("/outreach");
    expect(today.getByRole("link", { name: /9 companies named but not checked yet/ }).getAttribute("href")).toBe("/crm?run=run-a#found-companies");
    expect(today.getByRole("link", { name: /1 search running now/ }).getAttribute("href")).toBe("/find?run=run-b");
    expect(today.getByRole("link", { name: /Next meeting: Example Engineering/ }).getAttribute("href")).toBe("https://meet.example/abc");
  });
  it("gives every search its workspace, its leads, its time and its AI tokens", async () => {
    data.value = example;
    render(await DashboardPage());
    const searches = within(screen.getByRole("heading", { name: "Your searches" }).closest("section")!);
    expect(searches.getAllByRole("link", { name: "Open" }).map((a) => a.getAttribute("href"))).toEqual(["/find?run=run-a", "/find?run=run-b"]);
    expect(searches.getAllByRole("link", { name: /^Leads/ }).map((a) => a.getAttribute("href"))).toEqual(["/crm?run=run-a", "/crm?run=run-b"]);
    expect(searches.getByText("38 min · 238k AI tokens")).toBeTruthy();
    expect(searches.getByText("Running")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join Google Meet" }).getAttribute("href")).toBe("https://meet.example/abc");
  });
  it("says so when nothing needs the user", async () => {
    data.value = { ...example, actions: { review: 0, meetings: [], nextMeeting: null, inProgress: 0, newBuyers: 0, toCheck: 0, running: [] } };
    render(await DashboardPage());
    expect(screen.getByText(/You are all caught up/)).toBeTruthy();
  });
  it("starts with a plain getting-started card when there are no searches", async () => {
    data.value = { ...example, searches: [], latestSearchId: null };
    render(await DashboardPage());
    expect(screen.getByRole("heading", { name: "Start with what you sell." })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Today" })).toBeNull();
  });
});
