/**
 * Auto-refresh scheduler and the shared run queue (docs/mvp/13 §7). Server-only (Node runtime).
 *
 * - `getRunQueue()` is THE queue: "Search now", "Load sample leads", "Run now" on a saved search and
 *   the scheduler all go through it, so only one pipeline run happens at a time.
 * - `startScheduler()` is called once from src/instrumentation.ts. On start it marks runs left
 *   'queued' / 'running' by a stopped server as failed ("interrupted"), then every 5 minutes enqueues
 *   each active saved search whose refresh time has passed.
 */
import { getDb, type Queryable } from "@/mvp/db";
import { startRun } from "@/mvp/pipeline";
import { dueSavedSearches, markSavedSearchRun } from "@/mvp/saved-searches";
import type { LeadKind, RunStatus, SavedSearchRow } from "@/mvp/types";
import { RunQueue, type QueueDeps, type QueueJob, type Ticket } from "./queue";
import { serverlessRuntime } from "@/mvp/runtime";

export { RunQueue } from "./queue";
export type { QueueJob, Ticket } from "./queue";

export const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;
export const INTERRUPTED_MESSAGE = "Interrupted: the app was restarted before this search finished. Run it again.";

async function runStatus(runId: string): Promise<RunStatus | null> {
  const { rows } = await getDb().query<{ status: RunStatus }>("select status from runs where id = $1", [runId]);
  return rows[0]?.status ?? null;
}

export function productionQueueDeps(): QueueDeps {
  return {
    start: (input) => startRun(input),
    runStatus,
    onStarted: async (ticket: Ticket) => {
      if (ticket.job.savedSearchId && ticket.runId) await markSavedSearchRun(ticket.job.savedSearchId, ticket.runId);
    },
  };
}

type SchedulerGlobal = {
  __mvpRunQueue?: RunQueue;
  __mvpScheduler?: { timer: ReturnType<typeof setInterval> | null; startedAt: number };
};
const g = globalThis as unknown as SchedulerGlobal;

/** The process-wide run queue (survives dev hot reloads). */
export function getRunQueue(): RunQueue {
  return (g.__mvpRunQueue ??= new RunQueue(productionQueueDeps()));
}

/** Replace the queue (tests). */
export function setRunQueueForTests(queue: RunQueue | undefined): void {
  g.__mvpRunQueue = queue;
}

/** The job for a saved search. */
export function savedSearchJob(search: Pick<SavedSearchRow, "id" | "query" | "markets" | "lead_kinds" | "product_id" | "contact_role">): QueueJob {
  return {
    savedSearchId: search.id,
    input: { query: search.query, markets: search.markets ?? [], leadKinds: (search.lead_kinds ?? []) as LeadKind[],
      ...(search.product_id ? { productId: search.product_id } : {}), ...(search.contact_role ? { contactRole: search.contact_role } : {}) },
  };
}

/**
 * Mark runs still 'queued' or 'running' that were created before this process started
 * (`startedBefore`) as failed ("interrupted"). Call at startup. Returns the ids updated.
 */
export async function recoverInterruptedRuns(db: Queryable = getDb(), startedBefore: Date = new Date()): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `update runs set status = 'failed', finished_at = now(), error = $1
      where status in ('queued', 'running') and created_at < $2::timestamptz returning id`,
    [INTERRUPTED_MESSAGE, startedBefore.toISOString()],
  );
  for (const row of rows) {
    await db.query(
      "insert into run_events (run_id, stage, message, counters) select id, 'error', $2, coalesce(counters, '{}'::jsonb) from runs where id = $1",
      [row.id, INTERRUPTED_MESSAGE],
    );
  }
  return rows.map((row) => row.id);
}

/** One scheduler pass: enqueue every due saved search. Returns the tickets created (or reused). */
export async function schedulerTick(now: Date = new Date(), queue: RunQueue = getRunQueue(), db: Queryable = getDb()): Promise<Ticket[]> {
  const due = await dueSavedSearches(now, db);
  return due.map((search) => queue.enqueue(savedSearchJob(search)));
}

/** True when the scheduler must not run in this process (build, tests, or turned off). */
export function schedulerDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (serverlessRuntime(env)) return true;
  if (env.NEXT_PHASE === "phase-production-build") return true;
  if (env.VITEST) return true;
  const flag = env.MVP_SCHEDULER?.trim().toLowerCase();
  return flag === "off" || flag === "0" || flag === "false";
}

/**
 * Start the scheduler once per process (guarded on globalThis). Recovery and the first pass run a few
 * seconds after start so server startup is not delayed.
 */
export function startScheduler(options: { intervalMs?: number; firstDelayMs?: number } = {}): boolean {
  if (g.__mvpScheduler || schedulerDisabled()) return false;
  const intervalMs = options.intervalMs ?? SCHEDULER_INTERVAL_MS;
  const state: NonNullable<SchedulerGlobal["__mvpScheduler"]> = { timer: null, startedAt: Date.now() };
  g.__mvpScheduler = state;

  const tick = async () => {
    try {
      await schedulerTick();
    } catch (error) {
      console.error("[scheduler] tick failed", error);
    }
  };

  const first = setTimeout(async () => {
    try {
      const recovered = await recoverInterruptedRuns(getDb(), new Date(state.startedAt));
      if (recovered.length) console.info(`[scheduler] marked ${recovered.length} interrupted run(s) as failed`);
    } catch (error) {
      console.error("[scheduler] could not recover interrupted runs", error);
    }
    await tick();
    state.timer = setInterval(() => void tick(), intervalMs);
    state.timer.unref?.();
  }, options.firstDelayMs ?? 3000);
  first.unref?.();
  return true;
}
