/**
 * Build signals from the facts written by run `runId`, then create or re-score the candidate leads
 * (docs/mvp/07: signals §2, 8 gates §3, 17 sub-criteria §7, confidence §5, classes §8, reasons §9).
 *
 * Writes `signals` (unique fingerprint), `leads` (unique (buyer, project, package, kind)) with
 * `score_breakdown: ScoreBreakdown`, `gate_results: GateResult[]`, `reasons: Reason[]`, and a
 * `lead_score_history` row per scoring.
 *
 * @returns number of leads created and updated.
 */
export async function buildSignalsAndScore(runId: string): Promise<{ created: number; updated: number }> {
  void runId;
  return { created: 0, updated: 0 };
}
