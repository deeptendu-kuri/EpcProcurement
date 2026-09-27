"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import type { LeadFacets } from "@/mvp/types";
import { KIND_LABELS, disciplineLabel } from "../labels";
import { FilterSelect, facetOptions } from "../leads/filter-bar";
import { applyChanges, leadsHref, type LeadsUrlState } from "../leads/url-state";

/** Filter bar of the pipeline board (docs/mvp/13 §5): search, market, category, type. Held in the URL. */
export function PipelineFilters({ state, facets }: { state: LeadsUrlState; facets: LeadFacets }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/pipeline";
  const [, startTransition] = useTransition();
  const [text, setText] = useState(state.q);

  const go = (changes: Partial<LeadsUrlState>) => {
    const next = applyChanges(state, changes);
    startTransition(() => router.replace(leadsHref({ q: next.q, market: next.market, category: next.category, kind: next.kind, tab: "all" }, pathname), { scroll: false }));
  };

  useEffect(() => {
    if (text.trim() === state.q) return;
    const timer = setTimeout(() => go({ q: text.trim() }), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const active = Boolean(state.q || state.market || state.category || state.kind);
  return (
    <div className="filter-bar" role="search" aria-label="Filter the pipeline">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" aria-hidden />
          <label htmlFor="pipeline-search" className="sr-only">Search company or project</label>
          <input id="pipeline-search" value={text} onChange={(event) => setText(event.target.value)} placeholder="Search company or project" className="control w-full pl-8" />
        </div>
        <FilterSelect id="p-market" label="Market" value={state.market} allLabel="All" options={facetOptions(facets.market, marketName, state.market)} onChange={(market) => go({ market })} />
        <FilterSelect id="p-category" label="Category" value={state.category} allLabel="All" options={facetOptions(facets.discipline, disciplineLabel, state.category)} onChange={(category) => go({ category })} />
        <FilterSelect
          id="p-kind"
          label="Type"
          value={state.kind}
          allLabel="All"
          options={facetOptions(facets.kind, (value) => KIND_LABELS[value as keyof typeof KIND_LABELS] ?? value, state.kind)}
          onChange={(kind) => go({ kind: kind as LeadsUrlState["kind"] })}
        />
        {active ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setText("");
              go({ q: "", market: "", category: "", kind: "" });
            }}
          >
            <X size={14} aria-hidden /> Clear all
          </button>
        ) : null}
      </div>
    </div>
  );
}
