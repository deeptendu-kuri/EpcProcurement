import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuyerView } from "@/mvp/buyers/types";
import { AnyNotChips } from "./filter-chips";
import { BuyerSidebarView } from "./buyer-sidebar";
import { DEFAULT_SEARCH, applySearchChange, parseSearchState, searchHref, toBuyerSearch } from "./search-state";
import {FilterPanel} from './filter-panel';

afterEach(cleanup);

describe("SuperSearch URL state (docs/mvp/14 §10)", () => {
  it('round-trips strict trigger kind/age filters and resets pagination',()=>{
    const state=parseSearchState({trigger:'award,order,bogus',age:'90',page:'4'});
    expect(toBuyerSearch(state,[]).triggers).toEqual({kinds:['award','order'],withinDays:90});
    expect(parseSearchState(new URLSearchParams(searchHref(state).split('?')[1]))).toEqual(state);
    expect(applySearchChange(state,{triggerAge:'undated'}).page).toBe(1);
    expect(toBuyerSearch({...state,triggerAge:'undated'},[]).triggers).toEqual({kinds:['award','order'],undated:true});
  });
  it('offers only countries present in results, not the discovery country catalogue',()=>{
    render(<FilterPanel state={DEFAULT_SEARCH} facets={{countries:[{value:'AE',label:'UAE',count:2}]} as never} markets={[{code:'AE',name:'UAE'},{code:'IN',name:'India'},{code:'BE',name:'Belgium'}]} catalogue={[]} onChange={vi.fn()} onClear={vi.fn()} onCollapse={vi.fn()}/>);
    expect(screen.getByRole('button',{name:/Add UAE/})).toBeTruthy();
    expect(screen.queryByRole('button',{name:/Add India/})).toBeNull();
    expect(screen.queryByRole('button',{name:/Add Belgium/})).toBeNull();
    expect(screen.getByLabelText('Trigger age')).toBeTruthy();
  });
  it("round-trips filters through the URL and writes only non-default values", () => {
    const state = {
      ...DEFAULT_SEARCH,
      locAny: ["SA", "IN"],
      locNot: ["Riyadh"],
      roleAny: ["epc_contractor" as const],
      roleNot: ["distributor" as const],
      sell: ["cat:Valves", "bw-fittings"],
      hideCompetitors: false,
      withinDays: 90,
      page: 2,
    };
    const href = searchHref(state);
    expect(href).toBe("/search?loc=SA%2CIN&locx=Riyadh&role=epc_contractor&rolex=distributor&sell=cat%3AValves%2Cbw-fittings&comp=show&days=90&page=2");
    expect(parseSearchState(new URLSearchParams(href.split("?")[1]))).toEqual(state);
    expect(searchHref(DEFAULT_SEARCH)).toBe("/search");
  });

  it("goes back to page 1 when a filter changes, and ignores unknown values", () => {
    const next = applySearchChange({ ...DEFAULT_SEARCH, page: 4 }, { roleAny: ["owner"] });
    expect(next.page).toBe(1);
    expect(applySearchChange({ ...DEFAULT_SEARCH, page: 4 }, { page: 5 }).page).toBe(5);
    expect(parseSearchState({ role: "owner,supplier", stage: "ready,bogus" })).toMatchObject({ roleAny: ["owner"], stage: ["ready"] });
  });

  it("keeps the Leads tab in the URL and sends only verified/likely to the server", () => {
    expect(parseSearchState({ proof: "likely" }).proof).toBe("likely");
    expect(parseSearchState({ proof: "bogus" }).proof).toBe("");
    expect(searchHref({ ...DEFAULT_SEARCH, proof: "verified" }, "/crm")).toBe("/crm?proof=verified");
    expect(toBuyerSearch({ ...DEFAULT_SEARCH, proof: "likely" }, []).proof).toBe("likely");
    expect(toBuyerSearch({ ...DEFAULT_SEARCH, proof: "found" }, []).proof).toBeUndefined();
    expect(applySearchChange({ ...DEFAULT_SEARCH, page: 3 }, { proof: "verified" }).page).toBe(1);
  });

  it("keeps the selected search in the Leads URL and sends only a real run to the server (doc 17)", () => {
    const run = "11111111-1111-4111-8111-111111111111";
    expect(parseSearchState({ run }).run).toBe(run);
    expect(parseSearchState({ run: "all" }).run).toBe("all");
    expect(parseSearchState({ run: "1; drop table runs" }).run).toBe("");
    expect(searchHref({ ...DEFAULT_SEARCH, run }, "/crm")).toBe(`/crm?run=${run}`);
    expect(toBuyerSearch({ ...DEFAULT_SEARCH, run }, []).run).toBe(run);
    expect(toBuyerSearch({ ...DEFAULT_SEARCH, run: "all" }, []).run).toBeUndefined();
  });

  it("builds the BuyerSearch body, expanding catalogue categories into item ids", () => {
    const body = toBuyerSearch(
      { ...DEFAULT_SEARCH, locAny: ["AE"], roleNot: ["owner"], sell: ["cat:Valves", "flanges"], signals: ["order_won"], withinDays: 90 },
      [
        { id: "ball-valves", name: "Ball valves", category: "Valves" },
        { id: "gate-globe-check", name: "Gate valves", category: "Valves" },
        { id: "flanges", name: "Flanges", category: "Fittings & flanges" },
      ],
    );
    expect(body).toMatchObject({
      location: { any: ["AE"], basis: "hq" },
      roles: { not: ["owner"] },
      sell: { any: ["ball-valves", "gate-globe-check", "flanges"], hideCompetitors: true },
      signals: { any: ["order_won"], withinDays: 90 },
      page: 1,
      pageSize: 25,
    });
  });
});

