/**
 * Confidence = trust in the facts, separate from priority (docs/mvp/07 §5).
 *
 *   c_j        = tier_weight × verification × freshness × agreement_weight
 *   independent = best c_j per publisher_key (one publisher = one vote)
 *   combined   = 1 − Π(1 − c_j)
 *   confidence = combined × buyer.match_certainty
 *   band       = high ≥ 0.80, medium ≥ 0.50, else low
 */
import type { ConfidenceBand } from "@/mvp/types";
import { SCORING_CONFIG } from "./config";
import { daysBetween, type EvidenceInfo } from "./util";

const C = SCORING_CONFIG.confidence;

export function freshnessWeight(ageDays: number): number {
  if (!Number.isFinite(ageDays)) return C.freshnessOlder;
  for (const [maxAge, weight] of C.freshness) if (ageDays <= maxAge) return weight;
  return C.freshnessOlder;
}

/** c_j for one evidence item. Age is measured from the document date (or when we observed it). */
export function evidenceWeight(evidence: EvidenceInfo, now: Date): number {
  const tier = C.tierWeight[evidence.tier] ?? C.tierWeight.C;
  const verification = evidence.quoteVerified ? C.verified : C.unverified;
  const age = daysBetween(evidence.publishedAt ?? evidence.observedAt, now);
  const agreement = evidence.agreement ? C.agreementWeight[evidence.agreement] : C.agreementWeight.single;
  return tier * verification * freshnessWeight(age) * agreement;
}

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= C.bandHigh) return "high";
  if (confidence >= C.bandMedium) return "medium";
  return "low";
}

export interface ConfidenceResult {
  confidence: number;
  band: ConfidenceBand;
  combined: number;
  /** Publisher → best weight, for explanation. */
  votes: { publisherKey: string; weight: number; evidenceId: string }[];
}

/** Combine evidence for the lead's key facts into a confidence and band. */
export function computeConfidence(evidence: EvidenceInfo[], matchCertainty: number, now: Date): ConfidenceResult {
  const best = new Map<string, { weight: number; evidenceId: string }>();
  for (const item of evidence) {
    const weight = evidenceWeight(item, now);
    const current = best.get(item.publisherKey);
    if (!current || weight > current.weight) best.set(item.publisherKey, { weight, evidenceId: item.id });
  }
  let miss = 1;
  for (const { weight } of best.values()) miss *= 1 - weight;
  const combined = best.size ? 1 - miss : 0;
  const certainty = Number.isFinite(matchCertainty) ? Math.max(0, Math.min(1, matchCertainty)) : 0;
  const confidence = Math.round(combined * certainty * 1000) / 1000;
  return {
    confidence,
    band: confidenceBand(confidence),
    combined,
    votes: [...best.entries()].map(([publisherKey, v]) => ({ publisherKey, ...v })),
  };
}
