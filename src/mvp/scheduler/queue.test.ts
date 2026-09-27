// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RunInput, RunStatus } from "@/mvp/types";
import { RunQueue } from "./queue";

const input: RunInput = { query: "line pipe", markets: ["IN"], leadKinds: ["bid"] };

/**
 * A fake pipeline: start() returns at once (like startRun) and the run finishes only when the test
 * says so, so the queue has to poll the status before starting the next job.
 */
function fakePipeline() {
  const statuses = new Map<string, RunStatus>();
  const started: RunInput[] = [];
  let running = 0;
  let maxRunning = 0;
  let next = 0;
  return {
    started,
    statuses,
    get maxRunning() {
      return maxRunning;
    },
    finish(runId: string, status: RunStatus = "done") {
      statuses.set(runId, status);
      running -= 1;
    },
    deps: {
      start: async (value: RunInput) => {
        started.push(value);
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        next += 1;
        const id = `run-${next}`;
        statuses.set(id, "running");
        return id;
      },
      runStatus: async (runId: string) => statuses.get(runId) ?? null,
      sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
      pollMs: 1,
    },
  };
}

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

describe("RunQueue: one run at a time (docs/mvp/13 §7)", () => {
  it("starts the next job only after the running run has finished", async () => {
    const pipeline = fakePipeline();
    const queue = new RunQueue(pipeline.deps);
    const a = queue.enqueue({ input });
    const b = queue.enqueue({ input: { ...input, query: "valves" } });

    await waitFor(() => a.runId !== null);
    expect(a.state).toBe("running");
    expect(b.state).toBe("waiting");
    expect(queue.position(b.id)).toBe(1);
    // startRun resolved, but the run is still going: B must not start.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pipeline.started).toHaveLength(1);

    pipeline.finish(a.runId!);
    await waitFor(() => b.runId !== null);
    expect(a.state).toBe("done");
    pipeline.finish(b.runId!, "failed");
    await queue.idle();
    expect(b.state).toBe("failed");
    expect(b.error).toContain("failed");
    expect(pipeline.maxRunning).toBe(1);
    expect(pipeline.started.map((value) => value.query)).toEqual(["line pipe", "valves"]);
  });

  it("does not queue the same saved search twice", async () => {
    const pipeline = fakePipeline();
    const queue = new RunQueue(pipeline.deps);
    const first = queue.enqueue({ input, savedSearchId: "s1" });
    const again = queue.enqueue({ input, savedSearchId: "s1" });
    const other = queue.enqueue({ input, savedSearchId: "s2" });
    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
    await waitFor(() => first.runId !== null);
    pipeline.finish(first.runId!);
    await waitFor(() => other.runId !== null);
    pipeline.finish(other.runId!);
    await queue.idle();
    expect(pipeline.started).toHaveLength(2);
  });

  it("marks sample jobs as offline runs and reports the run id to onStarted", async () => {
    const pipeline = fakePipeline();
    const seen: string[] = [];
    const queue = new RunQueue({ ...pipeline.deps, onStarted: (ticket) => void seen.push(ticket.runId!) });
    const ticket = queue.enqueue({ input, sample: true });
    const started = await queue.whenStarted(ticket.id, 1000);
    expect(started?.runId).toBe("run-1");
    expect(pipeline.started[0].offline).toBe(true);
    expect(seen).toEqual(["run-1"]);
    pipeline.finish("run-1");
    await queue.idle();
  });

  it("moves on when a run fails to start or never finishes", async () => {
    let clock = 0;
    const statuses: (RunStatus | null)[] = [];
    const queue = new RunQueue({
      start: async (value) => {
        if (value.query === "boom") throw new Error("database down");
        return "stuck-run";
      },
      runStatus: async () => {
        statuses.push("running");
        return "running";
      },
      sleep: async () => {
        clock += 60_000;
      },
      now: () => clock,
      maxRunMs: 5 * 60_000,
    });
    const bad = queue.enqueue({ input: { ...input, query: "boom" } });
    const stuck = queue.enqueue({ input });
    await queue.idle();
    expect(bad.state).toBe("failed");
    expect(bad.error).toBe("database down");
    expect(stuck.state).toBe("failed");
    expect(stuck.error).toMatch(/did not finish in time/);
    expect(queue.snapshot()).toEqual({ running: null, waiting: [] });
  });
});
