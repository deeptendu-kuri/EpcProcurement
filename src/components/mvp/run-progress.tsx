"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import type { RunEventRow, RunRow, RunWithEvents } from "@/mvp/types";
import { ApiError, apiJson } from "./api-client";
import { RUN_STEPS, countersLine, mergeCounters, progressPercent, stepIndex } from "./run-steps";

const POLL_MS = 2000;

export function runTitle(run: Pick<RunRow, "adhoc_query"> | null): string {
  const input = run?.adhoc_query;
  if (!input) return "Search";
  const markets = input.markets.map((code) => marketName(code)).join(", ");
  return `${input.query}${markets ? ` · ${markets}` : ""}`;
}

/**
 * Live progress for one run (09 §4.1): polls GET /api/mvp/runs/[id] every 2 s, shows the latest message,
 * the counters line and the 4-step bar, then "See the buyers →" when done. Cancel is not supported yet.
 */
export function RunProgress({ runId, onFinished }: { runId: string; onFinished?: (run: RunRow) => void }) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [events, setEvents] = useState<RunEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastEventId = useRef(0);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    // Callers mount one RunProgress per run (key={runId}), so state starts fresh for each run.
    lastEventId.current = 0;

    const poll = async () => {
      try {
        const after = lastEventId.current ? `?after=${lastEventId.current}` : "";
        const data = await apiJson<{ run: RunWithEvents }>(`/api/mvp/runs/${runId}${after}`, { signal: controller.signal });
        if (cancelled) return;
        const { events: fresh, ...row } = data.run;
        if (fresh.length) {
          lastEventId.current = fresh[fresh.length - 1].id;
          setEvents((previous) => [...previous, ...fresh]);
        }
        setRun(row);
        setError(null);
        if (row.status === "done" || row.status === "failed" || row.status === "cancelled") {
          onFinishedRef.current?.(row);
          return;
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err.message : "Lost contact with the server. Retrying…");
        if (err instanceof ApiError && (err.status === 404 || err.status === 401)) return; // no point retrying
      }
      timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  const status = run?.status ?? "queued";
  const finished = status === "done";
  const failed = status === "failed" || status === "cancelled";
  const step = stepIndex(events.map((event) => event.stage), status);
  const counters = mergeCounters(run?.counters, events.map((event) => event.counters));
  const percent = progressPercent(step, counters, status);
  const latest = [...events].reverse().find((event) => event.message)?.message;
  const line = countersLine(counters);

  return (
    <section aria-label="Search progress" className="surface rounded-xl p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-[#101828]">
        {finished ? (
          <CheckCircle2 size={17} className="text-[#067647]" aria-hidden />
        ) : failed ? (
          <AlertTriangle size={17} className="text-[#b42318]" aria-hidden />
        ) : (
          <Loader2 size={17} className="animate-spin text-[#2563eb]" aria-hidden />
        )}
        {finished ? "Finished" : failed ? "Stopped" : status === "queued" ? "Starting" : "Running"}: “{runTitle(run)}”
      </p>

      <div aria-live="polite" className="mt-2 space-y-1 text-sm">
        {line ? <p className="font-semibold tabular-nums text-[#344054]">{line}</p> : null}
        {latest ? <p className="text-[#475467]">{latest}</p> : !run ? <p className="text-[#667085]">Starting the search…</p> : null}
        {failed ? (
          <p role="alert" className="font-semibold text-[#b42318]">{run?.error || "The search stopped before it finished."}</p>
        ) : null}
        {error ? <p role="alert" className="text-[#b54708]">{error}</p> : null}
      </div>

      <div className="mt-3">
        <div
          role="progressbar"
          aria-label="Search progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 overflow-hidden rounded-full bg-[#eaecf0]"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${failed ? "bg-[#f04438]" : finished ? "bg-[#12b76a]" : "bg-[#2563eb]"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <ol className="mt-2 flex flex-wrap items-center gap-x-2 text-xs font-semibold">
          {RUN_STEPS.map((name, index) => (
            <li key={name} className="flex items-center gap-2">
              <span
                aria-current={index === step ? "step" : undefined}
                className={index < step ? "text-[#067647]" : index === step ? "text-[#1d4ed8]" : "text-[#98a2b3]"}
              >
                {name}
              </span>
              {index < RUN_STEPS.length - 1 ? <span aria-hidden className="text-[#d0d5dd]">→</span> : null}
            </li>
          ))}
        </ol>
      </div>

      {finished ? (
        <div className="mt-3 flex justify-end">
          <Link
            href={run?.adhoc_query?.productId ? `/crm?search=${runId}` : "/search"}
            className="btn-primary focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold"
          >
            See the buyers
            <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      ) : null}
    </section>
  );
}
