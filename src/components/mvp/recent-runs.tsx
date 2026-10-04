import Link from "next/link";
import { marketName } from "@/mvp/config/markets";
import type { RunRow, RunStatus } from "@/mvp/types";
import { formatDateTime } from "./labels";

const STATUS_TEXT: Record<RunStatus, { label: string; className: string }> = {
  queued: { label: "Starting", className: "text-[#475467]" },
  running: { label: "Running", className: "text-[#1d4ed8]" },
  done: { label: "Finished", className: "text-[#067647]" },
  failed: { label: "Stopped", className: "text-[#b42318]" },
  cancelled: { label: "Cancelled", className: "text-[#475467]" },
};

/** Recent "Search now" runs, newest first. */
export function RecentRuns({ runs }: { runs: RunRow[] }) {
  return (
    <section aria-labelledby="recent-runs" className="surface rounded-xl">
      <h2 id="recent-runs" className="border-b border-[#e1e6ef] px-4 py-3 text-sm font-bold text-[#101828]">Recent searches</h2>
      {runs.length ? (
        <ul className="divide-y divide-[#edf1f6]">
          {runs.map((run) => {
            const input = run.adhoc_query;
            const status = STATUS_TEXT[run.status];
            const newLeads = run.counters?.newLeads;
            const prospects = run.counters?.scopedProspects;
            return (
              <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className="font-semibold text-[#101828]">{input?.query ?? "Search"}</span>
                <span className="text-[#475467]">{input?.markets.map((code) => marketName(code)).join(", ")}</span>
                <span className="text-[#667085]">{formatDateTime(run.started_at ?? run.created_at)}</span>
                <span className={`font-semibold ${status.className}`}>{status.label}</span>
                {newLeads !== undefined ? (
                  <span className="tabular-nums text-[#344054]">{prospects !== undefined ? `${prospects} potential buyers saved` : input?.productId ? "Buyer count unavailable for this older search" : `${newLeads} raw research records`}</span>
                ) : null}
                <span className="ml-auto flex gap-3">
                  <Link href={`/find?run=${run.id}`} className="font-semibold text-[#1d4ed8] hover:underline">Progress</Link>
                  {run.status === "done" ? (
                    <Link href={input?.productId ? `/crm?search=${run.id}` : "/search"} className="font-semibold text-[#1d4ed8] hover:underline">{input?.productId ? "Open search results →" : "Legacy buyers →"}</Link>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-6 text-sm text-[#667085]">No searches yet. Your searches will show here.</p>
      )}
    </section>
  );
}
