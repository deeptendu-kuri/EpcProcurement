import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { DashboardData } from "@/mvp/dashboard";
const data = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/mvp/dashboard", () => ({ dashboardData: async () => data.value }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/mvp/tour/guide-button", () => ({ GuideButton: () => <button type="button">Take a quick guide</button> }));
import DashboardPage from "./page";
afterEach(cleanup);

const run = (id: string, query: string, status = "done") => ({ id, status, created_at: "2026-10-09T10:00:00Z", adhoc_query: { query, productId: "plates", markets: ["MY", "IN"], leadKinds: ["supply_subcontract"] }, counters: {}, result_count: 2 });
const example: DashboardData = {
  searches: [{ run: run("run-a", "Steel plates") as never, found: 12, toCheck: 9, conversations: 1, meetings: 1, tokens: 237775, tokenLimit: 240000, minutes: 38, verified: 3, likely: 5 },
    { run: run("run-b", "Example pipe", "running") as never, found: null, toCheck: null, conversations: 0, meetings: 0, tokens: 0, tokenLimit: null, minutes: 4, verified: 0, likely: 1 }],
  earlierSearches: [],
  actions: { review: 1, meetings: [{ opportunityId: "opp-1", company: "Example Engineering", product: "Steel plates", start: "2026-10-10T08:00:00Z", meetUrl: "https://meet.example/abc" }],
    nextMeeting: { opportunityId: "opp-1", company: "Example Engineering", product: "Steel plates", start: "2026-10-10T08:00:00Z", meetUrl: "https://meet.example/abc" },
    inProgress: 2, newBuyers: 3, toCheck: 9, running: [{ id: "run-b", label: "Example pipe" }], paused: [], toVerify: 6 },
  pipeline: { found: 12, buyers: 9, verified: 3, likely: 6, emailed: 2, replied: 1, meetings: 1 },
  latestSearchId: "run-a",
  topLeads: [{ opportunityId: "opp-2", runId: "run-a", name: "KRR Engineering", country: "IN", product: "Steel plates", fit: 82, verification: "rating", email: null }],
  allowance: { left: 250_000, models: [{ model: "openai/gpt-oss-120b", used: 150_000, limit: 200_000, left: 50_000, blockedUntil: null },
    { model: "openai/gpt-oss-20b", used: 200_000, limit: 200_000, left: 0, blockedUntil: "2026-10-10T09:40:00.000Z" }, { model: "qwen/qwen3.8-27b", used: 0, limit: 200_000, left: 200_000, blockedUntil: null }] },
};

describe("Dashboard (docs/mvp/18 §3): today, pipeline and every search", () => {
  it("lists only what needs the user today, each one click away", async () => {
    data.value = example;
    render(await DashboardPage());
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
    const today = within(screen.getByRole("heading", { name: "Today" }).parentElement!);
    expect(today.getByRole("link", { name: /1 email waiting for your review/ }).getAttribute("href")).toBe("/outreach");
    expect(today.getByRole("link", { name: /9 companies named but not checked yet/ }).getAttribute("href")).toBe("/crm?run=run-a&proof=found");
    expect(today.getByRole("link", { name: /6 likely leads to verify/ }).getAttribute("href")).toBe("/crm?run=run-a&proof=likely");
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
    // A finished search can be run again; a running one can be paused, from the table and its card.
    expect(searches.getByRole("link", { name: /Run again/ }).getAttribute("href")).toBe("/find?again=run-a");
    expect(searches.getAllByRole("button", { name: "Pause" })).toHaveLength(1);
    const active = within(screen.getByRole("heading", { name: "Searches running now" }).closest("section")!);
    expect(active.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(active.getByText("0 verified · 1 likely")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join Google Meet" }).getAttribute("href")).toBe("https://meet.example/abc");
  });
  it("shows the best new leads and the AI tokens left today", async () => {
    data.value = example;
    render(await DashboardPage());
    const lead = screen.getByTestId("top-lead");
    expect(within(lead).getByText("Likely")).toBeTruthy();
    expect(within(lead).getByRole("link", { name: "Verify" }).getAttribute("href")).toBe("/crm?run=run-a&proof=likely");
    expect(screen.getByText("250k")).toBeTruthy();
    expect(screen.getByText("out until 09:40 UTC")).toBeTruthy();
    expect(screen.getByText("50k left")).toBeTruthy();
  });
  it("says so when nothing needs the user", async () => {
    data.value = { ...example, actions: { review: 0, meetings: [], nextMeeting: null, inProgress: 0, newBuyers: 0, toCheck: 0, running: [], paused: [], toVerify: 0 } };
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
