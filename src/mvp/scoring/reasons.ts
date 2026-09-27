/**
 * Top 3 reasons (docs/mvp/07 §9): rules, not AI. Take the three highest-scoring sub-criteria and
 * turn each into a short sentence with the evidence behind it. The rubric writes every SubScore.reason
 * from a fixed template filled with facts (e.g. "EPC contract awarded 12 Aug 2026 (2 sources)"),
 * so the reason text here is that sentence.
 */
import type { CriterionScore, Reason, SubScore } from "@/mvp/types";

const LEADING_FALLBACK: Record<string, (sub: SubScore) => string> = {
  "1.1": () => "Package is in your core discipline",
  "1.2": () => "Requirement matches one of your products",
  "2.1": () => "Right stage to engage",
  "3.2": () => "Award or funding confirmed",
};

/** Up to `limit` reasons from the highest-scoring sub-criteria (ties: higher share of max, then id order). */
export function topReasons(criteria: CriterionScore[], limit = 3): Reason[] {
  const subs = criteria.flatMap((criterion) => criterion.subs).filter((sub) => (sub.points ?? 0) > 0);
  const order = new Map(criteria.flatMap((c) => c.subs).map((sub, index) => [sub.id, index]));
  subs.sort(
    (a, b) =>
      (b.points ?? 0) - (a.points ?? 0) ||
      (b.points ?? 0) / b.max - (a.points ?? 0) / a.max ||
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );
  return subs.slice(0, limit).map((sub) => ({
    text: sub.reason?.trim() || LEADING_FALLBACK[sub.id]?.(sub) || sub.label,
    evidenceIds: sub.evidenceIds,
  }));
}
