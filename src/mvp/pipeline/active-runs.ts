/**
 * Runs in flight in THIS process, and clean-up of runs that were left 'queued' / 'running' by a
 * process that stopped (restart, crash, or a dropped background promise). Kept free of heavy imports
 * so the read side (repo.getRun / listRecentRuns) can use it.
 */
import type { Queryable } from "@/mvp/db";

/** A queued/running run with no progress for this long, and not running in this process, is marked failed. */
export const STALE_RUN_MS = 15 * 60 * 1000;
export const INTERRUPTED_ERROR = "Interrupted: the server stopped before this search finished. Please run it again.";

/** In-flight runs (tests and the API can await them). Survives module reloads in dev. */
export function activeRuns(): Map<string, Promise<void>> {
  const g = globalThis as unknown as { __mvpActiveRuns?: Map<string, Promise<void>> };
  return (g.__mvpActiveRuns ??= new Map());
}

/**
 * Mark runs that are still 'queued' or 'running', have shown no progress (last run event, else
 * start/creation time) for more than STALE_RUN_MS and are not running in this process as 'failed'
 * with INTERRUPTED_ERROR.
 * Returns the number of runs updated. Never throws.
 */
export async function failStaleRuns(db: Queryable, staleMs = STALE_RUN_MS): Promise<number> {
  try {
    const active = [...activeRuns().keys()];
    const { rows } = await db.query<{ id: string }>(
      `update runs
          set status = 'failed', finished_at = now(), error = $1
        where status in ('queued', 'running')
          and not exists(select 1 from research_sessions s where s.run_id=runs.id)
          and coalesce((select max(e.ts) from run_events e where e.run_id = runs.id), started_at, created_at)
              < now() - ($2::bigint * interval '1 millisecond')
          and not (id::text = any($3::text[]))
        returning id`,
      [INTERRUPTED_ERROR, Math.max(0, Math.floor(staleMs)), active],
    );
    if (rows.length) {
      for (const row of rows) {
        await db.query("insert into run_events (run_id, stage, message, counters) select id, 'error', $2, coalesce(counters, '{}'::jsonb) from runs where id = $1", [
          row.id,
          INTERRUPTED_ERROR,
        ]);
      }
    }
    return rows.length;
  } catch (error) {
    console.error("[pipeline] could not mark stale runs", error);
    return 0;
  }
}
