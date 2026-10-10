"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Bookmark, ChevronDown, Download, Info, Loader2, PanelLeftOpen, Plus, Search, SearchX, SlidersHorizontal, Sparkles, Square, SquareCheck, Users, X } from "lucide-react";
import type { BuyerRow, BuyerSearchResult, ContactRow, ContactSearchResult } from "@/mvp/buyers/types";
import { ApiError, apiJson } from "../api-client";
import type { RunCounters, RunStatus } from "@/mvp/types";
import { searchKind, type SearchKind } from "../run-steps";
import { SearchControls, SearchStatusChip } from "../research/search-controls";
import { EmptyState } from "../empty-state";
import { Pagination } from "../leads/pagination";
import { safeStorage } from "../shell/events";
import { useToast } from "../shell/toast";
import { AddContactModal, type AddContactValues } from "../buyers/add-contact-modal";
import { addContact, confirmContact, isDerivedId, saveDerivedBuyer } from "../buyers/chain-api";
import { BUYER_STAGE_LABELS, HOW_SURE_LABELS, LINK_LABELS, countryName } from "./buyer-labels";
import { searchBuyers, searchContacts } from "./buyer-api";
import {EvidenceDrawer} from '../evidence/evidence-drawer';
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
  type ProofTab,
  type ResultView,
  type SearchUrlState,
} from "./search-state";

const FILTERS_KEY = "mvp.search.filters.collapsed";
const SAVED_KEY = "mvp.search.saved";

type Tab = "search" | "lists";
/** While a search runs, Leads checks for new leads this often (docs/mvp/18 §9). */
const LIVE_MS = 5000;
const PROOF_TABS: { id: ProofTab; label: string; hint: string }[] = [
  { id: "", label: "All leads", hint: "Every lead this search saved." },
  { id: "verified", label: "Verified", hint: "Proven by the company's own website or its listed work." },
  { id: "likely", label: "Likely · not verified", hint: "Rated as likely buyers from what the sources say. Verify before emailing." },
  { id: "found", label: "Companies found", hint: "Every company the search named, checked or not." },
];

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

function TopTabs({ tab, right, basePath = "/search" }: { tab: Tab; right?: React.ReactNode; basePath?: string }) {
  const base = "border-b-2 px-0.5 pb-[18px] text-base";
  return (
    <div className="flex h-16 shrink-0 items-end gap-6 border-b border-[var(--line)] px-4 sm:gap-[34px] lg:px-6">
      <Link href={basePath} aria-current={tab === "search" ? "page" : undefined} className={`${base} ${tab === "search" ? "border-[var(--accent)] font-semibold text-[var(--accent)]" : "border-transparent text-[#64748b] hover:text-[#334155]"}`}>
        Leads
      </Link>
      <Link href="/lists" aria-current={tab === "lists" ? "page" : undefined} data-tour="search-lists-tab" className={`${base} ${tab === "lists" ? "border-[var(--accent)] font-semibold text-[var(--accent)]" : "border-transparent text-[#64748b] hover:text-[#334155]"}`}>
        Lead Lists
      </Link>
      <div className="ml-auto flex items-center gap-3 self-center text-[13px] text-[#64748b]">{right}</div>
    </div>
  );
}

