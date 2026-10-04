import type { RunCounters, RunStage, RunStatus } from "@/mvp/types";

/** The 4 fixed steps on the progress bar (09 §4.1). */
export const RUN_STEPS = ["collecting", "reading", "checking", "scoring"] as const;
export type RunStep = (typeof RUN_STEPS)[number];

const STAGE_TO_STEP: Partial<Record<RunStage, number>> = {
  collect: 0,
  read: 1,
  filter: 1,
  extract: 2,
  check: 2,
  resolve: 2,
  signals: 3,
  score: 3,
  research: 3,
};

/** Index of the current step (0–3), or 4 when the run is finished. Info/error events keep the previous step. */
export function stepIndex(stages: RunStage[], status: RunStatus): number {
  if (status === "done") return RUN_STEPS.length;
  let index = 0;
  for (const stage of stages) {
    const mapped = STAGE_TO_STEP[stage];
    if (mapped !== undefined && mapped > index) index = mapped;
  }
  return index;
}

/** Progress 0–100 for the bar: whole steps done plus a share of the current one. */
export function progressPercent(step: number, counters: RunCounters, status: RunStatus): number {
  if (status === "done") return 100;
  let within = 0.4;
  if (step === 0 && counters.sourcesTotal) {
    within = Math.min(1, ((counters.sourcesDone ?? 0) + (counters.sourcesFailed ?? 0)) / counters.sourcesTotal) * 0.9;
  }
  return Math.round(((step + within) / RUN_STEPS.length) * 100);
}

/** "Searched 3 of 5 sources · read 24 items · 6 relevant · 3 new leads" — only parts we know. */
export function countersLine(counters: RunCounters): string {
  const parts: string[] = [];
  if (counters.sourcesTotal) {
    const searched = (counters.sourcesDone ?? 0) + (counters.sourcesFailed ?? 0);
    parts.push(`Searched ${searched} of ${counters.sourcesTotal} sources`);
  }
  if (counters.itemsRead !== undefined) parts.push(`read ${counters.itemsRead} items`);
  if (counters.relevant !== undefined) parts.push(`${counters.relevant} relevant`);
  if (counters.scopedProspects !== undefined) parts.push(`${counters.scopedProspects} buyer prospects saved`);
  if (counters.newLeads !== undefined) parts.push(`${counters.newLeads} new raw lead records`);
  if (counters.updatedLeads) parts.push(`${counters.updatedLeads} updated`);
  const line = parts.join(" · ");
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : "";
}

/**
 * Counters to show: event counters in order, then the run row's own counters on top (the pipeline
 * keeps `runs.counters` current, and it holds the final totals once the run ends).
 */
export function mergeCounters(runCounters: RunCounters | null | undefined, eventCounters: (RunCounters | null)[]): RunCounters {
  const merged: RunCounters = {};
  for (const counters of eventCounters) if (counters) Object.assign(merged, counters);
  for (const [key, value] of Object.entries(runCounters ?? {})) {
    if (value !== undefined && value !== null) (merged as Record<string, number>)[key] = value as number;
  }
  return merged;
}
