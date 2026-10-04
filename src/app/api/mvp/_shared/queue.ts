import { NextResponse } from "next/server";
import { getRunQueue, type QueueJob, type Ticket } from "@/mvp/scheduler";
import { NO_STORE } from "./http";
import { serverlessRuntime,SERVERLESS_SETUP_MESSAGE } from "@/mvp/runtime";

/** How long a POST waits for its job to start before answering "waiting in line". */
const START_WAIT_MS = 4000;

export interface TicketBody {
  ticketId: string;
  /** Set once the run has started (then poll /api/mvp/runs/[runId]). */
  runId: string | null;
  state: Ticket["state"];
  /** Place in line while waiting (1 = next). */
  position: number;
  error: string | null;
}

export function ticketBody(ticket: Ticket): TicketBody {
  return {
    ticketId: ticket.id,
    runId: ticket.runId,
    state: ticket.state,
    position: getRunQueue().position(ticket.id),
    error: ticket.error,
  };
}

/** Put a job in the run queue (one run at a time) and answer 202 with its ticket. */
export async function enqueueResponse(job: QueueJob): Promise<NextResponse> {
  if(serverlessRuntime())return NextResponse.json({error:SERVERLESS_SETUP_MESSAGE},{status:503,headers:NO_STORE});
  const queue = getRunQueue();
  const ticket = queue.enqueue(job);
  const started = (await queue.whenStarted(ticket.id, START_WAIT_MS)) ?? ticket;
  if (started.state === "failed" && !started.runId) {
    return NextResponse.json({ ...ticketBody(started), error: "The search could not start. Try again in a moment." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json(ticketBody(started), { status: 202, headers: NO_STORE });
}