export interface SearchWorkspaceProps {
  demoEmail?: boolean;
  /** Page the workspace lives on: "/crm" (Leads) or "/search" (old links). */
  basePath?: string;
  /** The user's searches, for the Search picker (doc 17 §4.4), with where each stands. */
  runs?: { id: string; label: string; status: string; kind?: SearchKind }[];
  /** The "Companies found" tab for the selected search. */
  foundCompanies?: React.ReactNode;
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
export function SearchWorkspace({ tab, state, catalogue, markets, demoEmail, basePath = "/search", runs = [], foundCompanies = null }: SearchWorkspaceProps) {
  const router = useRouter();
  const toast = useToast();
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
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
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
  /** Live: where the selected search stands now, the latest lead counts, and the leads already shown. */
  const [kindNow, setKindNow] = useState<Record<string, SearchKind>>({});
  const [latest, setLatest] = useState<{ key: string; counts: NonNullable<BuyerSearchResult["proofCounts"]> } | null>(null);
  const known = useRef<{ key: string; ids: Set<string> } | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const goToPage = (page: number) => {
    scrollRef.current?.scrollTo({ top: 0 });
    if (view === "contacts") setContactsPage(page);
    else navigate({ page });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (safeStorage.get(FILTERS_KEY) === "0") setFiltersCollapsed(false);
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
        // Leads that arrived since this list was first shown are marked New (newest-first order only).
        const listKey = queryKey.replace(/(^|&)page=\d+/, "");
        const ids = nextResult.rows.map((row) => row.leadId);
        if (known.current?.key === listKey && current.sort === "latest") setNewIds((previous) => new Set([...previous, ...ids.filter((id) => !known.current!.ids.has(id))]));
        else setNewIds(new Set());
        known.current = { key: listKey, ids: new Set([...(known.current?.key === listKey ? known.current.ids : []), ...ids]) };
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
      startTransition(() => router.replace(searchHref(next, basePath), { scroll: false }));
    },
    [router, state, openId, view, basePath],
  );

