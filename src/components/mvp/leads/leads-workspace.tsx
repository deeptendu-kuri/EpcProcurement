"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Download, Inbox, LayoutGrid, Rows3, SearchX } from "lucide-react";
import type { LeadClass, LeadFacets, LeadListItem, LeadListResult, RejectReason } from "@/mvp/types";
import { EmptyState } from "../empty-state";
import { LeadCard } from "../lead-card";
import { PageHeader } from "../page-header";
import { isTypingTarget, safeStorage } from "../shell/events";
import { ClassTabs, FilterBar, TAB_LABELS, type Change } from "./filter-bar";
import { LeadDrawer } from "./lead-drawer";
import { LeadsTable } from "./leads-table";
import { Pagination } from "./pagination";
import { applyChanges, leadsHref, serializeLeadsState, type LeadsUrlState } from "./url-state";
import { useLeadActions } from "./use-lead-actions";

type View = "table" | "cards";
const VIEW_KEY = "mvp.leads.view";

const EMPTY_TEXT: Record<LeadClass | "all", string> = {
  genuine: "No genuine leads match. Try another tab or fewer filters.",
  research: "No leads need research with these filters.",
  watch: "Nothing on the watching list with these filters.",
  rejected: "No rejected leads with these filters.",
  all: "No leads match these filters.",
};

export interface LeadsWorkspaceProps {
  state: LeadsUrlState;
  result: LeadListResult;
  facets: LeadFacets;
  productNames: Record<string, string>;
  /** False when the database has no leads at all (then offer "Load sample leads"). */
  hasAnyLeads: boolean;
}

/**
 * Leads (docs/mvp/13 §4): class tabs, filter bar, Table (default) / Cards views, quick-preview drawer,
 * server-side pages, CSV export of the filtered set. Every filter lives in the URL.
 * Keys: j / k move, Enter preview, o open, a accept, r reject.
 */
