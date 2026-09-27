export interface ScoringWeights {
  explicitTender: number;
  recentProjectAward: number;
  exactProductSpec: number;
  historicalTradeMatch: number;
  timingWindow: number;
  companyFit: number;
  intentSignal: number;
  relationship: number;
}

export const defaultScoringWeights: ScoringWeights = {
  explicitTender: 30,
  recentProjectAward: 20,
  exactProductSpec: 15,
  historicalTradeMatch: 15,
  timingWindow: 5,
  companyFit: 5,
  intentSignal: 5,
  relationship: 5,
};
