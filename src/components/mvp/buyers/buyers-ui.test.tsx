import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuyerRow, BuyerSearchResult, ChainContactRow, ChainNode, ContactSearchResult, SupplyChain } from "@/mvp/buyers/types";
import { AddContactModal } from "./add-contact-modal";
import { ChainContactsTable } from "./chain-contacts-table";
import { SupplyChainTree } from "./supply-chain-tree";
import { buyerSubtitle, dealLine } from "./buyer-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/search",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function node(partial: Partial<ChainNode> & Pick<ChainNode, "nodeId" | "tier" | "name">): ChainNode {
  return {
    parentNodeId: null,
    companyId: null,
    leadId: null,
    derivedKey: null,
    whatTheyDo: "",
    supplies: "",
    link: "not_identified",
    linkWhy: "",
    linkSource: null,
    evidenceIds: [],
    wouldBuy: [],
    competitorFor: [],
    found: 0,
    total: 3,
    candidates: [],
    expandable: false,
    ...partial,
  };
}

const item = (name: string) => ({ itemId: name, name, category: "x", fit: "good" as const, why: "", evidenceIds: [] });

const chain: SupplyChain = {
  rootLeadId: "lead-1",
  rootCompanyId: "co-1",
  peopleTotal: 20,
  peopleFound: 0,
  nodes: [
    node({ nodeId: "t1", tier: 1, name: "Kalpataru Projects (KPIL)", whatTheyDo: "Pipeline builder", companyId: "co-1", leadId: "lead-1", link: "confirmed", wouldBuy: [item("pipe"), item("valves")], total: 7 }),
    node({
      nodeId: "t2:pipe_maker", tier: 2, parentNodeId: "t1", name: "Welspun Corp", whatTheyDo: "Pipe maker", supplies: "line pipe", companyId: "co-2", derivedKey: "k-welspun",
      link: "possible", linkWhy: "Makes line pipe in India", wouldBuy: [item("plates")], competitorFor: ["line pipe"], expandable: true, total: 6,
    }),
    node({
      nodeId: "t2:valve_maker", tier: 2, parentNodeId: "t1", name: "Valve maker", whatTheyDo: "Valve maker", wouldBuy: [item("stud bolts")], total: 5,
      candidates: [{ companyId: "co-9", name: "L&T Valves", country: "IN", why: "Makes pipeline ball valves in India" }],
    }),
    node({ nodeId: "t2:stockist", tier: 2, parentNodeId: "t1", name: "Pipe stockist", whatTheyDo: "Stockist", link: "likely", companyId: "co-3", leadId: "lead-3", linkWhy: "Supplied KPIL before" }),
    node({ nodeId: "t3:pipe_maker:steel", tier: 3, parentNodeId: "t2:pipe_maker", name: "Steel plate / coil mill", whatTheyDo: "Steel mill" }),
  ],
};

function renderTree(overrides: Partial<Parameters<typeof SupplyChainTree>[0]> = {}) {
  const props = {
    chain,
    rootShortName: "KPIL",
    expanded: new Set<string>(),
    candidatesFor: null,
    onCandidatesFor: vi.fn(),
    onToggleExpand: vi.fn(),
    onSetCompany: vi.fn(),
    onRemoveCompany: vi.fn(),
    ...overrides,
  };
  render(<SupplyChainTree {...props} />);
  return props;
}