describe("AnyNotChips", () => {
  const options = [
    { value: "SA", label: "Saudi Arabia" },
    { value: "IN", label: "India" },
    { value: "AE", label: "UAE" },
  ];

  it("shows 'Is any of' and 'Is not any of', adds, removes and excludes values", () => {
    const onChange = vi.fn();
    const { rerender } = render(<AnyNotChips options={options} any={["SA"]} not={[]} onChange={onChange} />);
    expect(screen.getByText("Is any of")).toBeTruthy();
    expect(screen.getByText("Is not any of")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add India" }));
    expect(onChange).toHaveBeenLastCalledWith({ any: ["SA", "IN"], not: [] });

    fireEvent.click(screen.getByRole("button", { name: "Remove Saudi Arabia" }));
    expect(onChange).toHaveBeenLastCalledWith({ any: [], not: [] });

    fireEvent.change(screen.getByRole("combobox", { name: "Is not any of" }), { target: { value: "AE" } });
    expect(onChange).toHaveBeenLastCalledWith({ any: ["SA"], not: ["AE"] });

    rerender(<AnyNotChips options={options} any={["SA"]} not={["AE"]} onChange={onChange} />);
    const excluded = within(screen.getByTestId("chips-not"));
    expect(excluded.getByRole("button", { name: /Remove.*UAE/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add UAE" })).toBeNull();
  });

  it("accepts typed values when free text is on (e.g. a city)", () => {
    const onChange = vi.fn();
    render(<AnyNotChips options={options} any={[]} not={[]} freeText placeholder="Add country, region or city…" onChange={onChange} />);
    const input = screen.getByPlaceholderText("Add country, region or city…");
    fireEvent.change(input, { target: { value: "Jubail" } });
    fireEvent.submit(input.closest("form")!);
    expect(onChange).toHaveBeenLastCalledWith({ any: [], not: ["Jubail"] });
  });
});

const buyer: BuyerView = {
  leadId: "11111111-1111-4111-8111-111111111111",
  companyId: "c1",
  name: "East Pipes Integrated Company for Industry (EPIC)",
  shortName: "EPIC",
  role: "manufacturer",
  roleLabel: "Manufacturer",
  subRoleLabel: "Pipe mill",
  country: "SA",
  city: null,
  stage: "ready",
  fitScore: 57,
  howSure: "medium",
  headline: "EPIC (Manufacturer, Saudi Arabia) will likely buy coating materials and welding consumables in Oct – Nov 2026.",
  buyingReason: "EPIC won a SAR 771M pipe order from Saudi Aramco, to deliver within 6 months.",
  buyingReasonEvidenceIds: ["e1"],
  triggerDate: "2026-09-22",
  sellItems: [
    { itemId: "coating-materials", name: "Coating materials (3LPE / FBE)", category: "Coating & corrosion", fit: "good", why: "Pipes are coated before delivery", evidenceIds: [] },
    { itemId: "flanges", name: "Fittings & flanges", category: "Fittings & flanges", fit: "possible", why: "Often supplied together with pipe", evidenceIds: [] },
    { itemId: "line-pipe", name: "Line pipe", category: "Pipes", fit: "competitor", why: "They make it", evidenceIds: [] },
  ],
  competitorFor: ["line-pipe"],
  window: [
    { label: "Order won", from: "2026-09-22", to: "2026-09-22", state: "done" },
    { label: "Materials & consumables", from: "2026-10-01", to: "2026-11-30", state: "now" },
    { label: "Delivery", from: null, to: "2027-03-01", state: "next" },
  ],
  whyYou: [{ strengthId: "stock-hubs", text: "Stock in Dammam", reason: "The buyer is in Saudi Arabia", isExample: true }],
  team: [
    {
      slotId: "s1",
      role: "decision_maker",
      title: "Head of procurement / supply chain",
      description: "Signs off new vendors",
      person: null,
      status: "not_found",
      findLinks: [{ label: "LinkedIn people search", url: "https://www.linkedin.com/search/results/people/?keywords=EPIC%20procurement" }],
    },
    {
      slotId: "s2",
      role: "approver",
      title: "CEO / MD",
      description: "Approves large orders",
      person: { id: "p1", name: "Mohammed Darweesh", title: "Acting CEO", evidenceIds: ["e1"] },
      status: "likely",
      findLinks: [],
    },
  ],
  found: 1,
  total: 6,
  chain: [{ companyId: null, name: "Saudi Aramco", role: "owner", identified: true, found: 0, total: 4, note: "approved vendor list" }],
  reach: { country: "SA", email: "consent_needed", summary: "Cold email needs consent (PDPL). Best route: vendor registration." },
  proof: [
    {
      evidenceId: "e1",
      sentence: "The order is a steel-pipe supply contract signed by East Pipes Integrated Company for Industry with Saudi Arabian Oil Co.",
      highlight: "signed by East Pipes Integrated Company for Industry",
      source: "example.com",
      date: "2026-09-22",
      url: "https://example.com/a",
      verified: true,
    },
  ],
  status: "new",
  isSample: false,
  updatedAt: "2026-09-27T10:00:00.000Z",
  whatTheyDo: "Pipe maker",
  tier: 1,
  foundVia: null,
  deals: [],
  chainSummary: { tier2: 4, tier3: 3, peopleTotal: 31, peopleFound: 1 },
};

describe("BuyerSidebarView (docs/mvp/14 §10)", () => {
  it("renders why now, fits with the competitor item, why you, the window, slots and the footer", () => {
    const onGood = vi.fn();
    render(
      <BuyerSidebarView buyer={buyer} status="new" onClose={() => undefined} onGood={onGood} onNotRelevant={() => undefined} onAddToList={() => undefined} />,
    );
    expect(screen.getByRole("heading", { name: buyer.name })).toBeTruthy();
    expect(screen.getByText("Buyer · Pipe maker")).toBeTruthy();
    expect(screen.getByText(buyer.buyingReason)).toBeTruthy();

    const sell = screen.getByRole("region", { name: "What we can sell them" });
    expect(within(sell).getByText("Good fit")).toBeTruthy();
    expect(within(sell).getByText("Possible")).toBeTruthy();
    expect(within(sell).getByText("Competitor — they make it")).toBeTruthy();
    expect(within(sell).getByText("Hidden from outreach")).toBeTruthy();

    const whyYou = screen.getByRole("region", { name: "Why you" });
    expect(within(whyYou).getByText("Stock in Dammam")).toBeTruthy();
    expect(within(whyYou).getByText(/replace with your own/)).toBeTruthy();

    expect(screen.getByText("Materials & consumables")).toBeTruthy();
    expect(screen.getByText("Oct – Nov 2026")).toBeTruthy();

    const slots = screen.getAllByTestId("contact-slot");
    expect(slots).toHaveLength(2);
    expect(within(slots[0]).getByText("Head of procurement / supply chain")).toBeTruthy();
    expect(within(slots[0]).getByText("Decision maker")).toBeTruthy();
    expect(within(slots[0]).getByRole("link", { name: /Find/ }).getAttribute("href")).toContain("linkedin.com");
    expect(within(slots[1]).getByText("Mohammed Darweesh")).toBeTruthy();
    expect(within(slots[1]).getByText("Approver · likely")).toBeTruthy();
    expect(screen.getByText(/1 of 6 found/)).toBeTruthy();

    const chain = screen.getByRole("region", { name: "Supply chain" });
    expect(within(chain).getByText("4 companies")).toBeTruthy();
    expect(within(chain).getByText("3 companies")).toBeTruthy();
    expect(within(chain).getByText("1 of 31 found")).toBeTruthy();
    expect(within(chain).getByRole("link", { name: /Open full chain/ }).getAttribute("href")).toBe(`/buyers/${buyer.leadId}#supply-chain`);
    expect(screen.getByText(/Cold email needs consent/)).toBeTruthy();
    expect(screen.getByText("signed by East Pipes Integrated Company for Industry").tagName).toBe("B");

    fireEvent.click(screen.getByRole("button", { name: /Good lead/ }));
    expect(onGood).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Not relevant/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open full page/ }).getAttribute("href")).toBe(`/buyers/${buyer.leadId}`);
  });

  it("never shows internal words", () => {
    const { container } = render(
      <BuyerSidebarView buyer={buyer} status="new" onClose={() => undefined} onGood={() => undefined} onNotRelevant={() => undefined} onAddToList={() => undefined} />,
    );
    expect(container.textContent).not.toMatch(/\bsupplier\b|\bbid\b|subcontract\b|genuine|confidence score|\bEPC\b|\bowner\b|main contractor/i);
  });
});
