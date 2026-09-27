import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATE,
  activeFilters,
  applyChanges,
  leadsHref,
  pageNumbers,
  pageRange,
  parseLeadsState,
  serializeLeadsState,
  toLeadFilter,
} from "./url-state";

describe("Leads URL state (docs/mvp/13 §4)", () => {
  it("parses every parameter and round-trips through the URL", () => {
    const params = new URLSearchParams(
      "tab=all&q=line%20pipe&category=pipeline&market=in&kind=bid&stage=awarded&status=contacted&added=7d&conf=high&min=60&product=prod-valves&source=live&sort=closing&size=10&page=3",
    );
    const state = parseLeadsState(params);
    expect(state).toEqual({
      ...DEFAULT_STATE,
      tab: "all",
      q: "line pipe",
      category: "pipeline",
      market: "IN",
      kind: "bid",
      stage: "awarded",
      status: "contacted",
      added: "7d",
      confidence: "high",
      minScore: 60,
      product: "prod-valves",
      source: "live",
      sort: "closing",
      size: 10,
      page: 3,
    });
    expect(parseLeadsState(serializeLeadsState(state))).toEqual(state);
  });

  it("accepts a plain object (Next.js searchParams) and the class alias", () => {
    expect(parseLeadsState({ class: "research", market: ["sa", "in"] })).toMatchObject({ tab: "research", market: "SA" });
  });

  it("falls back to defaults for invalid values", () => {
    const state = parseLeadsState(
      new URLSearchParams("tab=bogus&category=x'y&market=India&kind=x&stage=nope&status=drop&added=1y&conf=max&min=-4&sort=random&size=1000&page=-2&run=not-a-uuid&source=x"),
    );
    expect(state).toEqual(DEFAULT_STATE);
  });

  it("writes only non-default values, in a stable order", () => {
    expect(serializeLeadsState(DEFAULT_STATE).toString()).toBe("");
    expect(serializeLeadsState({ page: 2, market: "SA", tab: "all" }).toString()).toBe("tab=all&market=SA&page=2");
    expect(leadsHref({})).toBe("/leads");
    expect(leadsHref({ tab: "all", category: "piping" })).toBe("/leads?tab=all&category=piping");
  });

  it("returns to page 1 when a filter, sort or page size changes, not when the page changes", () => {
    const onPage3 = { ...DEFAULT_STATE, page: 3 };
    expect(applyChanges(onPage3, { market: "IN" }).page).toBe(1);
    expect(applyChanges(onPage3, { sort: "score" }).page).toBe(1);
    expect(applyChanges(onPage3, { size: 50 }).page).toBe(1);
    expect(applyChanges(onPage3, { page: 4 }).page).toBe(4);
  });

  it("lists active filters for the chips", () => {
    expect(activeFilters(DEFAULT_STATE)).toEqual([]);
    expect(activeFilters({ ...DEFAULT_STATE, market: "IN", minScore: 50, q: "pipe" })).toEqual(["q", "market", "minScore"]);
  });

  it("maps to the repository filter with limit and offset", () => {
    expect(toLeadFilter({ ...DEFAULT_STATE, page: 3, size: 10 })).toMatchObject({ class: "genuine", status: "open", sort: "latest", limit: 10, offset: 20 });
    expect(toLeadFilter({ ...DEFAULT_STATE, tab: "all", status: "all" })).toMatchObject({ class: undefined, status: "all" });
  });

  it("computes 'Showing a–b of n' and the page numbers", () => {
    expect(pageRange(1, 25, 132)).toEqual({ from: 1, to: 25, pages: 6 });
    expect(pageRange(6, 25, 132)).toEqual({ from: 126, to: 132, pages: 6 });
    expect(pageRange(1, 25, 0)).toEqual({ from: 0, to: 0, pages: 1 });
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(5, 10)).toEqual([1, "…", 4, 5, 6, "…", 10]);
    expect(pageNumbers(2, 4)).toEqual([1, 2, 3, 4]);
  });
});