describe("SupplyChainTree (docs/mvp/15 §B)", () => {
  it("renders tier 1 and tier 2 with their link chips, what they would buy and competitor notes", () => {
    renderTree();
    expect(screen.getByText("Tier 1 · won the work")).toBeTruthy();
    expect(screen.getByText("Tier 2 · supplies KPIL (also buyers for you)")).toBeTruthy();
    expect(screen.queryByText(/Tier 3/)).toBeNull();

    const cards = screen.getAllByTestId("chain-node");
    expect(cards.map((card) => card.getAttribute("data-tier"))).toEqual(["1", "2", "2", "2"]);
    const chips = screen.getAllByTestId("link-chip").map((chip) => chip.textContent);
    expect(chips).toEqual(["Confirmed", "Possible", "Not identified", "Likely"]);

    const welspun = cards[1];
    expect(within(welspun).getByText("Welspun Corp")).toBeTruthy();
    expect(within(welspun).getByText(/Buys from you/)).toBeTruthy();
    expect(within(welspun).getByText("✕ Competitor for line pipe")).toBeTruthy();
    expect(within(welspun).getByText(/Makes line pipe in India/)).toBeTruthy();
    expect(within(welspun).getByText("0 of 6")).toBeTruthy();

    const valve = cards[2];
    expect(within(valve).getByText(/Would buy/)).toBeTruthy();
    expect(within(valve).getByText("— of 5")).toBeTruthy();
    expect(within(valve).getByRole("button", { name: /Find candidates/ })).toBeTruthy();

    expect(within(cards[3]).getByRole("link", { name: /Open buyer/ }).getAttribute("href")).toBe("/buyers/lead-3");
    expect(within(cards[0]).getByText("This buyer")).toBeTruthy();
    // Legend
    expect(screen.getByText("Confirmed (source)")).toBeTruthy();
    expect(screen.getByText("Not identified yet")).toBeTruthy();
  });

  it("shows tier 3 under an expanded tier-2 node and asks to expand", () => {
    const props = renderTree({ expanded: new Set(["t2:pipe_maker"]) });
    expect(screen.getByText("Tier 3 · supplies Welspun Corp")).toBeTruthy();
    expect(screen.getByText("Steel plate / coil mill")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Collapse/ }));
    expect(props.onToggleExpand).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "t2:pipe_maker" }));
  });

  it("lists candidates with why, and sets a company by candidate or by name", () => {
    const props = renderTree({ candidatesFor: "t2:valve_maker" });
    const dialog = screen.getByRole("dialog", { name: /Candidates for Valve maker/ });
    expect(within(dialog).getByText("L&T Valves")).toBeTruthy();
    expect(within(dialog).getByText("Makes pipeline ball valves in India")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this" }));
    expect(props.onSetCompany).toHaveBeenLastCalledWith(expect.objectContaining({ nodeId: "t2:valve_maker" }), { name: "L&T Valves", companyId: "co-9" });

    fireEvent.change(within(dialog).getByLabelText("Set company"), { target: { value: "Virgo Valves" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Set company/ }));
    expect(props.onSetCompany).toHaveBeenLastCalledWith(expect.objectContaining({ nodeId: "t2:valve_maker" }), { name: "Virgo Valves" });
  });

  it("never shows EPC or owner labels", () => {
    renderTree({ expanded: new Set(["t2:pipe_maker"]) });
    expect(document.body.textContent).not.toMatch(/\bEPC\b|\bowner\b|main contractor/i);
  });
});

describe("Buyer page wording (docs/mvp/15 §A)", () => {
  it("shows Buyer · what they do · country and the deal as one line", () => {
    expect(buyerSubtitle({ whatTheyDo: "Pipeline builder", subRoleLabel: null, role: "epc_contractor", country: "India" })).toBe("Buyer · Pipeline builder · India");
    expect(buyerSubtitle({ whatTheyDo: "EPC contractor", subRoleLabel: null, role: "epc_contractor", country: "India" })).toBe("Buyer · Builder · India");
    expect(dealLine({ buyingReason: "Won a gas pipeline contract worth INR 40B", triggerDate: "2026-09-12" })).toBe("won a gas pipeline contract worth INR 40B (Sep 2026)");
  });
});

