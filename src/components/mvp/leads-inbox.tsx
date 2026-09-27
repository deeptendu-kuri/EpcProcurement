"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Download, Inbox, Search } from "lucide-react";
import type { LeadClass, LeadListResult, RejectReason } from "@/mvp/types";
import { patchLead } from "./api-client";
import { CLASS_LABELS, CLASS_ORDER, STATUS_LABELS } from "./labels";
import { LeadCard } from "./lead-card";

export interface InboxOption {
  value: string;
  label: string;
}

export interface LeadsInboxProps {
  result: LeadListResult;
  activeClass: LeadClass;
  filters: { market: string; product: string; kind: string; status: string; run: string };
  markets: InboxOption[];
  products: InboxOption[];
  page: number;
  pageSize: number;
}

const EMPTY_TEXT: Record<LeadClass, string> = {
  genuine: "No genuine leads yet. Run a search on Find to look for new ones.",
  research: "No leads need research right now.",
  watch: "Nothing on the watching list right now.",
  rejected: "No rejected leads.",
};

/** Leads inbox (09 §4.2): class tabs, 4 filters, CSV export, cards with Accept / Reject. Keys: j/k/a/r/Enter. */
export function LeadsInbox({ result, activeClass, filters, markets, products, page, pageSize }: LeadsInboxProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [rejectOpenId, setRejectOpenId] = useState<string | null>(null);
  const items = result.items;

  const hrefWith = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      if (!("page" in changes)) params.delete("page");
      const query = params.toString();
      return query ? `${pathname}?${query}` : (pathname ?? "/leads");
    },
    [pathname, searchParams],
  );

  const act = useCallback(
    async (id: string, body: Parameters<typeof patchLead>[1]) => {
      setBusyId(id);
      setError(null);
      try {
        await patchLead(id, body);
        startTransition(() => router.refresh());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update the lead.");
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );
  const accept = useCallback((id: string) => act(id, { status: "accepted" }), [act]);
  const reject = useCallback((id: string, reason: RejectReason) => act(id, { status: "rejected", rejectReason: reason }), [act]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) return;
      if (!items.length) return;
      const current = items[Math.min(selected, items.length - 1)];
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const next = event.key === "j" ? Math.min(selected + 1, items.length - 1) : Math.max(selected - 1, 0);
        setSelected(next);
        document.querySelector(`[data-lead-id="${items[next].id}"]`)?.scrollIntoView({ block: "nearest" });
      } else if (event.key === "a" && current.status === "new") {
        event.preventDefault();
        void accept(current.id);
      } else if (event.key === "r" && current.status !== "rejected") {
        event.preventDefault();
        setRejectOpenId(current.id);
      } else if (event.key === "Enter" && target === document.body) {
        router.push(`/leads/${current.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, accept, router]);

  const exportParams = new URLSearchParams();
  exportParams.set("class", activeClass);
  for (const [key, value] of Object.entries(filters)) if (value) exportParams.set(key, value);

  const total = result.counts[activeClass] ?? 0;
  const hasMore = (page - 1) * pageSize + items.length < total;

  const select = (id: string, label: string, key: keyof LeadsInboxProps["filters"], options: InboxOption[]) => (
    <label className="flex items-center gap-2 text-sm font-semibold text-[#344054]" htmlFor={id}>
      {label}
      <select
        id={id}
        value={filters[key]}
        onChange={(event) => router.push(hrefWith({ [key]: event.target.value || null }))}
        className="control focus-ring h-9 px-2 text-sm font-normal"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-[#101828]">Leads</h1>
          <nav aria-label="Lead classes" className="segmented flex-wrap">
            {CLASS_ORDER.map((cls) => (
              <Link
                key={cls}
                href={hrefWith({ tab: cls })}
                aria-current={cls === activeClass ? "page" : undefined}
                className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold ${
                  cls === activeClass ? "bg-white text-[#1d4ed8] shadow-sm" : "text-[#475467] hover:text-[#101828]"
                }`}
              >
                {CLASS_LABELS[cls]}
                <span className="rounded bg-[#eef2f6] px-1.5 text-xs tabular-nums text-[#344054]">{result.counts[cls] ?? 0}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {select("filter-market", "Market", "market", [{ value: "", label: "All" }, ...markets])}
          {select("filter-product", "Product", "product", [{ value: "", label: "All" }, ...products])}
          {select("filter-kind", "Type", "kind", [
            { value: "", label: "Both" },
            { value: "bid", label: "Bid" },
            { value: "supply_subcontract", label: "Supply / subcontract" },
          ])}
          {select("filter-status", "Status", "status", [
            { value: "", label: "Open" },
            { value: "all", label: "All" },
            ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
          ])}
          <a
            href={`/api/mvp/leads/export?${exportParams.toString()}`}
            className="btn-quiet focus-ring ml-auto inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold"
          >
            <Download size={15} aria-hidden />
            CSV
          </a>
        </div>

        {filters.run ? (
          <p className="flex flex-wrap items-center gap-2 rounded-lg border border-[#c7d7fe] bg-[#eef4ff] px-3 py-2 text-sm text-[#1d4ed8]">
            Showing leads from one search.
            <Link href={hrefWith({ run: null })} className="font-semibold underline">Show all leads</Link>
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm font-semibold text-[#b42318]">{error}</p>
        ) : null}
      </header>

      <section aria-label={`${CLASS_LABELS[activeClass]} leads`} aria-busy={isPending} className="flex flex-col gap-3">
        {items.length ? (
          items.map((lead, index) => (
            <div key={lead.id} onFocusCapture={() => setSelected(index)}>
              <LeadCard
                lead={lead}
                selected={index === selected}
                busy={busyId === lead.id || isPending}
                rejectOpen={rejectOpenId === lead.id}
                onRejectOpenChange={(open) => setRejectOpenId(open ? lead.id : null)}
                onAccept={accept}
                onReject={reject}
              />
            </div>
          ))
        ) : (
          <div className="surface flex flex-col items-center gap-3 rounded-xl px-4 py-12 text-center">
            <Inbox size={28} className="text-[#98a2b3]" aria-hidden />
            <p className="text-sm text-[#475467]">{EMPTY_TEXT[activeClass]}</p>
            <Link href="/find" className="btn-primary focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold">
              <Search size={15} aria-hidden />
              Find opportunities
            </Link>
          </div>
        )}
      </section>

      {page > 1 || hasMore ? (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link className="font-semibold text-[#1d4ed8]" href={hrefWith({ page: String(page - 1) })}>← Previous</Link> : <span />}
          <span className="text-[#667085]">Page {page}</span>
          {hasMore ? <Link className="font-semibold text-[#1d4ed8]" href={hrefWith({ page: String(page + 1) })}>Next →</Link> : <span />}
        </nav>
      ) : null}

      <p className="hidden text-xs text-[#98a2b3] md:block">Keys: j / k to move · a to accept · r to reject · Enter to open</p>
    </div>
  );
}
