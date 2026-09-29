"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Bookmark, ChevronDown, Download, Info, Loader2, PanelLeftOpen, Plus, Search, SearchX, SlidersHorizontal, Sparkles, Square, SquareCheck, Users, X } from "lucide-react";
import type { BuyerRow, BuyerSearchResult, ContactRow, ContactSearchResult } from "@/mvp/buyers/types";
import { ApiError } from "../api-client";
import { EmptyState } from "../empty-state";
import { Pagination } from "../leads/pagination";
import { useAppStatus } from "../shell/app-shell";
import { safeStorage } from "../shell/events";
import { statusLabel } from "../shell/time-ago";
import { useToast } from "../shell/toast";
import { AddContactModal, type AddContactValues } from "../buyers/add-contact-modal";
import { addContact, confirmContact, isDerivedId, saveDerivedBuyer } from "../buyers/chain-api";
import { BUYER_STAGE_LABELS, HOW_SURE_LABELS, LINK_LABELS, countryName } from "./buyer-labels";
import { searchBuyers, searchContacts } from "./buyer-api";
import { BuyerSidebar, DerivedBuyerSidebar } from "./buyer-sidebar";
import { ContactsTable, contactKey } from "./contacts-table";
import { FilterPanel, type MarketOption } from "./filter-panel";
import { AddToListDialog, LeadListsView } from "./lead-lists";
import { ResultsTable, isDerivedRow, rowRoleText } from "./results-table";
import {
  PAGE_SIZE,
  activeFilterCount,
  applySearchChange,
  clearedSearch,
  parseSearchState,
  searchHref,
  serializeSearchState,
  toBuyerSearch,
  type CatalogueOption,
  type ResultView,
  type SearchUrlState,
} from "./search-state";

const FILTERS_KEY = "mvp.search.filters.collapsed";
const SAVED_KEY = "mvp.search.saved";

type Tab = "search" | "lists";

interface SavedFilter {
  name: string;
  query: string;
}