export function LeadsWorkspace({ state, result, facets, productNames, hasAnyLeads }: LeadsWorkspaceProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const actions = useLeadActions();
  const [view, setView] = useState<View>("table");
  const [selected, setSelected] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [rejectOpenId, setRejectOpenId] = useState<string | null>(null);
  const items = result.items;
  const preview = items.find((item) => item.id === previewId) ?? null;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (safeStorage.get(VIEW_KEY) === "cards") setView("cards");
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const chooseView = (next: View) => {
    setView(next);
    safeStorage.set(VIEW_KEY, next);
  };

  const navigate = useCallback(
    (change: Change) => {
      const href = leadsHref(applyChanges(state, change));
      startTransition(() => router.push(href, { scroll: "page" in change }));
    },
    [router, state],
  );

  const label = (lead: LeadListItem) => lead.buyerName;
  const accept = useCallback((lead: LeadListItem) => void actions.accept(lead.id, actions.statusOf(lead.id, lead.status), label(lead)), [actions]);
  const reject = useCallback(
    (lead: LeadListItem, reason: RejectReason) => void actions.reject(lead.id, actions.statusOf(lead.id, lead.status), reason, label(lead)),
    [actions],
  );

  // Keyboard shortcuts (docs/mvp/13 §2).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target) || !items.length) return;
      if (document.querySelector('[role="dialog"][aria-labelledby="evidence-title"], .driver-popover')) return;
      const index = Math.min(selected, items.length - 1);
      const current = items[index];
      const status = actions.statusOf(current.id, current.status);
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const next = event.key === "j" ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0);
        setSelected(next);
        if (previewId) setPreviewId(items[next].id);
        document.querySelector(`[data-lead-id="${items[next].id}"]`)?.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" && (event.target === document.body || (event.target as HTMLElement)?.tagName === "MAIN")) {
        event.preventDefault();
        setPreviewId(current.id);
      } else if (event.key === "o") {
        event.preventDefault();
        router.push(`/leads/${current.id}`);
      } else if (event.key === "a" && status === "new") {
        event.preventDefault();
        accept(current);
      } else if (event.key === "r" && status !== "rejected" && !previewId) {
        event.preventDefault();
        setRejectOpenId(current.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, previewId, actions, accept, router]);

  const exportParams = serializeLeadsState({ ...state, page: 1 });
  exportParams.delete("page");
  exportParams.delete("size");
  exportParams.set("tab", state.tab);

  const viewToggle = (
    <div role="group" aria-label="View" className="segmented-control">
      <button type="button" aria-pressed={view === "table"} onClick={() => chooseView("table")} className="segmented-item" title="Table view">
        <Rows3 size={14} aria-hidden />
        <span className="hidden sm:inline">Table</span>
      </button>
      <button type="button" aria-pressed={view === "cards"} onClick={() => chooseView("cards")} className="segmented-item" title="Cards view">
        <LayoutGrid size={14} aria-hidden />
        <span className="hidden sm:inline">Cards</span>
      </button>
    </div>
  );

  if (!hasAnyLeads) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Leads" subtitle="Companies about to buy what you sell, with the proof." />
        <div data-tour="leads-tabs">
          <EmptyState
            icon={<Inbox size={20} aria-hidden />}
            title="No leads yet"
            text="Run a search on Find, or load sample leads to see how the tool works."
            showSample
          />
        </div>
      </div>
    );
  }

  const cards = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((lead, index) => (
        <div key={lead.id} onFocusCapture={() => setSelected(index)}>
          <LeadCard
            lead={{ ...lead, status: actions.statusOf(lead.id, lead.status) }}
            selected={index === selected}
            busy={actions.isBusy(lead.id) || isPending}
            tourId={index === 0 ? "leads-first-row" : undefined}
            rejectOpen={rejectOpenId === lead.id}
            onRejectOpenChange={(open) => setRejectOpenId(open ? lead.id : null)}
            onAccept={() => accept(lead)}
            onReject={(_, reason) => reject(lead, reason)}
            onPreview={() => {
              setSelected(index);
              setPreviewId(lead.id);
            }}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Leads"
        subtitle="Companies about to buy what you sell, with the proof."
        actions={
          <>
            {viewToggle}
            <a href={`/api/mvp/leads/export?${exportParams.toString()}`} className="btn btn-secondary" title="Download every lead that matches the filters (all pages)">
              <Download size={15} aria-hidden />
              Export CSV
            </a>
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
          <ClassTabs state={state} counts={result.counts} onChange={navigate} />
        </div>
        <FilterBar state={state} facets={facets} productNames={productNames} onChange={navigate} />
      </div>

      <section aria-label={`${TAB_LABELS[state.tab]} leads`} aria-busy={isPending} className={`flex flex-col gap-3 transition-opacity duration-150 ${isPending ? "opacity-60" : ""}`}>
        {items.length ? (
          view === "table" ? (
            <>
              <div className="hidden md:block">
                <LeadsTable
                  items={items}
                  selectedIndex={selected}
                  rejectOpenId={rejectOpenId}
                  actions={{ statusOf: actions.statusOf, isBusy: actions.isBusy, onAccept: accept, onReject: reject }}
                  onSelect={setSelected}
                  onPreview={(lead) => setPreviewId(lead.id)}
                  onRejectOpenChange={setRejectOpenId}
                />
              </div>
              {/* Under 768 px the table becomes cards (docs/mvp/13 §2). */}
              <div className="md:hidden">{cards}</div>
            </>
          ) : (
            cards
          )
        ) : (
          <EmptyState icon={<SearchX size={20} aria-hidden />} title="Nothing here" text={EMPTY_TEXT[state.tab]} showFind={false}>
            <button type="button" className="btn btn-secondary" onClick={() => navigate({ tab: "all", q: "", category: "", market: "", kind: "", stage: "", status: "all", added: "", confidence: "", minScore: null, product: "", source: "", run: "" })}>
              Show all leads
            </button>
          </EmptyState>
        )}

        {result.total > 0 ? (
          <Pagination page={state.page} size={state.size} total={result.total} onPage={(page) => navigate({ page })} onSize={(size) => navigate({ size })} />
        ) : null}
      </section>

      <p className="hidden text-xs text-[#9ca3af] md:block">
        Keys: <kbd className="kbd">j</kbd> <kbd className="kbd">k</kbd> move · <kbd className="kbd">Enter</kbd> preview · <kbd className="kbd">o</kbd> open ·{" "}
        <kbd className="kbd">a</kbd> accept · <kbd className="kbd">r</kbd> reject · <kbd className="kbd">?</kbd> all shortcuts
      </p>

      {preview ? (
        <LeadDrawer
          key={preview.id}
          lead={preview}
          status={actions.statusOf(preview.id, preview.status)}
          busy={actions.isBusy(preview.id)}
          onClose={() => setPreviewId(null)}
          onAccept={() => accept(preview)}
          onReject={(reason) => reject(preview, reason)}
        />
      ) : null}
    </div>
  );
}
