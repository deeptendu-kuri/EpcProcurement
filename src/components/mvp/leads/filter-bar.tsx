"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownWideNarrow, Search, SlidersHorizontal, X } from "lucide-react";
import { FilterDrawer } from "@/components/filter-drawer";
import { marketName } from "@/mvp/config/markets";
import { LEAD_STATUSES, type FacetOption, type LeadClass, type LeadFacets } from "@/mvp/types";
import { BAND_LABELS, BUYER_TYPE_LABELS, CLASS_LABELS, KIND_LABELS, STAGE_LABELS, STATUS_LABELS, disciplineLabel } from "../labels";
import { TABS, activeFilters, type FilterKey, type LeadsTab, type LeadsUrlState } from "./url-state";

export const TAB_LABELS: Record<LeadsTab, string> = { ...CLASS_LABELS, all: "All" };

const ADDED_LABELS = { "24h": "Last 24 h", "7d": "Last 7 days", "30d": "Last 30 days" } as const;
const SORT_LABELS = { latest: "Latest", score: "Highest score", closing: "Closing soon" } as const;
const SOURCE_LABELS: Record<string, string> = { live: "Live", sample: "Sample" };
const MIN_SCORES = [40, 50, 60, 70, 80];

export type Change = Partial<LeadsUrlState>;

interface Option {
  value: string;
  label: string;
  count?: number;
}

/** Facet options with counts; keeps the selected value visible even when it has no leads now. */
export function facetOptions(facet: FacetOption[], label: (value: string) => string, selected: string): Option[] {
  const options = facet.map((item) => ({ value: item.value, label: label(item.value), count: item.count }));
  if (selected && !options.some((option) => option.value === selected)) options.push({ value: selected, label: label(selected), count: 0 });
  return options;
}

