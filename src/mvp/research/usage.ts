/**
 * What a search cost and how long it took (docs/mvp/18 §4): AI tokens and calls from llm_usage (the
 * provider-reported counts recorded for every call made for the search), and minutes from the run row.
 */
import type { Queryable } from '@/mvp/db';
import type { RunRow } from '@/mvp/types';

export interface RunUsage { tokens: number; aiCalls: number; failedCalls: number }

export async function runUsage(db: Queryable, runIds: readonly string[]): Promise<Map<string, RunUsage>> {
  const usage = new Map<string, RunUsage>();
  if (!runIds.length) return usage;
  const { rows } = await db.query<{ run_id: string; tokens: string; calls: number; failed: number }>(
    `select run_id::text, coalesce(sum(tokens_in + tokens_out), 0)::text as tokens, count(*)::int as calls, count(*) filter (where not ok)::int as failed
     from llm_usage where run_id = any($1::uuid[]) group by run_id`, [runIds]);
  for (const r of rows) usage.set(r.run_id, { tokens: Number(r.tokens) || 0, aiCalls: r.calls, failedCalls: r.failed });
  return usage;
}

/** Whole minutes from start to finish (or to `now` while running); null before it starts. */
export function runMinutes(run: Pick<RunRow, 'started_at' | 'finished_at' | 'created_at' | 'status'>, now = new Date()): number | null {
  const start = Date.parse(run.started_at ?? run.created_at);
  if (!Number.isFinite(start)) return null;
  const running = run.status === 'running' || run.status === 'queued';
  const end = run.finished_at ? Date.parse(run.finished_at) : running ? now.getTime() : NaN;
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/** "238k" / "9.4k" / "820" — compact token counts for the UI. */
export function compactTokens(n: number): string {
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}
