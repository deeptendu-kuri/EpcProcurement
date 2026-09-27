// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";

// The scheduler must never reach the real pipeline in tests.
vi.mock("@/mvp/pipeline", () => ({ startRun: vi.fn(async () => "00000000-0000-4000-8000-000000000000") }));

import {
  createSavedSearch,
  deleteSavedSearch,
  dueSavedSearches,
  isDue,
  listSavedSearches,
  markSavedSearchRun,
  nextRunAt,
  updateSavedSearch,
} from "@/mvp/saved-searches";
import { INTERRUPTED_MESSAGE, RunQueue, recoverInterruptedRuns, schedulerDisabled, schedulerTick } from "./index";

const HOUR = 60 * 60 * 1000;
let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
}, 120_000);

afterAll(async () => {
  setDbForTests(undefined);
  await db?.close();
});

describe("due-time logic (docs/mvp/13 §7)", () => {
  const base = { active: true, refresh_hours: 6 as const, last_run_at: "2026-09-27T00:00:00.000Z", created_at: "2026-09-26T00:00:00.000Z" };

  it("is due refresh_hours after the last run", () => {
    expect(nextRunAt(base)?.toISOString()).toBe("2026-09-27T06:00:00.000Z");
    expect(isDue(base, new Date("2026-09-27T05:59:00.000Z"))).toBe(false);
    expect(isDue(base, new Date("2026-09-27T06:00:00.000Z"))).toBe(true);
    expect(isDue({ ...base, refresh_hours: 24 }, new Date("2026-09-27T12:00:00.000Z"))).toBe(false);
  });

  it("runs a never-run search at once, and never runs manual or paused ones", () => {
    expect(isDue({ ...base, last_run_at: null }, new Date("2026-09-26T00:00:01.000Z"))).toBe(true);
    expect(nextRunAt({ ...base, refresh_hours: null })).toBeNull();
    expect(isDue({ ...base, refresh_hours: null }, new Date("2030-01-01"))).toBe(false);
    expect(isDue({ ...base, active: false }, new Date("2030-01-01"))).toBe(false);
  });

  it("is off during the build, in tests and when MVP_SCHEDULER=off", () => {
    expect(schedulerDisabled({ NEXT_PHASE: "phase-production-build" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(schedulerDisabled({ VITEST: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(schedulerDisabled({ MVP_SCHEDULER: "off" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(schedulerDisabled({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("saved searches and the scheduler tick (database)", () => {
  it("creates, lists, pauses and deletes saved searches; the first run counts as the last run", async () => {
    const run = (await db.query<{ id: string }>("insert into runs (adhoc_query, status, started_at, counters) values ('{}', 'done', now(), $1) returning id", [
      JSON.stringify({ newLeads: 3 }),
    ])).rows[0];
    const saved = await createSavedSearch({ name: "Line pipe", query: "line pipe", markets: ["IN", "SA"], leadKinds: ["bid"], refreshHours: 6, lastRunId: run.id });
    expect(saved).toMatchObject({ name: "Line pipe", markets: ["IN", "SA"], refresh_hours: 6, active: true, last_run_id: run.id, lastRunStatus: "done", lastRunNewLeads: 3 });
    expect(saved.last_run_at).not.toBeNull();
    expect(saved.nextRunAt).not.toBeNull();

    const paused = await updateSavedSearch(saved.id, { active: false });
    expect(paused?.active).toBe(false);
    expect(paused?.nextRunAt).toBeNull();
    expect((await updateSavedSearch(saved.id, { active: true, refreshHours: null }))?.refresh_hours).toBeNull();
    expect((await listSavedSearches()).map((item) => item.id)).toContain(saved.id);
    expect(await deleteSavedSearch(saved.id)).toBe(true);
    expect(await deleteSavedSearch(saved.id)).toBe(false);
  });

  it("enqueues only the due searches, once each", async () => {
    const due = await createSavedSearch({ name: "Due", query: "valves", markets: ["AE"], leadKinds: ["supply_subcontract"], refreshHours: 6 });
    const fresh = await createSavedSearch({ name: "Fresh", query: "pipe", markets: ["IN"], leadKinds: ["bid"], refreshHours: 24 });
    const manual = await createSavedSearch({ name: "Manual", query: "pipe", markets: ["IN"], leadKinds: ["bid"], refreshHours: null });
    await db.query("update saved_searches set last_run_at = now() - interval '7 hours' where id = $1", [due.id]);
    await db.query("update saved_searches set last_run_at = now() - interval '2 hours' where id = $1", [fresh.id]);

    const now = new Date(Date.now() + 1000);
    expect((await dueSavedSearches(now)).map((row) => row.id)).toEqual([due.id]);

    const started: string[] = [];
    let finished = false;
    const queue = new RunQueue({
      start: async (value) => {
        started.push(value.query);
        const run = await db.query<{ id: string }>("insert into runs (adhoc_query, status) values ('{}', 'running') returning id");
        return run.rows[0].id;
      },
      runStatus: async () => (finished ? "done" : "running"),
      onStarted: async (ticket) => {
        if (ticket.job.savedSearchId && ticket.runId) await markSavedSearchRun(ticket.job.savedSearchId, ticket.runId, db);
      },
      sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
    });
    const tickets = await schedulerTick(now, queue, db);
    const again = await schedulerTick(now, queue, db); // still running: not queued twice
    expect(tickets).toHaveLength(1);
    expect(tickets[0].job).toMatchObject({ savedSearchId: due.id, input: { query: "valves", markets: ["AE"], leadKinds: ["supply_subcontract"] } });
    expect(again.map((ticket) => ticket.id)).toEqual(tickets.map((ticket) => ticket.id));
    await queue.whenStarted(tickets[0].id, 2000);
    finished = true;
    await queue.idle();
    expect(started).toEqual(["valves"]);
    // Once it has run, it is not due again until refresh_hours have passed.
    expect(await schedulerTick(new Date(Date.now() + 1000), queue, db)).toEqual([]);
    expect(await dueSavedSearches(new Date(Date.now() + 6 * HOUR + 1000))).toHaveLength(1);
    expect(manual.nextRunAt).toBeNull();
    expect(fresh.nextRunAt).not.toBeNull();
  });

  it("marks runs left queued or running by a stopped server as failed ('interrupted')", async () => {
    const insert = async (status: string, createdAt: string) =>
      (await db.query<{ id: string }>("insert into runs (adhoc_query, status, created_at) values ('{}', $1, $2) returning id", [status, createdAt])).rows[0].id;
    const oldRunning = await insert("running", "2026-01-01T00:00:00Z");
    const oldQueued = await insert("queued", "2026-01-01T00:00:00Z");
    const oldDone = await insert("done", "2026-01-01T00:00:00Z");
    const startedAt = new Date();
    const newRunning = await insert("running", new Date(startedAt.getTime() + 60_000).toISOString());

    const recovered = await recoverInterruptedRuns(db, startedAt);
    expect(recovered).toEqual(expect.arrayContaining([oldRunning, oldQueued]));
    expect(recovered).not.toContain(oldDone);
    expect(recovered).not.toContain(newRunning);

    const rows = (await db.query<{ id: string; status: string; error: string | null; finished_at: string | null }>(
      "select id, status, error, finished_at from runs where id = any($1::uuid[])",
      [[oldRunning, oldQueued, oldDone, newRunning]],
    )).rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(oldRunning)).toMatchObject({ status: "failed", error: INTERRUPTED_MESSAGE });
    expect(byId.get(oldRunning)?.finished_at).not.toBeNull();
    expect(byId.get(oldQueued)?.status).toBe("failed");
    expect(byId.get(oldDone)?.status).toBe("done");
    expect(byId.get(newRunning)?.status).toBe("running");
    const events = await db.query<{ stage: string }>("select stage from run_events where run_id = $1", [oldRunning]);
    expect(events.rows.map((row) => row.stage)).toEqual(["error"]);
    // Running it again changes nothing.
    expect(await recoverInterruptedRuns(db, startedAt)).toEqual([]);
  });
});
