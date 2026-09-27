import { defaultScoringWeights } from "@/config/scoring";
import type { BuyerScore, ProductRequirement, Signal, SourceEvidence } from "@/types/domain";

interface ScoreInput {
  companyId: string;
  signals: Signal[];
  requirements: ProductRequirement[];
  sources: SourceEvidence[];
  hasTradeVerification: boolean;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function confidenceLabel(input: ScoreInput): BuyerScore["confidence"] {
  const avgSignalConfidence =
    input.signals.reduce((total, signal) => total + signal.confidence, 0) / Math.max(input.signals.length, 1);
  const reliableSources = input.sources.filter((source) => ["Very High", "High"].includes(source.reliability)).length;

  if (avgSignalConfidence >= 0.8 && reliableSources >= 2) {
    return "High";
  }

  if (avgSignalConfidence >= 0.6 || reliableSources >= 1) {
    return "Medium";
  }

  return "Low";
}

export function calculateBuyerScore(input: ScoreInput): BuyerScore {
  const weights = defaultScoringWeights;
  const reasons: BuyerScore["reasons"] = [];
  const evidenceIds = input.sources.map((source) => source.id);
  const hasTender = input.signals.some((signal) => signal.signalType === "TENDER_RELEASED" || signal.signalType === "PROCUREMENT_REQUIREMENT");
  const hasAward = input.signals.some((signal) => signal.signalType === "EPC_AWARD" || signal.signalType === "NEW_PROJECT");
  const hasExactSpec = input.requirements.some((requirement) => requirement.standard || requirement.grade || requirement.diameter);
  const newestSignalDate = input.signals.map((signal) => new Date(signal.signalDate).getTime()).sort((a, b) => b - a)[0];
  const daysSinceNewest = newestSignalDate ? (Date.now() - newestSignalDate) / 86_400_000 : Number.POSITIVE_INFINITY;

  let tenderScore = 0;
  let projectScore = 0;
  let productFitScore = 0;
  let timingScore = 0;
  let tradeScore = 0;
  const intentScore = 0;
  const relationshipScore = 0;

  if (hasTender) {
    tenderScore = weights.explicitTender;
    reasons.push({ label: "Tender or explicit procurement requirement detected", points: tenderScore, evidenceIds });
  }

  if (hasAward) {
    projectScore = weights.recentProjectAward;
    reasons.push({ label: "Recent project or EPC award indicates upcoming materials demand", points: projectScore, evidenceIds });
  }

  if (hasExactSpec) {
    productFitScore = weights.exactProductSpec;
    reasons.push({ label: "Exact product specification detected", points: productFitScore, evidenceIds });
  }

  if (daysSinceNewest <= 120) {
    timingScore = weights.timingWindow;
    reasons.push({ label: "Signal is inside the likely 30-120 day procurement window", points: timingScore, evidenceIds });
  }

  if (input.hasTradeVerification) {
    tradeScore = weights.historicalTradeMatch;
    reasons.push({ label: "Historical trade match verified", points: tradeScore, evidenceIds });
  }

  const companyFitScore = weights.companyFit;
  reasons.push({ label: "Company fits the pipeline/EPC target profile", points: companyFitScore, evidenceIds });

  const score = clampScore(
    tenderScore +
      projectScore +
      productFitScore +
      timingScore +
      tradeScore +
      intentScore +
      relationshipScore +
      companyFitScore,
  );

  return {
    companyId: input.companyId,
    score,
    confidence: confidenceLabel(input),
    productFitScore,
    projectScore,
    tenderScore,
    timingScore,
    tradeScore,
    intentScore,
    relationshipScore,
    calculatedAt: new Date().toISOString(),
    reasons,
  };
}
