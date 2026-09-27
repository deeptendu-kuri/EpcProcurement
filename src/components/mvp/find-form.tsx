"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Check, Search } from "lucide-react";
import type { LeadKind } from "@/mvp/types";
import { apiJson } from "./api-client";
import { RunProgress } from "./run-progress";

type KindChoice = "both" | LeadKind;

const KIND_OPTIONS: { value: KindChoice; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "bid", label: "Tenders to bid" },
  { value: "supply_subcontract", label: "Supply / subcontract" },
];

export interface FindFormProps {
  markets: { code: string; name: string }[];
  /** Product names and keywords offered as quick-fill chips. */
  suggestions: string[];
  /** A run to show progress for on load (e.g. /find?run=…). */
  initialRunId?: string | null;
}

/** Find (09 §4.1): what you offer + markets + lead type → Search now → live progress. */
export function FindForm({ markets, suggestions, initialRunId = null }: FindFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(markets.map((market) => market.code));
  const [kind, setKind] = useState<KindChoice>("both");
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Follow ?run=… when the user opens another run's progress from the recent list.
  const [seenInitial, setSeenInitial] = useState(initialRunId);
  if (initialRunId !== seenInitial) {
    setSeenInitial(initialRunId);
    if (initialRunId) setRunId(initialRunId);
  }

  const toggleMarket = (code: string) =>
    setSelected((current) => (current.includes(code) ? current.filter((value) => value !== code) : [...current, code]));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (query.trim().length < 2) return setError("Type what you offer, e.g. “line pipe”.");
    if (!selected.length) return setError("Pick at least one market.");
    setSubmitting(true);
    try {
      const leadKinds: LeadKind[] = kind === "both" ? ["bid", "supply_subcontract"] : [kind];
      const { runId: id } = await apiJson<{ runId: string }>("/api/mvp/runs", {
        method: "POST",
        body: { query: query.trim(), markets: selected, leadKinds },
      });
      setRunId(id);
      window.history.replaceState(null, "", `${pathname}?run=${id}`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The search could not start.");
    } finally {
      setSubmitting(false);
    }
  };

  const onFinished = useCallback(() => startTransition(() => router.refresh()), [router]);

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="surface flex flex-col gap-4 rounded-xl p-4" aria-label="Search for opportunities">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="find-query" className="sr-only">What do you offer?</label>
          <input
            id="find-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='What do you offer? e.g. "line pipe", "piping"'
            maxLength={200}
            className="control focus-ring h-11 min-w-0 flex-1 px-3 text-base"
          />
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-bold disabled:opacity-60"
          >
            <Search size={17} aria-hidden />
            {submitting ? "Starting…" : "Search now"}
          </button>
        </div>

        {suggestions.length ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="Suggestions from your products">
            {suggestions.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => setQuery(text)}
                className="quiet-chip focus-ring px-2.5 py-1 text-xs font-semibold hover:border-[#b8c2d2]"
              >
                {text}
              </button>
            ))}
          </div>
        ) : null}

        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="mb-2 text-sm font-semibold text-[#344054]">Markets</legend>
          {markets.map((market) => {
            const on = selected.includes(market.code);
            return (
              <button
                key={market.code}
                type="button"
                aria-pressed={on}
                onClick={() => toggleMarket(market.code)}
                className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold ${
                  on ? "border-[#2563eb] bg-[#eef4ff] text-[#1d4ed8]" : "border-[#d0d5dd] bg-white text-[#475467] hover:border-[#b8c2d2]"
                }`}
              >
                {on ? <Check size={14} aria-hidden /> : null}
                {market.name}
              </button>
            );
          })}
        </fieldset>

        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <legend className="mb-2 text-sm font-semibold text-[#344054]">Looking for</legend>
          {KIND_OPTIONS.map((option) => (
            <label key={option.value} className="inline-flex items-center gap-2 text-sm text-[#344054]">
              <input
                type="radio"
                name="lead-kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="h-4 w-4 accent-[#2563eb]"
              />
              {option.label}
            </label>
          ))}
        </fieldset>

        {error ? (
          <p role="alert" className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm font-semibold text-[#b42318]">{error}</p>
        ) : null}
      </form>

      {runId ? <RunProgress key={runId} runId={runId} onFinished={onFinished} /> : null}
    </div>
  );
}
