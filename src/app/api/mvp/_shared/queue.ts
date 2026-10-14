import { NextResponse } from "next/server";
import { getRunQueue, type QueueJob, type Ticket } from "@/mvp/scheduler";
import { NO_STORE } from "./http";
import { serverlessRuntime,SERVERLESS_SETUP_MESSAGE } from "@/mvp/runtime";
import { createResearchRun } from "@/mvp/research/store";
import { startResearchWorker } from "@/mvp/research/worker";
import { mvpEnv } from "@/mvp/config/env";
import { resolveMaterial, resolveSearchItem } from "@/mvp/discovery/material-catalogue";
import { isSearchItemId } from "@/mvp/discovery/item";

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
  // docs/mvp/22: no product type is imposed. A search without one is the item its words name (a catalogue product
  // only when the words are exactly that product).
  if(!job.input.productId&&!job.sample&&!job.input.offline&&!mvpEnv.offline())job={...job,input:{...job.input,productId:resolveSearchItem(job.input.query).productId}};
  // An explicit catalogue product (an older client or a saved search) must still match the words.
  if(job.input.productId&&!isSearchItemId(job.input.productId)&&!job.sample&&!job.input.offline&&!mvpEnv.offline()){
    const material=resolveMaterial(job.input.query,job.input.productId);
    if(material.status!=='resolved')return NextResponse.json({error:material.question,materialStatus:material.status,candidateIds:material.candidateIds},{status:422,headers:NO_STORE});
  }
  if(serverlessRuntime())return NextResponse.json({error:SERVERLESS_SETUP_MESSAGE},{status:503,headers:NO_STORE});
  // Isolated benchmark driver drains authenticated durable jobs itself, with all timers off.
  // This opt-in cannot change execution on Render or Vercel.
  const manual=process.env.MVP_RESEARCH_MANUAL_DRIVER==='1'&&!process.env.RENDER&&!process.env.VERCEL;
  if(job.input.productId&&!job.sample&&!job.input.offline&&!mvpEnv.offline()&&(process.env.MVP_DURABLE_RESEARCH!=='off'||manual)){
    const runId=await createResearchRun(job.input);if(!manual)startResearchWorker();
    return NextResponse.json({ticketId:`durable-${runId}`,runId,state:'running',position:0,error:null},{status:202,headers:NO_STORE});
  }
  const queue = getRunQueue();
  const ticket = queue.enqueue(job);
  const started = (await queue.whenStarted(ticket.id, START_WAIT_MS)) ?? ticket;
  if (started.state === "failed" && !started.runId) {
    return NextResponse.json({ ...ticketBody(started), error: "The search could not start. Try again in a moment." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json(ticketBody(started), { status: 202, headers: NO_STORE });
}