  const switchView = (next: ResultView) => {
    if (next === view) return;
    setViewState(next);
    setContactsPage(1);
    if (tab !== "search") return;
    const href = searchHref({ ...state, open: openId, view: next, page: 1 }, basePath);
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
      const href = searchHref({ ...state, open: leadId, view }, basePath);
      window.history.replaceState(window.history.state, "", href);
    },
    [state, tab, view, basePath],
  );

  const searchRun = state.run && state.run !== "all" ? state.run : undefined;
  const kind: SearchKind | null = searchRun ? kindNow[searchRun] ?? runs.find((r) => r.id === searchRun)?.kind ?? null : null;
  // A paused search is watched too: steps already running finish and save leads.
  const watching = tab === "search" && Boolean(searchRun) && (kind === "running" || kind === "paused");
  /** The user is working in the table (a selection, an open lead, a later page): new leads wait behind a bar. */
  const engagedRef = useRef(false);
  const shownTotalRef = useRef<number | null>(null);
  useEffect(() => {
    engagedRef.current = selected.size > 0 || Boolean(openId) || state.page > 1;
    shownTotalRef.current = result ? result.total : null;
  });
  useEffect(() => {
    if (!watching || !searchRun) return;
    const timer = setInterval(() => {
      const current = parseSearchState(new URLSearchParams(queryKey));
      void Promise.all([
        searchBuyers({ ...toBuyerSearch(current, catalogue), page: 1, pageSize: 1 }),
        apiJson<{ run: { status: RunStatus; counters: RunCounters } }>(`/api/mvp/runs/${searchRun}?after=2147483647`),
      ]).then(([live, { run }]) => {
        const nextKind = searchKind(run.status, run.counters);
        setKindNow((previous) => ({ ...previous, [searchRun]: nextKind }));
        if (!live.proofCounts) return;
        setLatest({ key: queryKey, counts: live.proofCounts });
        const grew = live.total !== (shownTotalRef.current ?? live.total);
        // New leads show at once unless the user is working in the table; the end of the search refreshes too.
        if ((grew && !engagedRef.current) || (nextKind !== "running" && nextKind !== "paused")) setRetry((value) => value + 1);
      }).catch(() => undefined);
    }, LIVE_MS);
    return () => clearInterval(timer);
  }, [watching, searchRun, queryKey, catalogue]);
  // A row opens by lead; a link from Email automation or the dashboard may carry an opportunity id.
  const drawerTarget = (id: string) => id.startsWith("company:") ? { companyId: id.slice(8), run: searchRun }
    : rows.some((r) => r.leadId === id) || !/^[0-9a-f-]{36}$/i.test(id) ? { leadId: id, run: searchRun } : { opportunityId: id, run: searchRun };

  const clearAll = () => {
    setPanelKey((value) => value + 1);
    navigate(clearedSearch(state));
  };

  const loading = tab === "search" && doneKey !== `${queryKey}#${retry}`;
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const counts = (latest?.key === queryKey ? latest.counts : null) ?? result?.proofCounts ?? null;
  const shownCount = counts ? (state.proof === "verified" ? counts.verified : state.proof === "likely" ? counts.likely : counts.all) : null;
  const waiting = result && shownCount !== null && state.proof !== "found" ? Math.max(0, shownCount - total) : 0;
  const selectableRows = rows.filter((row) => !isDerivedRow(row));
  const allSelected = selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.leadId));
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

  const emailContact = async (row: ContactRow) => {
    const key = contactKey(row);
    setConfirming(previous => new Set(previous).add(key));
    try {
      const leadId = isDerivedId(row.leadId) && row.derivedKey ? await saveDerivedBuyer(row.derivedKey) : row.leadId;
      if (!leadId) throw new Error("Save this company as a buyer first.");
      router.push(`/buyers/${encodeURIComponent(leadId)}?compose=1&contact=${encodeURIComponent(row.person?.id || "demo")}`);
    } catch (err) { toast.show({ message: err instanceof Error ? err.message : "Could not open the email.", tone: "error" }); }
    finally { setConfirming(previous => { const next = new Set(previous); next.delete(key); return next; }); }
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
      aria-label={`Open SuperSearch filters${activeFilters ? ` (${activeFilters} active)` : ""}`}
    >
      {filtersCollapsed ? <PanelLeftOpen size={14} aria-hidden /> : <SlidersHorizontal size={14} aria-hidden />}
      SuperSearch
      {activeFilters ? <span className="count-badge count-badge-accent">{activeFilters}</span> : null}
    </button>
  );

  const topRight = (
    <>

      {tab === "search" ? <SavedSearchesMenu state={state} onApply={(query) => startTransition(() => router.replace(query ? `${basePath}?${query}` : basePath))} /> : null}
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
      {waiting > 0 ? (
        <div role="status" className="mx-4 mb-2 flex flex-wrap items-center gap-3 rounded-xl bg-[var(--info-bg)] px-4 py-2.5 text-[14px] text-[var(--info)] lg:mx-6">
          <span className="font-medium">{waiting} new {waiting === 1 ? "lead" : "leads"} saved since this list loaded.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { navigate({ page: 1 }); setRetry((value) => value + 1); }}>Show {waiting === 1 ? "it" : "them"}</button>
        </div>
      ) : null}
      {result && result.facets.roles.length ? (
        <p className="px-4 pb-1 text-[13px] text-[var(--muted)] lg:px-6" data-testid="lead-summary">
          {result.facets.roles.slice(0, 4).map((f) => `${f.label} ${f.count}`).join(" · ")}
          {result.facets.countries.length ? ` · ${result.facets.countries.slice(0, 3).map((f) => `${f.label} ${f.count}`).join(", ")}` : ""}
        </p>
      ) : null}
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
            title={state.proof === "verified" ? "No verified leads yet" : state.proof === "likely" ? "No likely leads waiting" : searchRun ? watching ? "Looking for leads…" : "No leads saved by this search yet" : "No saved companies yet"}
            text={watching ? "Leads appear here as soon as the search saves them. The search page shows what it is doing now."
              : state.proof === "verified" ? "Verify likely leads from the Likely tab, or check companies in Companies found."
              : searchRun ? "Open Companies found to check the companies this search named." : "Start a material search. Its buyers appear here with the proof, contacts and email status."}
          />
        ) : view === "contacts" ? (
          contacts && contacts.rows.length ? (
            <>
              <p className="mb-2 text-[13px] text-[#374151]" data-testid="contacts-count">
                <b className="tabular-nums text-[#111827]">{contacts.total}</b> people to approach · <b className="tabular-nums text-[#111827]">{contacts.found}</b> found
              </p>
              <ContactsTable rows={contacts.rows} onOpenBuyer={setOpen} onAdd={setAddingContact} onConfirm={(row) => void confirmRow(row)} busy={confirming} onEmail={(row) => void emailContact(row)} demoEmail={demoEmail} />
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
            <ResultsTable rows={rows} selected={selected} openId={openId} onToggle={toggle} onOpen={setOpen} onSaveDerived={(row) => void saveDerived(row)} saving={savingDerived} newIds={newIds} />
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
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0">
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
        <TopTabs tab={tab} right={topRight} basePath={basePath} />
        {tab==="search"?<div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--subtle)] px-4 py-2.5 text-sm lg:px-6" data-tour="leads-search">
          <label className="flex min-w-0 max-w-full items-center gap-2 font-semibold">Search
            <select aria-label="Search" className="control h-9 w-full min-w-0 max-w-[22rem] px-2 font-normal" value={state.run || "all"} onChange={e=>navigate({run:e.target.value})}>
              {runs.map(r=><option key={r.id} value={r.id}>{r.label}{(kindNow[r.id]??r.kind)==="paused"?" · paused":r.status==="running"||r.status==="queued"?" · running":""}</option>)}
              <option value="all">All searches</option>
            </select>
          </label>
          {kind ? <SearchStatusChip kind={kind} /> : null}
          {searchRun?<Link href={`/find?run=${searchRun}`} className="btn btn-secondary btn-sm">Search progress</Link>:null}
          {searchRun && kind ? <SearchControls runId={searchRun} kind={kind} size="sm" onDone={(next) => { setKindNow((previous) => ({ ...previous, [searchRun]: next })); setRetry((value) => value + 1); }} /> : null}
          <span className="text-xs text-[var(--muted)]">{watching ? "New leads appear here as the search saves them." : searchRun ? "Leads saved by this search. Filters work within it." : "Leads from all your searches."}</span>
        </div>:null}
        {tab === "search" ? (
          <div role="tablist" aria-label="Leads" className="flex shrink-0 gap-5 overflow-x-auto border-b border-[var(--line)] px-4 lg:px-6">
            {PROOF_TABS.filter((t) => t.id !== "found" || searchRun).map((t) => {
              const n = !counts ? null : t.id === "" ? counts.all : t.id === "verified" ? counts.verified : t.id === "likely" ? counts.likely : null;
              const on = state.proof === t.id;
              return (
                <button key={t.id || "all"} type="button" role="tab" aria-selected={on} title={t.hint} onClick={() => navigate({ proof: t.id })}
                  className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-[13.5px] ${on ? "border-[var(--accent)] font-semibold text-[var(--accent)]" : "border-transparent text-[var(--text-2)] hover:text-[var(--text)]"}`}>
                  {t.label}{n !== null ? <span className={`rounded-full px-1.5 text-[12px] tabular-nums ${on ? "bg-[var(--accent-soft)]" : "bg-[var(--subtle)] text-[var(--muted)]"}`}>{n}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {tab === "search" ? (state.proof === "found" ? <div className="px-4 py-5 lg:px-6">{foundCompanies ?? <EmptyState icon={<Users size={20} aria-hidden />} title="Choose a search" text="Companies found are listed per search. Pick one in the Search menu above." showFind={false} />}</div> : results)
            : <LeadListsView onOpenBuyer={setOpen} openId={openId} />}
        </div>
      </div>

      {openId?<EvidenceDrawer key={openId} target={drawerTarget(openId)} onClose={()=>setOpen('')} onTarget={t=>setOpen(t.companyId?`company:${t.companyId}`:t.leadId??'')} onPrevious={rows.findIndex(r=>r.leadId===openId)>0?()=>setOpen(rows[rows.findIndex(r=>r.leadId===openId)-1].leadId):undefined} onNext={rows.findIndex(r=>r.leadId===openId)>=0&&rows.findIndex(r=>r.leadId===openId)<rows.length-1?()=>setOpen(rows[rows.findIndex(r=>r.leadId===openId)+1].leadId):undefined}/>:null}
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
