"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, RotateCcw, Search } from "lucide-react";
import type { SearchKind } from "../run-steps";
import { Pagination } from "../leads/pagination";
import { SearchControls, SearchStatusChip } from "../research/search-controls";

/** One search on the Dashboard, already in plain words (built on the server). */
export interface SearchSummary {
  id: string; query: string; detail: string; when: string; kind: SearchKind;
  verified: number; likely: number; found: number | null; toCheck: number | null;
  conversations: number; meetings: number; cost: string;
}
type Filter = "all" | "active" | "finished" | "stopped";
const FILTERS: { id: Filter; label: string; test: (k: SearchKind) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "active", label: "Running or paused", test: (k) => k === "running" || k === "paused" },
  { id: "finished", label: "Finished", test: (k) => k === "finished" || k === "partial" },
  { id: "stopped", label: "Stopped", test: (k) => k === "stopped" || k === "failed" },
];
const PAGE = 8;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every search, 8 a page, filtered by state or words, each with its actions (docs/mvp/18 §9). */
export function SearchesTable({ rows }: { rows: SearchSummary[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [words, setWords] = useState("");
  const [page, setPage] = useState(1);
  const shown = useMemo(() => {
    const q = words.trim().toLowerCase();
    return rows.filter((r) => FILTERS.find((f) => f.id === filter)!.test(r.kind) && (!q || `${r.query} ${r.detail}`.toLowerCase().includes(q)));
  }, [rows, filter, words]);
  const last = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, last);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] px-4 py-3">
        <div role="tablist" aria-label="Show searches" className="inline-flex rounded-[10px] bg-[var(--subtle)] p-0.5">
          {FILTERS.map((f) => {
            const n = rows.filter((r) => f.test(r.kind)).length;
            return <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => { setFilter(f.id); setPage(1); }}
              className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium ${filter === f.id ? "bg-white text-[var(--text)] shadow-sm" : "text-[var(--text-2)] hover:text-[var(--text)]"}`}>
              {f.label} <span className="tabular-nums text-[var(--muted)]">{n}</span></button>;
          })}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
          <input type="search" value={words} onChange={(e) => { setWords(e.target.value); setPage(1); }} placeholder="Filter by material or country" aria-label="Filter searches" className="input h-9 w-full pl-8 pr-3 text-[13px]" />
        </label>
      </div>
      {shown.length ? (
        <ul className="divide-y divide-[var(--line)]" aria-label="Searches">
          {shown.slice((current - 1) * PAGE, current * PAGE).map((r) => (
            <li key={r.id} className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center" data-testid="search-row">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/find?run=${r.id}`} className="text-[15px] font-semibold hover:text-[var(--accent)]">{r.query}</Link>
                  <SearchStatusChip kind={r.kind} />
                </div>
                <p className="mt-0.5 truncate text-[13px] text-[var(--muted)]">{r.detail} · {r.when}</p>
                <p className="mt-1 text-[13.5px] text-[var(--text-2)]">
                  <b className="font-semibold text-[var(--text)]">{r.verified}</b> verified · <b className="font-semibold text-[var(--text)]">{r.likely}</b> likely
                  {r.found !== null ? ` · ${r.found} companies found` : ""}{r.toCheck ? ` · ${r.toCheck} to check` : ""}
                  {r.conversations ? ` · ${plural(r.conversations, "conversation")}` : ""}{r.meetings ? ` · ${plural(r.meetings, "meeting")}` : ""}
                </p>
                {r.cost ? <p className="mt-0.5 text-[12px] text-[var(--muted)]">{r.cost}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <SearchControls runId={r.id} kind={r.kind} size="sm" />
                <Link href={`/find?run=${r.id}`} className="btn btn-secondary btn-sm">Open</Link>
                {r.kind !== "running" && r.kind !== "paused" ? <Link href={`/find?again=${r.id}`} className="btn btn-secondary btn-sm" title="Start a new search with the same material and countries"><RotateCcw size={13} aria-hidden />Run again</Link> : null}
                <Link href={`/crm?run=${r.id}`} className="btn btn-primary btn-sm">Leads<ArrowRight size={13} aria-hidden /></Link>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-8 text-center text-[14px] text-[var(--muted)]">No searches match.</p>}
      {shown.length > PAGE ? <div className="border-t border-[var(--line)] px-4 py-3"><Pagination page={current} size={PAGE} total={shown.length} onPage={setPage} /></div> : null}
    </div>
  );
}

/** Keeps the Dashboard current while a search runs: refreshes the server data every 10 s. */
export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
