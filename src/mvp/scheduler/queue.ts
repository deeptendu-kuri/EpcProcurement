/**
 * One-run-at-a-time queue for "Search now", "Load sample leads" and scheduled saved searches
 * (docs/mvp/13 §7). Pure and dependency-injected so it can be unit-tested without the pipeline.
 *
 * A job starts a pipeline run (`deps.start`, i.e. startRun). startRun returns as soon as the run row
 * exists and keeps working in the background, so the queue then polls the run's status until it is
 * finished (done / failed / cancelled) before it starts the next job.
 */
import type { RunInput, RunStatus } from "@/mvp/types";

export interface QueueJob {
  input: RunInput;
  /** Run over the offline sample documents instead of live sources ("Load sample leads"). */
  sample?: boolean;
  /** Set for scheduled / "Run now" saved searches (dedupes: one ticket per saved search at a time). */
  savedSearchId?: string;
}

export type TicketState = "waiting" | "running" | "done" | "failed";

export interface Ticket {
  id: string;
  job: QueueJob;
  state: TicketState;
  runId: string | null;
  error: string | null;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface QueueDeps {
  /** Start a run and return its id (startRun). */
  start: (input: RunInput) => Promise<string>;
  /** Current status of a run (null when unknown). */
  runStatus: (runId: string) => Promise<RunStatus | null>;
  /** Called once the run id is known (e.g. to mark a saved search as run). */
  onStarted?: (ticket: Ticket) => Promise<void> | void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How often to poll the run status (default 2 s). */
  pollMs?: number;
  /** Give up waiting on a run after this long and move on (default 45 min). */
  maxRunMs?: number;
  newId?: () => string;
}

const TERMINAL: RunStatus[] = ["done", "failed", "cancelled"];
const KEEP_FINISHED = 100;

let counter = 0;
function defaultId(): string {
  counter += 1;
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `t${counter}-${random}`;
}

export class RunQueue {
  private readonly tickets = new Map<string, Ticket>();
  private readonly waiting: Ticket[] = [];
  private running: Ticket | null = null;
  private pumping: Promise<void> | null = null;
  private readonly startWaiters = new Map<string, ((ticket: Ticket) => void)[]>();
  private readonly deps: Required<Omit<QueueDeps, "onStarted">> & Pick<QueueDeps, "onStarted">;

  constructor(deps: QueueDeps) {
    this.deps = {
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      pollMs: 2000,
      maxRunMs: 45 * 60 * 1000,
      newId: defaultId,
      ...deps,
    };
  }

  /**
   * Add a job. A saved search that is already waiting or running is not queued twice: its existing
   * ticket is returned instead.
   */
  enqueue(job: QueueJob): Ticket {
    if (job.savedSearchId) {
      const existing = [this.running, ...this.waiting].find((ticket) => ticket?.job.savedSearchId === job.savedSearchId);
      if (existing) return existing;
    }
    const ticket: Ticket = {
      id: this.deps.newId(),
      job,
      state: "waiting",
      runId: null,
      error: null,
      enqueuedAt: this.deps.now(),
      startedAt: null,
      finishedAt: null,
    };
    this.tickets.set(ticket.id, ticket);
    this.waiting.push(ticket);
    this.kick();
    return ticket;
  }

  get(ticketId: string): Ticket | null {
    return this.tickets.get(ticketId) ?? null;
  }

  /** 1-based place in line for a waiting ticket (0 when running or finished). */
  position(ticketId: string): number {
    const index = this.waiting.findIndex((ticket) => ticket.id === ticketId);
    return index < 0 ? 0 : index + 1;
  }

  snapshot(): { running: Ticket | null; waiting: Ticket[] } {
    return { running: this.running, waiting: [...this.waiting] };
  }

  /** Resolves when the ticket has a run id (or finished), or after `timeoutMs` with its current state. */
  whenStarted(ticketId: string, timeoutMs: number): Promise<Ticket | null> {
    const ticket = this.get(ticketId);
    if (!ticket || ticket.runId || ticket.state === "done" || ticket.state === "failed") return Promise.resolve(ticket);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.get(ticketId)), timeoutMs);
      const list = this.startWaiters.get(ticketId) ?? [];
      list.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
      this.startWaiters.set(ticketId, list);
    });
  }

  /** Resolves once the queue has nothing running or waiting (tests). */
  async idle(): Promise<void> {
    while (this.pumping) await this.pumping;
  }

  private kick(): void {
    if (this.pumping) return;
    this.pumping = this.pump().finally(() => {
      this.pumping = null;
      if (this.waiting.length) this.kick();
    });
  }

  private notifyStarted(ticket: Ticket): void {
    const list = this.startWaiters.get(ticket.id);
    if (!list) return;
    this.startWaiters.delete(ticket.id);
    for (const resolve of list) resolve(ticket);
  }

  private async pump(): Promise<void> {
    while (this.waiting.length) {
      const ticket = this.waiting.shift()!;
      this.running = ticket;
      ticket.state = "running";
      ticket.startedAt = this.deps.now();
      try {
        const input = ticket.job.sample ? { ...ticket.job.input, offline: true } : ticket.job.input;
        ticket.runId = await this.deps.start(input);
        this.notifyStarted(ticket);
        try {
          await this.deps.onStarted?.(ticket);
        } catch (error) {
          console.error("[queue] onStarted failed", error);
        }
        const status = await this.waitUntilFinished(ticket.runId);
        ticket.state = status === "done" ? "done" : "failed";
        if (status !== "done") ticket.error = status === null ? "The search did not finish in time." : `The search ended as ${status}.`;
      } catch (error) {
        ticket.state = "failed";
        ticket.error = error instanceof Error ? error.message : String(error);
        console.error("[queue] run failed to start", error);
      } finally {
        ticket.finishedAt = this.deps.now();
        this.running = null;
        this.notifyStarted(ticket);
        this.forgetOld();
      }
    }
  }

  /** Poll until the run is finished. Returns the final status, or null when it took longer than maxRunMs. */
  private async waitUntilFinished(runId: string): Promise<RunStatus | null> {
    const started = this.deps.now();
    for (;;) {
      let status: RunStatus | null = null;
      try {
        status = await this.deps.runStatus(runId);
      } catch (error) {
        console.error("[queue] could not read run status", error);
      }
      if (status && TERMINAL.includes(status)) return status;
      if (this.deps.now() - started >= this.deps.maxRunMs) return null;
      await this.deps.sleep(this.deps.pollMs);
    }
  }

  private forgetOld(): void {
    const finished = [...this.tickets.values()].filter((ticket) => ticket.state === "done" || ticket.state === "failed");
    for (const ticket of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) this.tickets.delete(ticket.id);
  }
}