function readSaved(): SavedFilter[] {
  try {
    const parsed = JSON.parse(safeStorage.get(SAVED_KEY) ?? "[]") as SavedFilter[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.name === "string" && typeof item.query === "string") : [];
  } catch {
    return [];
  }
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV of buyer rows in the words shown on screen. */
export function buyersCsv(rows: BuyerRow[]): string {
  const header = ["Buyer", "What they do", "Supply chain tier", "Found via", "How we know", "Why they buy now", "More deals", "What we can sell them", "Competitor note", "Location", "Buyer fit", "How sure we are", "Stage", "Contacts found", "Contacts to find", "Link"];
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const lines = rows.map((row) =>
    [
      row.name,
      rowRoleText(row),
      row.tier ?? 1,
      row.foundVia?.name ?? "",
      row.link ? LINK_LABELS[row.link] : "",
      row.buyingReason,
      Math.max(0, (row.dealsCount ?? 1) - 1) || "",
      row.sellSummary,
      row.competitorNote,
      countryName(row.country),
      row.fitScore,
      HOW_SURE_LABELS[row.howSure],
      BUYER_STAGE_LABELS[row.stage],
      row.found,
      row.total,
      isDerivedRow(row) ? "" : `${origin}/buyers/${row.leadId}`,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function download(filename: string, text: string) {
  const blob = new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SavedSearchesMenu({ state, onApply }: { state: SearchUrlState; onApply: (query: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const query = (() => {
    const params = serializeSearchState({ ...state, page: 1, open: "" });
    return params.toString();
  })();

  const persist = (next: SavedFilter[]) => {
    setSaved(next);
    safeStorage.set(SAVED_KEY, JSON.stringify(next.slice(0, 30)));
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) setSaved(readSaved());
          setOpen((value) => !value);
        }}
        className="btn btn-secondary btn-sm"
      >
        <Bookmark size={14} aria-hidden /> <span className="hidden sm:inline">Saved searches</span> <ChevronDown size={13} aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="pop-in absolute right-0 top-[calc(100%+6px)] z-50 w-72 rounded-xl border border-[var(--line)] bg-white p-2 shadow-lg">
          <form
            className="flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              persist([{ name: trimmed, query }, ...saved.filter((item) => item.name !== trimmed)]);
              setName("");
            }}
          >
            <label htmlFor="save-filters-name" className="sr-only">Name for these filters</label>
            <input id="save-filters-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name these filters" className="input h-8 flex-1 text-sm" maxLength={80} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>Save</button>
          </form>
          {saved.length ? (
            <ul className="mt-2 max-h-60 overflow-y-auto">
              {saved.map((item) => (
                <li key={item.name} className="flex items-center gap-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onApply(item.query);
                    }}
                    className="min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-sm text-[#374151] hover:bg-[var(--subtle)]"
                  >
                    {item.name}
                  </button>
                  <button type="button" aria-label={`Delete ${item.name}`} onClick={() => persist(saved.filter((other) => other.name !== item.name))} className="btn btn-ghost btn-sm btn-icon text-[#9ca3af]">
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 pt-2 text-xs text-[#9ca3af]">Saved filters are kept in this browser.</p>
          )}
          <div className="mt-2 border-t border-[var(--line)] pt-2">
            <Link href="/find" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[var(--accent)] hover:bg-[var(--subtle)]" onClick={() => setOpen(false)}>
              <Search size={14} aria-hidden /> Run a live search for new buyers
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TopTabs({ tab, right }: { tab: Tab; right?: React.ReactNode }) {
  const base = "border-b-2 px-0.5 pb-[18px] text-base";
  return (
    <div className="flex h-16 shrink-0 items-end gap-6 border-b border-[var(--line)] px-4 sm:gap-[34px] lg:px-6">
      <Link href="/search" aria-current={tab === "search" ? "page" : undefined} className={`${base} ${tab === "search" ? "border-[var(--accent)] font-semibold text-[var(--accent)]" : "border-transparent text-[#64748b] hover:text-[#334155]"}`}>
        SuperSearch
      </Link>
      <Link href="/lists" aria-current={tab === "lists" ? "page" : undefined} data-tour="search-lists-tab" className={`${base} ${tab === "lists" ? "border-[var(--accent)] font-semibold text-[var(--accent)]" : "border-transparent text-[#64748b] hover:text-[#334155]"}`}>
        Lead Lists
      </Link>
      <div className="ml-auto flex items-center gap-3 self-center text-[13px] text-[#64748b]">{right}</div>
    </div>
  );
}

export interface SearchWorkspaceProps {
  tab: Tab;
  state: SearchUrlState;
  catalogue: CatalogueOption[];
  markets: MarketOption[];
}

/**
 * SuperSearch (docs/mvp/14 §10, mockup supersearch-v2): filter panel · results with the
 * SuperSearch | Lead Lists tabs, the count line, Buyers | Contacts, Select all, Add to list, Export,
 * Find contacts · the buyer sidebar. Filters live in the URL; 25 buyers per page.
 */
export function SearchWorkspace({ tab, state, catalogue, markets }: SearchWorkspaceProps) {
  const router = useRouter();
  const toast = useToast();
  const { status, now } = useAppStatus();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BuyerSearchResult | null>(null);
  const [contacts, setContacts] = useState<ContactSearchResult | null>(null);
  /** The query (and retry) the shown result or error belongs to; differs from the current one while loading. */
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState(state.open);
  const [listIds, setListIds] = useState<string[] | null>(null);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [filtersOpenSmall, setFiltersOpenSmall] = useState(false);
  const [panelKey, setPanelKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  /** Buyers | Contacts, held here so the switch renders at once; mirrored into the URL. */
  const [view, setViewState] = useState<ResultView>(state.view);
  const [seenStateView, setSeenStateView] = useState<ResultView>(state.view);
  if (seenStateView !== state.view) {
    setSeenStateView(state.view);
    setViewState(state.view);
  }
  const [contactsPage, setContactsPage] = useState(1);
  const [savingDerived, setSavingDerived] = useState<Set<string>>(new Set());
  const [addingContact, setAddingContact] = useState<ContactRow | null>(null);
  const [confirming, setConfirming] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const goToPage = (page: number) => {
    scrollRef.current?.scrollTo({ top: 0 });
    if (view === "contacts") setContactsPage(page);
    else navigate({ page });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (safeStorage.get(FILTERS_KEY) === "1") setFiltersCollapsed(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const toggleFilters = (collapsed: boolean) => {
    setFiltersCollapsed(collapsed);
    safeStorage.set(FILTERS_KEY, collapsed ? "1" : "0");
  };

  // The query without the open sidebar: opening a buyer must not re-run the search. The view and the
  // contacts page come from local state, so Buyers | Contacts switches at once.
  const queryKey = useMemo(
    () => serializeSearchState({ ...state, open: "", view, page: view === "contacts" ? contactsPage : state.page }).toString(),
    [state, view, contactsPage],
  );

  useEffect(() => {
    if (tab !== "search") return;
    const controller = new AbortController();
    const current = parseSearchState(new URLSearchParams(queryKey));
    const body = toBuyerSearch(current, catalogue);
    const key = `${queryKey}#${retry}`;
    const buyers = searchBuyers(current.view === "contacts" ? { ...body, page: 1 } : body, controller.signal);
    const people = current.view === "contacts" ? searchContacts(body, controller.signal) : Promise.resolve(null);
    Promise.all([buyers, people])
      .then(([nextResult, nextContacts]) => {
        setResult(nextResult);
        setContacts(nextContacts);
        setError(null);
        setDoneKey(key);
        setSelected((previous) => new Set([...previous].filter((id) => nextResult.rows.some((row) => row.leadId === id))));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError({ message: err instanceof Error ? err.message : "The search failed.", status: err instanceof ApiError ? err.status : 0 });
        setDoneKey(key);
      });
    return () => controller.abort();
  }, [queryKey, tab, catalogue, retry]);

  const navigate = useCallback(
    (change: Partial<SearchUrlState>) => {
      const next = applySearchChange({ ...state, open: openId, view }, change);
      startTransition(() => router.replace(searchHref(next), { scroll: false }));
    },
    [router, state, openId, view],
  );

  const switchView = (next: ResultView) => {
    if (next === view) return;
    setViewState(next);
    setContactsPage(1);
    if (tab !== "search") return;
    const href = searchHref({ ...state, open: openId, view: next, page: 1 });
    window.history.replaceState(window.history.state, "", href);
  };

  const saveDerived = async (row: BuyerRow) => {
    const key = row.derivedKey;
    if (!key) return;
    setSavingDerived((previous) => new Set(previous).add(key));
    try {
      const leadId = await saveDerivedBuyer(key);
      toast.show({ message: `${row.name} saved as a buyer`, tone: "success" });
      setRetry((value) => value + 1);
      if (leadId) setOpen(leadId);
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Could not save this buyer.", tone: "error" });
    } finally {
      setSavingDerived((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  };

  const submitContact = async (row: ContactRow, values: AddContactValues) => {
    await addContact({
      leadId: row.leadId,
      companyId: row.companyId,
      slotId: row.slotId,
      name: values.name,
      title: values.title || row.slotTitle,
      ...(values.email ? { email: values.email } : {}),
      ...(values.phone ? { phone: values.phone } : {}),
      ...(values.linkedinUrl ? { linkedinUrl: values.linkedinUrl } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
    });
    toast.show({ message: `${values.name} added as Likely`, tone: "success" });
    setRetry((value) => value + 1);
  };

  const confirmRow = async (row: ContactRow) => {
    if (!row.person) return;
    const key = contactKey(row);
    setConfirming((previous) => new Set(previous).add(key));
    try {
      await confirmContact(row.person.id, { leadId: row.leadId, slotId: row.slotId, companyId: row.companyId });
      toast.show({ message: `${row.person.name} confirmed`, tone: "success" });
      setRetry((value) => value + 1);
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Could not confirm this contact.", tone: "error" });
    } finally {
      setConfirming((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  };

  const setOpen = useCallback(
    (leadId: string) => {
      setOpenId(leadId);
      if (tab !== "search") return;
      // Keep the open buyer in the link without a server round trip.
      const href = searchHref({ ...state, open: leadId, view });
      window.history.replaceState(window.history.state, "", href);
    },
    [state, tab, view],
  );

  const clearAll = () => {
    setPanelKey((value) => value + 1);
    navigate(clearedSearch(state));
  };

  const loading = tab === "search" && doneKey !== `${queryKey}#${retry}`;
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const selectableRows = rows.filter((row) => !isDerivedRow(row));
  const allSelected = selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.leadId));
  const openRow = openId && isDerivedId(openId) ? (rows.find((row) => row.leadId === openId) ?? null) : null;
  const notFound = Math.max(0, (result?.contactsTotal ?? 0) - (result?.contactsFound ?? 0));
  const activeFilters = activeFilterCount(state);

  const toggle = (leadId: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const exportRows = rows.filter((row) => selected.has(row.leadId));
      if (!exportRows.length) {
        // Every matching buyer, 200 per request (the API maximum), up to 2,000.
        const base = toBuyerSearch(state, catalogue);
        for (let page = 1; page <= 10; page += 1) {
          const chunk = await searchBuyers({ ...base, page, pageSize: 200 });
          exportRows.push(...chunk.rows);
          if (exportRows.length >= chunk.total || !chunk.rows.length) break;
        }
      }
      download(`buyers-${new Date().toISOString().slice(0, 10)}.csv`, buyersCsv(exportRows));
      toast.show({ message: `Exported ${exportRows.length} ${exportRows.length === 1 ? "buyer" : "buyers"}`, tone: "success" });
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Export failed.", tone: "error" });
    } finally {
      setExporting(false);
    }
  };

  const findContacts = () => {
    switchView("contacts");
    toast.show({ message: "Showing each buyer’s buying team. Use “Find” on a missing person to search for them." });
  };

  const panel = (
    <FilterPanel
      key={panelKey}
      state={state}
      facets={result?.facets ?? null}
      catalogue={catalogue}
      markets={markets}
      onChange={navigate}
      onClear={clearAll}
      onCollapse={() => {
        setFiltersOpenSmall(false);
        toggleFilters(true);
      }}
    />
  );

  const filtersButton = (
    <button
      type="button"
      onClick={() => {
        setFiltersOpenSmall(true);
        toggleFilters(false);
      }}
      className="btn btn-secondary btn-sm"
      aria-label={`Show filters${activeFilters ? ` (${activeFilters} active)` : ""}`}
    >
      {filtersCollapsed ? <PanelLeftOpen size={14} aria-hidden /> : <SlidersHorizontal size={14} aria-hidden />}
      Filters
      {activeFilters ? <span className="count-badge count-badge-accent">{activeFilters}</span> : null}
    </button>
  );

  const topRight = (
    <>
      <span className="hidden items-center gap-1.5 whitespace-nowrap md:inline-flex" data-tour="updated-ago">
        {status.queue.running ? <Loader2 size={13} className="animate-spin text-[var(--accent)]" aria-hidden /> : null}
        {status.queue.running ? "Searching…" : statusLabel(status.lastFinishedAt, now)}
      </span>
      {tab === "search" ? <SavedSearchesMenu state={state} onApply={(query) => startTransition(() => router.replace(query ? `/search?${query}` : "/search"))} /> : null}
    </>
  );

  const noData = !loading && !error && result !== null && total === 0 && activeFilters === 0;

  const results = (
    <>
      <div className="flex flex-wrap items-center gap-2.5 px-4 pb-2 pt-[18px] lg:gap-3.5 lg:px-6">
        {/* Wrapper carries lg:hidden: the unlayered .btn display rule would beat a utility on the button itself. */}
        <span className={filtersCollapsed ? "contents" : "contents lg:hidden"}>{filtersButton}</span>
        <p className="text-[#374151]" aria-live="polite" data-tour="search-count">
          {result ? (
            <>
              <b className="tabular-nums text-[#111827]">{total}</b> {total === 1 ? "buyer" : "buyers"} found ·{" "}
              <b className="tabular-nums text-[#111827]">{result.contactsTotal}</b> contacts to approach (<b className="tabular-nums text-[#111827]">{result.contactsFound}</b> found)
            </>
          ) : (
            <span className="text-[#9ca3af]">Searching…</span>
          )}
        </p>
        <div role="group" aria-label="Show" className="flex overflow-hidden rounded-lg border border-[var(--line)] text-[13px]">
          {(["buyers", "contacts"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => switchView(option)}
              className={`px-3 py-1.5 ${view === option ? "bg-[#111827] text-white" : "bg-white text-[#111827] hover:bg-[var(--subtle)]"}`}
            >
              {option === "buyers" ? "Buyers" : "Contacts"}
            </button>
          ))}
        </div>
        {view === "buyers" ? (
          <button
            type="button"
            onClick={() => setSelected(allSelected ? new Set() : new Set(selectableRows.map((row) => row.leadId)))}
            disabled={!selectableRows.length}
            className="btn btn-secondary btn-sm"
          >
            {allSelected ? <SquareCheck size={14} aria-hidden /> : <Square size={14} aria-hidden />}
            {allSelected ? "Clear selection" : "Select all"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setListIds([...selected])}
          disabled={!selected.size}
          title={selected.size ? undefined : "Select buyers first"}
          className="btn btn-secondary btn-sm"
        >
          <Plus size={14} aria-hidden /> Add to list{selected.size ? ` (${selected.size})` : ""}
        </button>
        <button type="button" onClick={() => void exportCsv()} disabled={exporting || !total} className="btn btn-secondary btn-sm" title={selected.size ? "Export the selected buyers" : "Export every buyer that matches the filters"}>
          {exporting ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />} Export
        </button>
        <button
          type="button"
          onClick={findContacts}
          data-tour="search-find-contacts"
          className="ml-auto inline-flex items-center gap-1.5 rounded-[10px] bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-105"
        >
          <Sparkles size={15} aria-hidden /> Find contacts
        </button>
      </div>
      {result && notFound > 0 ? (
        <p className="flex items-center gap-1.5 px-4 pb-3 text-[13.5px] text-[var(--accent)] lg:px-6">
          <Info size={14} aria-hidden className="shrink-0" />
          {notFound} contacts not found yet — “Find contacts” searches for each company’s buying team.
        </p>
      ) : (
        <div className="h-2" />
      )}

      <section aria-label={view === "buyers" ? "Buyers" : "Contacts"} aria-busy={loading || isPending} className={`px-4 pb-6 transition-opacity lg:px-6 ${(loading || isPending) && result ? "opacity-60" : ""}`}>
        {error ? (
          <EmptyState
            icon={<SearchX size={20} aria-hidden />}
            title={error.status === 404 ? "SuperSearch is not ready yet" : "The search failed"}
            text={error.status === 404 ? "The buyer search service is not available on this server yet." : error.message}
            showFind={false}
          >
            <button type="button" className="btn btn-secondary" onClick={() => setRetry((value) => value + 1)}>Try again</button>
          </EmptyState>
        ) : result === null ? (
          <div className="flex flex-col gap-2" role="status" aria-live="polite">
            <span className="sr-only">Loading buyers…</span>
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton h-14 rounded-md" />)}
          </div>
        ) : noData ? (
          <EmptyState
            icon={<Users size={20} aria-hidden />}
            title="No buyers yet"
            text="Run a live search on Find, or load sample buyers to see how SuperSearch works."
            showSample
          />
        ) : view === "contacts" ? (
          contacts && contacts.rows.length ? (
            <>
              <p className="mb-2 text-[13px] text-[#374151]" data-testid="contacts-count">
                <b className="tabular-nums text-[#111827]">{contacts.total}</b> people to approach · <b className="tabular-nums text-[#111827]">{contacts.found}</b> found
              </p>
              <ContactsTable rows={contacts.rows} onOpenBuyer={setOpen} onAdd={setAddingContact} onConfirm={(row) => void confirmRow(row)} busy={confirming} />
              <div className="mt-3">
                <Pagination page={contactsPage} size={PAGE_SIZE} total={contacts.total} onPage={goToPage} />
              </div>
            </>
          ) : loading || contacts === null ? (
            <div className="flex flex-col gap-2" role="status" aria-live="polite">
              <span className="sr-only">Loading contacts…</span>
              {Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton h-12 rounded-md" />)}
            </div>
          ) : (
            <EmptyState icon={<Users size={20} aria-hidden />} title="No contacts match" text="Clear a contact filter, or switch back to Buyers." showFind={false}>
              <button type="button" className="btn btn-secondary" onClick={() => switchView("buyers")}>Show buyers</button>
            </EmptyState>
          )
        ) : rows.length ? (
          <>
            <ResultsTable rows={rows} selected={selected} openId={openId} onToggle={toggle} onOpen={setOpen} onSaveDerived={(row) => void saveDerived(row)} saving={savingDerived} />
            <div className="mt-3">
              <Pagination page={state.page} size={PAGE_SIZE} total={total} onPage={goToPage} />
            </div>
          </>
        ) : (
          <EmptyState icon={<SearchX size={20} aria-hidden />} title="No buyers match these filters" text="Remove a filter or two to see more buyers." showFind={false}>
            <button type="button" className="btn btn-secondary" onClick={clearAll}>Clear all filters</button>
          </EmptyState>
        )}
      </section>
    </>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 md:h-dvh">
      {tab === "search" && !filtersCollapsed ? (
        <aside aria-label="Filters" className="hidden w-[300px] shrink-0 border-r border-[var(--line)] bg-white lg:block">
          {panel}
        </aside>
      ) : null}

      {tab === "search" && filtersOpenSmall ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button type="button" aria-label="Close filters" className="backdrop absolute inset-0" onClick={() => setFiltersOpenSmall(false)} />
          <div className="slide-in-left relative h-full w-[320px] max-w-[88vw] bg-white shadow-lg">{panel}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <TopTabs tab={tab} right={topRight} />
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {tab === "search" ? results : <LeadListsView onOpenBuyer={setOpen} openId={openId} />}
        </div>
      </div>

      {openRow ? (
        <DerivedBuyerSidebar
          key={openRow.leadId}
          row={openRow}
          saving={Boolean(openRow.derivedKey && savingDerived.has(openRow.derivedKey))}
          onClose={() => setOpen("")}
          onSave={() => void saveDerived(openRow)}
        />
      ) : openId && !isDerivedId(openId) ? (
        <BuyerSidebar
          key={openId}
          leadId={openId}
          onClose={() => setOpen("")}
          onAddToList={(ids) => setListIds(ids)}
          onOpenCompany={(name) => {
            setOpen("");
            navigate({ q: name });
          }}
        />
      ) : null}
      {addingContact ? (
        <AddContactModal
          company={addingContact.company}
          slotTitle={addingContact.slotTitle}
          onSubmit={(values) => submitContact(addingContact, values)}
          onClose={() => setAddingContact(null)}
        />
      ) : null}
      {listIds ? <AddToListDialog leadIds={listIds} onClose={() => setListIds(null)} onDone={() => setSelected(new Set())} /> : null}
    </div>
  );
}
