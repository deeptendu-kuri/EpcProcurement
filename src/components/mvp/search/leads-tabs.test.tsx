import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SEARCH } from "./search-state";
import { SearchWorkspace } from "./search-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); replace.mockReset(); });

const RUN = "11111111-1111-4111-8111-111111111111";
const empty = { rows: [], total: 0, contactsFound: 0, contactsTotal: 0, page: 1, pageSize: 25, proofCounts: { all: 3, verified: 1, likely: 2 },
  facets: { roles: [], countries: [], items: [], signals: [], stages: [], howSure: [], reach: [], industries: [] } };

describe("Leads tabs (docs/mvp/18 §9)", () => {
  it("shows all, verified, likely and companies found with counts, and the search's controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(empty), { status: 200, headers: { "content-type": "application/json" } })));
    render(<SearchWorkspace tab="search" basePath="/crm" state={{ ...DEFAULT_SEARCH, run: RUN }} runs={[{ id: RUN, label: "Steel pipe", status: "running", kind: "paused" }]}
      catalogue={[]} markets={[]} foundCompanies={<p>found list</p>} />);
    const tabs = within(screen.getByRole("tablist", { name: "Leads" }));
    expect((await tabs.findByRole("tab", { name: /All leads\s*3/ })).getAttribute("aria-selected")).toBe("true");
    expect(tabs.getByRole("tab", { name: /Verified\s*1/ })).toBeTruthy();
    expect(tabs.getByRole("tab", { name: /Likely · not verified\s*2/ })).toBeTruthy();
    fireEvent.click(tabs.getByRole("tab", { name: "Companies found" }));
    expect(replace).toHaveBeenCalledWith(`/crm?run=${RUN}&proof=found`, { scroll: false });
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });
  it("shows the companies found in their own tab", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(empty), { status: 200, headers: { "content-type": "application/json" } })));
    render(<SearchWorkspace tab="search" basePath="/crm" state={{ ...DEFAULT_SEARCH, run: RUN, proof: "found" }} runs={[{ id: RUN, label: "Steel pipe", status: "done", kind: "finished" }]}
      catalogue={[]} markets={[]} foundCompanies={<p>found list</p>} />);
    expect(screen.getByText("found list")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });
});
