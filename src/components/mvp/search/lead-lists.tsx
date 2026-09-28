"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ListPlus, Loader2, Plus, Rows3, X } from "lucide-react";
import type { BuyerRow, BuyerView, LeadList } from "@/mvp/buyers/types";
import { EmptyState } from "../empty-state";
import { formatDate } from "../labels";
import { useToast } from "../shell/toast";
import { addToList, createList, getBuyer, getListItems, getLists, leadIdsFrom } from "./buyer-api";
import { ResultsTable } from "./results-table";

/**
 * "Add to list" dialog (docs/mvp/14 §10 Lead Lists): pick a list or name a new one.
 * POST /api/mvp/lists (new) and POST /api/mvp/lists/[id]/items.
 */
export function AddToListDialog({ leadIds, onClose, onDone }: { leadIds: string[]; onClose: () => void; onDone?: (list: LeadList) => void }) {
  const toast = useToast();
  const [lists, setLists] = useState<LeadList[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    getLists(controller.signal)
      .then(setLists)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLists([]);
          setError(err instanceof Error ? err.message : "Could not load your lists.");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const count = leadIds.length;
  const noun = `${count} ${count === 1 ? "buyer" : "buyers"}`;

  const addTo = async (list: LeadList) => {
    setBusy(true);
    try {
      await addToList(list.id, leadIds);
      toast.show({ message: `Added ${noun} to “${list.name}”`, tone: "success" });
      onDone?.(list);
      onClose();
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Could not add to the list.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const list = await createList(trimmed, leadIds);
      toast.show({ message: `Saved ${noun} in the new list “${list.name ?? trimmed}”`, tone: "success" });
      onDone?.(list);
      onClose();
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Could not create the list.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-labelledby="add-to-list-title">
      <button type="button" aria-label="Close" onClick={onClose} className="backdrop absolute inset-0" />
      <div className="pop-in relative w-full max-w-md rounded-2xl border border-[var(--line)] bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="add-to-list-title" className="text-base font-bold text-[#111827]">Add {noun} to a list</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-icon">
            <X size={16} />
          </button>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label htmlFor="new-list-name" className="sr-only">New list name</label>
          <input
            id="new-list-name"
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New list, e.g. “KSA pipe mills – Q4”"
            maxLength={120}
            className="input h-9 flex-1 text-sm"
          />
          <button type="submit" disabled={busy || !name.trim()} className="btn btn-primary">
            <Plus size={15} aria-hidden /> Create
          </button>
        </form>

        <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Or add to</p>
        {lists === null ? (
          <p className="flex items-center gap-2 py-3 text-sm text-[#6b7280]"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading lists…</p>
        ) : lists.length ? (
          <ul className="max-h-64 overflow-y-auto">
            {lists.map((list) => (
              <li key={list.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void addTo(list)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-[var(--subtle)] disabled:opacity-60"
                >
                  <span className="font-semibold text-[#111827]">{list.name}</span>
                  <span className="text-xs tabular-nums text-[#6b7280]">{list.itemCount} {list.itemCount === 1 ? "buyer" : "buyers"}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-[#9ca3af]">{error ?? "No lists yet. Name one above."}</p>
        )}
      </div>
    </div>
  );
}

function isRow(value: unknown): value is BuyerRow {
  return Boolean(value && typeof value === "object" && "leadId" in value && "name" in value && "fitScore" in value);
}

function viewToRow(view: BuyerView): BuyerRow {
  const sell = view.sellItems.filter((item) => item.fit !== "competitor").map((item) => item.name);
  const competing = view.sellItems.filter((item) => item.fit === "competitor").map((item) => item.name);
  return {
    leadId: view.leadId,
    name: view.name,
    subRoleLabel: view.subRoleLabel,
    role: view.role,
    roleLabel: view.roleLabel,
    buyingReason: view.buyingReason,
    sellSummary: sell.slice(0, 3).join(", "),
    competitorNote: competing.length ? `Makes ${competing.slice(0, 2).join(", ").toLowerCase()} — competitor for it` : null,
    country: view.country,
    fitScore: view.fitScore,
    howSure: view.howSure,
    stage: view.stage,
    found: view.found,
    total: view.total,
    isSample: view.isSample,
    triggerDate: view.triggerDate,
  };
}

/** Rows of a list: the items endpoint may return rows directly, or only lead ids (then each buyer is loaded). */
async function loadListRows(listId: string, signal: AbortSignal): Promise<BuyerRow[]> {
  const data = await getListItems(listId, signal);
  const raw = Array.isArray(data) ? data : ((data as { items?: unknown[]; rows?: unknown[] })?.rows ?? (data as { items?: unknown[] })?.items ?? []);
  if (raw.length && raw.every(isRow)) return raw as BuyerRow[];
  const ids = leadIdsFrom(data).slice(0, 100);
  const views = await Promise.all(ids.map((id) => getBuyer(id, signal).catch(() => null)));
  return views.filter((view): view is BuyerView => Boolean(view)).map(viewToRow);
}

/** The Lead Lists tab: your named lists on the left, the buyers of the chosen list on the right. */
export function LeadListsView({ onOpenBuyer, openId }: { onOpenBuyer: (leadId: string) => void; openId: string }) {
  const [lists, setLists] = useState<LeadList[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ listId: string; rows: BuyerRow[] } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getLists(controller.signal)
      .then((next) => {
        setLists(next);
        setActiveId((current) => current ?? next[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLists([]);
          setError(err instanceof Error ? err.message : "Could not load your lists.");
        }
      });
    return () => controller.abort();
  }, [reload]);

  const loadRows = useCallback((listId: string, signal: AbortSignal) => {
    loadListRows(listId, signal)
      .then((rows) => setLoaded({ listId, rows }))
      .catch(() => {
        if (!signal.aborted) setLoaded({ listId, rows: [] });
      });
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    loadRows(activeId, controller.signal);
    return () => controller.abort();
  }, [activeId, loadRows]);

  if (lists === null) {
    return (
      <div className="flex items-center gap-2 px-6 py-10 text-sm text-[#6b7280]" aria-busy="true">
        <Loader2 size={15} className="animate-spin" aria-hidden /> Loading lists…
      </div>
    );
  }

  if (!lists.length) {
    return (
      <div className="px-6 py-6">
        <EmptyState
          icon={<ListPlus size={20} aria-hidden />}
          title={error ? "Lists are not available" : "No lead lists yet"}
          text={error ?? "Select buyers on SuperSearch and click “Add to list” to save them in a named list."}
          showFind={false}
        >
          {error ? (
            <button type="button" className="btn btn-secondary" onClick={() => setReload((value) => value + 1)}>Try again</button>
          ) : null}
        </EmptyState>
      </div>
    );
  }

  const active = lists.find((list) => list.id === activeId) ?? null;
  const rows = loaded && loaded.listId === activeId ? loaded.rows : null;

  return (
    <div className="grid gap-4 px-4 py-4 md:grid-cols-[15rem_minmax(0,1fr)] lg:px-6">
      <nav aria-label="Lead lists" className="flex flex-col gap-0.5">
        {lists.map((list) => (
          <button
            key={list.id}
            type="button"
            onClick={() => setActiveId(list.id)}
            aria-current={list.id === activeId ? "true" : undefined}
            className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
              list.id === activeId ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]" : "text-[#374151] hover:bg-[var(--subtle)]"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Rows3 size={14} aria-hidden className="shrink-0" />
              <span className="truncate">{list.name}</span>
            </span>
            <span className="text-xs tabular-nums text-[#6b7280]">{list.itemCount}</span>
          </button>
        ))}
      </nav>
      <section aria-label={active ? active.name : "List"} className="min-w-0">
        {active ? (
          <p className="mb-3 text-sm text-[#6b7280]">
            <b className="text-[#111827]">{active.name}</b> · {active.itemCount} {active.itemCount === 1 ? "buyer" : "buyers"} · updated {formatDate(active.updatedAt)}
          </p>
        ) : null}
        {rows === null ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton h-12 rounded-md" />)}
          </div>
        ) : rows.length ? (
          <ResultsTable rows={rows} selected={new Set()} openId={openId} onToggle={() => undefined} onOpen={onOpenBuyer} selectable={false} />
        ) : (
          <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-[#9ca3af]">This list is empty.</p>
        )}
      </section>
    </div>
  );
}
