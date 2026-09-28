import { FlaskConical } from "lucide-react";
import type { BuyerType, ConfidenceBand } from "@/mvp/types";
import { BAND_LABELS, BUYER_TYPE_HINTS, BUYER_TYPE_LABELS } from "./labels";

const BAND_STYLES: Record<ConfidenceBand, string> = {
  high: "border-[#abefc6] bg-[#ecfdf3] text-[#067647]",
  medium: "border-[#fedf89] bg-[#fffaeb] text-[#b54708]",
  low: "border-[#e4e7ec] bg-[#f3f4f6] text-[#4b5563]",
};

/** Confidence: High green, Medium amber, Low grey (09 §6). */
export function ConfidenceChip({ band }: { band: ConfidenceBand | null }) {
  if (!band) {
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-[#e4e7ec] bg-[#f9fafb] px-2 py-px text-xs font-medium text-[#6b7280]">
        Confidence not known
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-xs font-semibold ${BAND_STYLES[band]}`}
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
      className={`inline-flex items-baseline gap-0.5 font-bold tabular-nums text-[#111827] ${big ? "text-2xl" : "text-lg"}`}
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
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[#e9d7fe] bg-[#f9f5ff] px-2 py-px text-xs font-semibold text-[#6941c6]"
      title="Built from fictional example documents, not live sources"
    >
      <FlaskConical size={12} aria-hidden />
      Sample data
    </span>
  );
}

export function NewBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-px text-xs font-bold text-[var(--accent-2)]">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#2563eb]" />
      NEW
    </span>
  );
}

const BUYER_TYPE_STYLES: Record<BuyerType, string> = {
  epc_contractor: "border-[#c7d7fe] bg-[#eef4ff] text-[#3538cd]",
  subcontractor: "border-[#b9e6fe] bg-[#f0f9ff] text-[#026aa2]",
  supplier: "border-[#fcceee] bg-[#fdf2fa] text-[#c11574]",
  owner: "border-[#d0d5dd] bg-[#f9fafb] text-[#344054]",
};

/** EPC contractor / Subcontractor / Supplier / Owner (13 §11). Nothing for leads scored before it existed. */
export function BuyerTypeBadge({ type }: { type: BuyerType | null | undefined }) {
  if (!type) return null;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-px text-xs font-semibold ${BUYER_TYPE_STYLES[type]}`}
      title={BUYER_TYPE_HINTS[type]}
    >
      {BUYER_TYPE_LABELS[type]}
    </span>
  );
}
