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
  searches: [{ run: run("run-a", "Steel plates") as never, found: 12, toCheck: 9, conversations: 1, meetings: 1 },
    { run: run("run-b", "Example pipe", "running") as never, found: null, toCheck: null, conversations: 0, meetings: 0 }],
  earlierSearches: [],
  actions: { review: 1, meetings: [{ opportunityId: "opp-1", company: "Example Engineering", product: "Steel plates", start: "2026-10-10T08:00:00Z", meetUrl: "https://meet.example/abc" }],
    nextMeeting: { opportunityId: "opp-1", company: "Example Engineering", product: "Steel plates", start: "2026-10-10T08:00:00Z", meetUrl: "https://meet.example/abc" },
    inProgress: 2, newBuyers: 3, toCheck: 9, running: [{ id: "run-b", label: "Example pipe" }] },
  pipeline: { found: 12, buyers: 4, emailed: 2, replied: 1, meetings: 1 },
  latestSearchId: "run-a",
};

describe("Dashboard: action plan and every search", () => {
  it("shows the action plan with one-click destinations", async () => {
    data.value = example;
    render(await DashboardPage());
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
    const plan = within(screen.getByRole("region", { name: "Action plan" }));
    expect(plan.getByRole("link", { name: /Emails to review/ }).getAttribute("href")).toBe("/outreach");
    expect(plan.getByRole("link", { name: /Companies to check/ }).getAttribute("href")).toBe("/crm?run=run-a#found-companies");
    expect(plan.getByRole("link", { name: /Searches running/ }).getAttribute("href")).toBe("/find?run=run-b");
    expect(plan.getByText(/Next: Example Engineering/)).toBeTruthy();
  });
  it("gives every search a Progress and a Leads button", async () => {
    data.value = example;
    render(await DashboardPage());
    const searches = within(screen.getByRole("region", { name: "Your searches" }));
    expect(searches.getAllByRole("link", { name: /Progress/ }).map((a) => a.getAttribute("href"))).toEqual(["/find?run=run-a", "/find?run=run-b"]);
    expect(searches.getAllByRole("link", { name: /^Leads/ }).map((a) => a.getAttribute("href"))).toEqual(["/crm?run=run-a", "/crm?run=run-b"]);
    expect(searches.getByText("9 to check")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join Google Meet" }).getAttribute("href")).toBe("https://meet.example/abc");
  });
  it("starts with a plain getting-started card when there are no searches", async () => {
    data.value = { ...example, searches: [], latestSearchId: null };
    render(await DashboardPage());
    expect(screen.getByRole("heading", { name: "Start with what you sell." })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Action plan" })).toBeNull();
  });
});