describe("Add contact (docs/mvp/15 §E)", () => {
  it("submits name, title, email, phone, LinkedIn and notes, then closes", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<AddContactModal company="Welspun Corp" slotTitle="Head of procurement" onSubmit={onSubmit} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Add contact" });
    expect((within(dialog).getByLabelText("Title") as HTMLInputElement).value).toBe("Head of procurement");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  A. Sharma " } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "a.sharma@example.com" } });
    fireEvent.change(within(dialog).getByLabelText("Phone"), { target: { value: "+91 22 5555 0100" } });
    fireEvent.change(within(dialog).getByLabelText("LinkedIn URL"), { target: { value: "https://www.linkedin.com/in/example" } });
    fireEvent.change(within(dialog).getByLabelText("Notes"), { target: { value: "Met at expo" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save contact/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      name: "A. Sharma",
      title: "Head of procurement",
      email: "a.sharma@example.com",
      phone: "+91 22 5555 0100",
      linkedinUrl: "https://www.linkedin.com/in/example",
      notes: "Met at expo",
    });
  });

  it("refuses a bad email and keeps the modal open", () => {
    const onSubmit = vi.fn();
    render(<AddContactModal company="X" slotTitle="Buyer" onSubmit={onSubmit} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /Save contact/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/email/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("All contacts in this supply chain (docs/mvp/15 §E)", () => {
  const rows: ChainContactRow[] = [
    { tier: 1, nodeId: "t1", companyId: "co-1", companyName: "Kalpataru Projects", companyIdentified: true, slotId: "s1", role: "decision_maker", title: "Head of procurement", why: "Signs off new vendors", person: null, status: "not_found", findLinks: [{ label: "LinkedIn", url: "https://www.linkedin.com/search" }] },
    { tier: 2, nodeId: "t2:pipe_maker", companyId: "co-2", companyName: "Welspun Corp", companyIdentified: true, slotId: "s1", role: "decision_maker", title: "Head of procurement", why: "Buys plates", person: { id: "p1", name: "A. Sharma", title: "CPO", email: "a@example.com", phone: null, linkedinUrl: null, evidenceIds: [] }, status: "likely", findLinks: [] },
    { tier: 3, nodeId: "t3:x", companyId: null, companyName: "Testing lab", companyIdentified: false, slotId: "s3", role: "buyer", title: "Lab manager", why: "Buys consumables", person: null, status: "company_first", findLinks: [] },
  ];

  it("counts, filters by tier and decision makers, and offers Find · + Add / Confirm / Find candidates", () => {
    const onAdd = vi.fn();
    const onConfirm = vi.fn();
    const onFind = vi.fn();
    render(<ChainContactsTable rows={rows} onAdd={onAdd} onConfirm={onConfirm} onFindCandidates={onFind} />);
    expect(screen.getByText("3 people to approach · 1 found")).toBeTruthy();
    expect(screen.getAllByTestId("chain-contact-row")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /\+ Add|Add contact/ }));
    expect(onAdd).toHaveBeenCalledWith(rows[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm decision maker" }));
    expect(onConfirm).toHaveBeenCalledWith(rows[1]);
    fireEvent.click(screen.getByRole("button", { name: "Find candidates" }));
    expect(onFind).toHaveBeenCalledWith(rows[2]);
    expect(screen.getByText("Company first")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Tier 2" }));
    expect(screen.getAllByTestId("chain-contact-row")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "All tiers" }));
    fireEvent.click(screen.getByRole("button", { name: "Decision makers" }));
    expect(screen.getAllByTestId("chain-contact-row")).toHaveLength(2);
  });
});

describe("SuperSearch Buyers | Contacts switch (docs/mvp/15 §E, §F)", () => {
  const row: BuyerRow = {
    leadId: "11111111-1111-4111-8111-111111111111", name: "Kalpataru Projects", subRoleLabel: null, role: "epc_contractor", roleLabel: "EPC contractor",
    buyingReason: "Won a gas pipeline contract", sellSummary: "Line pipe, valves", competitorNote: null, country: "IN", fitScore: 64, howSure: "high", stage: "ready",
    found: 0, total: 7, isSample: false, triggerDate: null, whatTheyDo: "Pipeline builder", tier: 1, foundVia: null, dealsCount: 3, derivedKey: null, storedLeadId: "11111111-1111-4111-8111-111111111111", link: null,
  };
  const derived: BuyerRow = {
    ...row, leadId: "derived:k-welspun", name: "Welspun Corp", whatTheyDo: "Pipe maker", role: "manufacturer", roleLabel: "Manufacturer", tier: 2, dealsCount: 1,
    foundVia: { leadId: row.leadId, name: "Kalpataru Projects" }, derivedKey: "k-welspun", storedLeadId: null, link: "possible", buyingReason: "",
  };
  const facets = { roles: [], countries: [], items: [], signals: [], stages: [], howSure: [], reach: [], industries: [] };
  const buyers: BuyerSearchResult = { rows: [row, derived], total: 2, facets, contactsFound: 0, contactsTotal: 13, page: 1, pageSize: 25 };
  const contacts: ContactSearchResult = {
    rows: [
      { leadId: row.leadId, companyId: "co-1", company: "Kalpataru Projects", role: "epc_contractor", roleLabel: "EPC contractor", country: "IN", slotId: "s1", slotRole: "decision_maker", slotTitle: "Head of procurement", person: null, status: "not_found", findLinks: [{ label: "LinkedIn", url: "https://www.linkedin.com/x" }] },
      { leadId: row.leadId, companyId: "co-1", company: "Kalpataru Projects", role: "epc_contractor", roleLabel: "EPC contractor", country: "IN", slotId: "s2", slotRole: "buyer", slotTitle: "Category buyer", person: { id: "p1", name: "R. Mehta", title: "Buyer", evidenceIds: [] }, status: "likely", findLinks: [] },
    ],
    total: 2, found: 1, page: 1, pageSize: 25,
  };
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      const body = url.includes("/contacts") ? contacts : buyers;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows tier, found via, +N deals and Save as buyer, then renders the contacts rows with Find / Add / Confirm", async () => {
    const { SearchWorkspace } = await import("../search/search-workspace");
    const { DEFAULT_SEARCH } = await import("../search/search-state");
    render(<SearchWorkspace tab="search" state={DEFAULT_SEARCH} catalogue={[]} markets={[]} />);

    const table = await screen.findByRole("table", { name: "Buyers" });
    expect(within(table).getByText("Pipeline builder")).toBeTruthy();
    expect(within(table).getByText("+2 more deals")).toBeTruthy();
    const tiers = within(table).getAllByTestId("tier-cell");
    expect(tiers[1].textContent).toMatch(/Tier 2/);
    expect(tiers[1].textContent).toMatch(/Found via\s*Kalpataru Projects/);
    expect(within(table).getByRole("button", { name: /Save as buyer/ })).toBeTruthy();
    expect(table.textContent).not.toMatch(/\bEPC\b/);

    fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Contacts" }));
    const people = await screen.findByRole("table", { name: "Contacts" });
    expect(within(people).getAllByTestId("contact-row")).toHaveLength(2);
    expect(within(people).getByText("Head of procurement")).toBeTruthy();
    expect(within(people).getByRole("link", { name: "Find" })).toBeTruthy();
    expect(within(people).getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/mvp/buyers/contacts"))).toBe(true);

    fireEvent.click(within(people).getByRole("button", { name: /Add contact/ }));
    expect(screen.getByRole("dialog", { name: "Add contact" })).toBeTruthy();
  });
});
