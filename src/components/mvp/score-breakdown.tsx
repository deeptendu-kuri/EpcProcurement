"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Minus, X } from "lucide-react";
import type { ScoreBreakdown as Breakdown, SubScore } from "@/mvp/types";
import { EvidenceButton } from "./evidence";
import { CRITERION_SHORT } from "./labels";

function SubMark({ sub }: { sub: SubScore }) {
  if (sub.points === null) return <Minus size={15} className="text-[#98a2b3]" aria-label="Unknown" />;
  return sub.points > 0 ? (
    <Check size={15} className="text-[#067647]" aria-label="Yes" />
  ) : (
    <X size={15} className="text-[#b42318]" aria-label="No" />
  );
}

/**
 * Score breakdown (07 §7, 09 §4.3): one summary line with the 5 criteria totals, expandable to all
 * sub-criteria with points / max, ✓ / ✗ / "Not found yet", the reason and its proof.
 */
export function ScoreBreakdown({
  breakdown,
  score,
  defaultExpanded = false,
}: {
  breakdown: Breakdown;
  score: number | null;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const criteria = breakdown.criteria ?? [];
  const unknown = new Set(breakdown.unknown ?? []);
  const subCount = criteria.reduce((sum, criterion) => sum + (criterion.subs?.length ?? 0), 0);
  const total = criteria.reduce((sum, criterion) => sum + (criterion.total ?? 0), 0);

  if (!criteria.length) return <p className="text-sm text-[#98a2b3]">This buyer has no buyer fit yet.</p>;

  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
        {criteria.map((criterion, index) => (
          <span key={criterion.id}>
            <span className="font-semibold text-[#344054]">{CRITERION_SHORT[criterion.id] ?? criterion.label}</span>{" "}
            {criterion.total}/{criterion.max}
            {index < criteria.length - 1 ? <span aria-hidden className="ml-3 text-[#d0d5dd]">·</span> : null}
          </span>
        ))}
        <span className="font-bold text-[#101828]">= {score ?? total}</span>
      </p>

      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="focus-ring mt-2 inline-flex items-center gap-1 rounded text-sm font-semibold text-[#1d4ed8]"
      >
        {expanded ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
        {expanded ? "Hide the checks" : `Show all ${subCount} checks`}
      </button>

      {expanded ? (
        <div className="mt-3 flex flex-col gap-4">
          {criteria.map((criterion) => (
            <div key={criterion.id}>
              <h3 className="flex items-baseline justify-between border-b border-[#edf1f6] pb-1 text-sm font-bold text-[#101828]">
                <span>{criterion.label}</span>
                <span className="tabular-nums">{criterion.total} / {criterion.max}</span>
              </h3>
              <ul className="mt-1 divide-y divide-[#f2f4f7]">
                {(criterion.subs ?? []).map((sub) => {
                  const isUnknown = sub.points === null || unknown.has(sub.id);
                  return (
                    <li key={sub.id} className="grid grid-cols-[1.5rem_1fr_auto] items-start gap-2 py-1.5 text-sm">
                      <span className="pt-0.5"><SubMark sub={isUnknown ? { ...sub, points: null } : sub} /></span>
                      <span>
                        <span className="font-semibold text-[#344054]">{sub.label}</span>
                        {isUnknown ? (
                          <span className="ml-2 text-xs font-semibold text-[#98a2b3]">Not found yet</span>
                        ) : null}
                        {sub.reason ? <span className="block text-[#667085]">{sub.reason}</span> : null}
                      </span>
                      <span className="whitespace-nowrap tabular-nums text-[#344054]">
                        {sub.points ?? 0} / {sub.max}
                        <EvidenceButton ids={sub.evidenceIds} label={sub.label} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
