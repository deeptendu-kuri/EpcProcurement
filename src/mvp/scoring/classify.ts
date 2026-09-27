/**
 * Lead classes (docs/mvp/07 §8), as written:
 *   Rejected  any gate failed
 *   Watch     gates pass but stage is concept/feasibility, or 1.4 = 0 (below minimum size) — these
 *             "watch triggers" win over the score (07 §7 1.4: "also triggers class watch")
 *   Genuine   score ≥ 70 and confidence high and 4.1 ≠ 0
 *   Research  55 ≤ score < 70, or score ≥ 70 but confidence medium
 *   Watch     everything else (score < 55, or ≥ 70 with low confidence or 4.1 = 0)
 *
 * Research tasks (07 §8): for Genuine and Research leads, every sub-criterion with max ≥ 4 that is
 * unknown or scored below half its maximum.
 */
import type { ConfidenceBand, CriterionScore, GateResult, LeadClass, ProjectStage, SubScore } from "@/mvp/types";
import { SCORING_CONFIG } from "./config";

export interface ClassifyInput {
  gates: GateResult[];
  score: number;
  band: ConfidenceBand;
  /** Points of sub-criterion 4.1 (null = unknown). */
  eligibility: number | null;
  /** Points of sub-criterion 1.4 (null = unknown). */
  size: number | null;
  stage: ProjectStage | null;
}

export function classifyLead(input: ClassifyInput): LeadClass {
  const { genuineMinScore, researchMinScore } = SCORING_CONFIG.classes;
  if (input.gates.some((gate) => !gate.pass)) return "rejected";
  if (input.stage === "concept" || input.stage === "feasibility") return "watch";
  if (input.size === 0) return "watch";
  if (input.score >= genuineMinScore && input.band === "high" && input.eligibility !== 0) return "genuine";
  if (input.score >= researchMinScore && input.score < genuineMinScore) return "research";
  if (input.score >= genuineMinScore && input.band === "medium") return "research";
  return "watch";
}

/** Find a sub-criterion by id across criteria. */
export function findSub(criteria: CriterionScore[], id: string): SubScore | undefined {
  for (const criterion of criteria) {
    const sub = criterion.subs.find((s) => s.id === id);
    if (sub) return sub;
  }
  return undefined;
}

export function totalScore(criteria: CriterionScore[]): number {
  return criteria.reduce((sum, criterion) => sum + criterion.total, 0);
}

/** Sub-criterion ids needing research (07 §8). Empty for Watch and Rejected leads. */
export function researchTasks(criteria: CriterionScore[], leadClass: LeadClass): string[] {
  if (leadClass !== "genuine" && leadClass !== "research") return [];
  const ids: string[] = [];
  for (const criterion of criteria)
    for (const sub of criterion.subs)
      if (sub.max >= 4 && (sub.points === null || sub.points < sub.max / 2)) ids.push(sub.id);
  return ids;
}
