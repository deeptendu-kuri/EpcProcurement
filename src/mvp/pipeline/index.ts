import type { RunInput } from "@/mvp/types";

/**
 * Start a "Search now" run (docs/mvp/12 §1 F1, 05, 06).
 *
 * Inserts a `runs` row (status 'queued' → 'running'), returns its id immediately, and continues in the
 * background: collect (TED, GDELT, RSS; fixtures when MVP_OFFLINE=1 or a source fails) → read → filter →
 * extract (getLLM('extract_a'/'extract_b'), mock in demo mode) → quote check → agreement → resolve →
 * graph, then calls `buildSignalsAndScore(runId)`. Progress is appended to `run_events` with
 * `RunCounters`; `runs.status` ends as 'done' or 'failed'. A failing source never stops the run.
 *
 * @param input query text, market codes (e.g. ["IN","SA"]) and lead kinds.
 * @returns the new run id (uuid).
 */
export async function startRun(input: RunInput): Promise<string> {
  void input;
  throw new Error("not implemented");
}
