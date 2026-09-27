import { FlaskConical } from "lucide-react";
import type { ConfidenceBand } from "@/mvp/types";
import { BAND_LABELS } from "./labels";

const BAND_STYLES: Record<ConfidenceBand, string> = {
  high: "border-[#abefc6] bg-[#ecfdf3] text-[#067647]",
  medium: "border-[#fedf89] bg-[#fffaeb] text-[#b54708]",
  low: "border-[#d0d5dd] bg-[#f2f4f7] text-[#475467]",
};

/** Confidence: High green, Medium amber, Low grey (09 §6). */
export function ConfidenceChip({ band }: { band: ConfidenceBand | null }) {
  if (!band) {
    return (
      <span className="inline-flex items-center rounded-md border border-[#d0d5dd] bg-[#f9fafb] px-2 py-0.5 text-xs font-semibold text-[#667085]">
        Confidence not known
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${BAND_STYLES[band]}`}
      title="How much we trust the facts behind this lead"
    >
      {BAND_LABELS[band]}
    </span>
  );
}

/** Score 0–100 in tabular figures; "–" when not scored. */
export function ScoreBadge({ score, size = "md" }: { score: number | null; size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <span
      className={`inline-flex items-baseline gap-0.5 font-bold tabular-nums text-[#101828] ${big ? "text-2xl" : "text-lg"}`}
      aria-label={score === null ? "Not scored" : `Score ${score} out of 100`}
    >
      {score ?? "–"}
      {big ? <span className="text-sm font-semibold text-[#667085]">/ 100</span> : null}
    </span>
  );
}

export function SampleBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-[#e9d7fe] bg-[#f9f5ff] px-2 py-0.5 text-xs font-bold text-[#6941c6]"
      title="Built from fictional example documents, not live sources"
    >
      <FlaskConical size={12} aria-hidden />
      Sample data
    </span>
  );
}

export function NewBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[#eef4ff] px-2 py-0.5 text-xs font-bold text-[#1d4ed8]">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#2563eb]" />
      NEW
    </span>
  );
}