export function FilterSelect({
  id,
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  allLabel: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  const active = value !== "";
  return (
    <label htmlFor={id} className={`filter-select ${active ? "filter-select-active" : ""}`}>
      <span className="filter-select-label">{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="filter-select-input">
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
            {option.count !== undefined ? ` (${option.count})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Label for an active filter chip. */
export function chipLabel(key: FilterKey, state: LeadsUrlState, productName: (id: string) => string): string {
  switch (key) {
    case "q":
      return `“${state.q}”`;
    case "category":
      return disciplineLabel(state.category);
    case "market":
      return marketName(state.market);
    case "kind":
      return state.kind ? KIND_LABELS[state.kind] : "";
    case "stage":
      return STAGE_LABELS[state.stage as keyof typeof STAGE_LABELS] ?? state.stage;
    case "status":
      return state.status === "all" ? "Any status" : state.status ? STATUS_LABELS[state.status] : "";
    case "added":
      return state.added ? ADDED_LABELS[state.added] : "";
    case "confidence":
      return state.confidence ? `${BAND_LABELS[state.confidence]} confidence` : "";
    case "minScore":
      return `Score ≥ ${state.minScore}`;
    case "product":
      return productName(state.product);
    case "source":
      return state.source === "sample" ? "Sample data" : "Live sources";
    case "buyer":
      return state.buyer ? `Buyer: ${BUYER_TYPE_LABELS[state.buyer]}` : "";
    case "run":
      return "One search";
  }
}

const RESET: Record<FilterKey, Change> = {
  q: { q: "" },
  category: { category: "" },
  market: { market: "" },
  kind: { kind: "" },
  stage: { stage: "" },
  status: { status: "" },
  added: { added: "" },
  confidence: { confidence: "" },
  minScore: { minScore: null },
  product: { product: "" },
  source: { source: "" },
  buyer: { buyer: "" },
  run: { run: "" },
};

/** Class tabs as a segmented control with counts (docs/mvp/13 §4). */
export function ClassTabs({ state, counts, onChange }: { state: LeadsUrlState; counts: Record<LeadClass, number>; onChange: (change: Change) => void }) {
  const all = (Object.values(counts) as number[]).reduce((sum, value) => sum + value, 0);
  return (
    <div role="tablist" aria-label="Lead classes" className="segmented-control" data-tour="leads-tabs">
      {TABS.map((tab) => {
        const selected = state.tab === tab;
        const count = tab === "all" ? all : counts[tab];
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange({ tab })}
            className="segmented-item"
          >
            {TAB_LABELS[tab]}
            <span className="segmented-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Leads filter bar (docs/mvp/13 §4): search, category, market, type, stage, status, added, More
 * (confidence, minimum score, product, source) and sort. Options and counts come from the database
 * (facets); active filters show as chips with ✕ and Clear all.
 */
export function FilterBar({
  state,
  facets,
  productNames,
  onChange,
}: {
  state: LeadsUrlState;
  facets: LeadFacets;
  productNames: Record<string, string>;
  onChange: (change: Change) => void;
}) {
  const [text, setText] = useState(state.q);
  const [seenQ, setSeenQ] = useState(state.q);
  if (state.q !== seenQ) {
    // The URL changed (back button, chip ✕): show its text.
    setSeenQ(state.q);
    setText(state.q);
  }
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Search as you type (debounced) so the list follows the text.
  useEffect(() => {
    const value = text.trim();
    if (value === state.q) return;
    const timer = setTimeout(() => onChange({ q: value }), 400);
    return () => clearTimeout(timer);
  }, [text, state.q, onChange]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const productName = (id: string) => productNames[id] ?? id;
  const statusCount = new Map(facets.status.map((item) => [item.value, item.count]));
  const openCount = ["new", "accepted", "contacted", "rfq", "quoted"].reduce((sum, key) => sum + (statusCount.get(key) ?? 0), 0);
  const chips = activeFilters(state);
  const filterCount = chips.filter((key) => key !== "q").length;
  const moreActive = [state.confidence, state.minScore, state.product, state.source].filter((value) => value !== "" && value !== null).length;

  /** The six main selects; `p` prefixes the ids (desktop bar and mobile sheet render them separately). */
  const primarySelects = (p: string) => (
    <>
      <FilterSelect id={`${p}-category`} label="Category" value={state.category} allLabel="All" options={facetOptions(facets.discipline, disciplineLabel, state.category)} onChange={(category) => onChange({ category })} />
      <FilterSelect
        id={`${p}-buyer`}
        label="Buyer type"
        value={state.buyer}
        allLabel="All"
        options={facetOptions(facets.buyerType ?? [], (value) => BUYER_TYPE_LABELS[value as keyof typeof BUYER_TYPE_LABELS] ?? value, state.buyer)}
        onChange={(buyer) => onChange({ buyer: buyer as LeadsUrlState["buyer"] })}
      />
      <FilterSelect id={`${p}-market`} label="Market" value={state.market} allLabel="All" options={facetOptions(facets.market, marketName, state.market)} onChange={(market) => onChange({ market })} />
      <FilterSelect
        id={`${p}-kind`}
        label="Type"
        value={state.kind}
        allLabel="Both"
        options={facetOptions(facets.kind, (value) => KIND_LABELS[value as keyof typeof KIND_LABELS] ?? value, state.kind)}
        onChange={(kind) => onChange({ kind: kind as LeadsUrlState["kind"] })}
      />
      <FilterSelect
        id={`${p}-stage`}
        label="Stage"
        value={state.stage}
        allLabel="All"
        options={facetOptions(facets.stage, (value) => STAGE_LABELS[value as keyof typeof STAGE_LABELS] ?? value, state.stage)}
        onChange={(stage) => onChange({ stage })}
      />
      <label htmlFor={`${p}-status`} className={`filter-select ${state.status ? "filter-select-active" : ""}`}>
        <span className="filter-select-label">Status</span>
        <select
          id={`${p}-status`}
          value={state.status}
          onChange={(event) => onChange({ status: event.target.value as LeadsUrlState["status"] })}
          className="filter-select-input"
        >
          <option value="">Open ({openCount})</option>
          {LEAD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]} ({statusCount.get(status) ?? 0})
            </option>
          ))}
          <option value="all">All</option>
        </select>
      </label>
      <FilterSelect
        id={`${p}-added`}
        label="Added"
        value={state.added}
        allLabel="Any time"
        options={(Object.keys(ADDED_LABELS) as (keyof typeof ADDED_LABELS)[]).map((value) => ({ value, label: ADDED_LABELS[value] }))}
        onChange={(added) => onChange({ added: added as LeadsUrlState["added"] })}
      />
    </>
  );

  /** The selects behind More (confidence, minimum score, product, source). */
  const moreSelects = (p: string) => (
    <>
      <FilterSelect
        id={`${p}-conf`}
        label="Confidence"
        value={state.confidence}
        allLabel="Any"
        options={facetOptions(facets.confidence, (value) => BAND_LABELS[value as keyof typeof BAND_LABELS] ?? value, state.confidence)}
        onChange={(confidence) => onChange({ confidence: confidence as LeadsUrlState["confidence"] })}
      />
      <label htmlFor={`${p}-min`} className={`filter-select ${state.minScore ? "filter-select-active" : ""}`}>
        <span className="filter-select-label">Min. score</span>
        <select
          id={`${p}-min`}
          value={state.minScore ?? ""}
          onChange={(event) => onChange({ minScore: event.target.value ? Number(event.target.value) : null })}
          className="filter-select-input"
        >
          <option value="">Any</option>
          {[...new Set([...MIN_SCORES, ...(state.minScore ? [state.minScore] : [])])].sort((a, b) => a - b).map((value) => (
            <option key={value} value={value}>{value}+</option>
          ))}
        </select>
      </label>
      <FilterSelect id={`${p}-product`} label="Product" value={state.product} allLabel="All" options={facetOptions(facets.product, productName, state.product)} onChange={(product) => onChange({ product })} />
      <FilterSelect
        id={`${p}-source`}
        label="Source"
        value={state.source}
        allLabel="Live and sample"
        options={facetOptions(facets.source, (value) => SOURCE_LABELS[value] ?? value, state.source)}
        onChange={(source) => onChange({ source: source as LeadsUrlState["source"] })}
      />
    </>
  );

  return (
    <div className="flex flex-col gap-2.5" data-tour="leads-filters">
      <div className="flex flex-wrap items-center gap-2">
        <form
          role="search"
          className="relative min-w-0 flex-[1_1_100%] sm:flex-[1_1_220px]"
          onSubmit={(event) => {
            event.preventDefault();
            onChange({ q: text.trim() });
          }}
        >
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" aria-hidden />
          <label htmlFor="leads-search" className="sr-only">Search company, project or product</label>
          <input
            id="leads-search"
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search company, project or product"
            maxLength={200}
            className="input h-9 w-full pl-8 pr-3 text-sm"
          />
        </form>

        {/* 640 px and up: the selects sit inline. Below that they fold into "Filters (n)" (docs/mvp/13 §2). */}
        <div className="hidden sm:contents">
          {primarySelects("f")}

          <div ref={moreRef} className="relative">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
              className={`btn btn-secondary ${moreActive ? "filter-select-active" : ""}`}
            >
              <SlidersHorizontal size={14} aria-hidden />
              More
              {moreActive ? <span className="count-badge count-badge-accent">{moreActive}</span> : null}
            </button>
            {moreOpen ? (
              <div role="dialog" aria-label="More filters" className="pop-in absolute right-0 top-[calc(100%+6px)] z-40 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-[var(--line)] bg-white p-3 shadow-lg">
                {moreSelects("f")}
              </div>
            ) : null}
          </div>
        </div>

        {/* Wrapper carries sm:hidden: the unlayered .btn display rule would beat a utility on the button itself. */}
        <span className="contents sm:hidden">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setSheetOpen(true)}
            className={`btn btn-secondary ${filterCount ? "filter-select-active" : ""}`}
          >
            <SlidersHorizontal size={14} aria-hidden />
            Filters
            {filterCount ? <span className="count-badge count-badge-accent">{filterCount}</span> : null}
          </button>
        </span>

        <label htmlFor="f-sort" className="filter-select ml-auto">
          <ArrowDownWideNarrow size={14} className="text-[#6b7280]" aria-hidden />
          <span className="sr-only">Sort by</span>
          <select id="f-sort" value={state.sort} onChange={(event) => onChange({ sort: event.target.value as LeadsUrlState["sort"] })} className="filter-select-input font-semibold">
            {(Object.keys(SORT_LABELS) as (keyof typeof SORT_LABELS)[]).map((value) => (
              <option key={value} value={value}>{SORT_LABELS[value]}</option>
            ))}
          </select>
        </label>
      </div>

      {chips.length ? (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {chips.map((key) => (
            <li key={key}>
              <span className="chip chip-accent pr-1">
                {chipLabel(key, state, productName)}
                <button
                  type="button"
                  onClick={() => {
                    if (key === "q") setText("");
                    onChange(RESET[key]);
                  }}
                  aria-label={`Remove filter ${chipLabel(key, state, productName)}`}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-white/80"
                >
                  <X size={11} aria-hidden />
                </button>
              </span>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => {
                setText("");
                onChange(Object.assign({}, ...chips.map((key) => RESET[key])));
              }}
              className="btn btn-ghost btn-sm"
            >
              Clear all
            </button>
          </li>
        </ul>
      ) : null}

      {sheetOpen ? (
        <FilterDrawer open onClose={() => setSheetOpen(false)} title={filterCount ? `Filters (${filterCount})` : "Filters"}>
          <div className="flex flex-col gap-3 p-4 [&_.filter-select]:h-11 [&_.filter-select]:w-full [&_.filter-select-input]:max-w-none [&_.filter-select-input]:flex-1">
            {primarySelects("m")}
            {moreSelects("m")}
          </div>
        </FilterDrawer>
      ) : null}
    </div>
  );
}
