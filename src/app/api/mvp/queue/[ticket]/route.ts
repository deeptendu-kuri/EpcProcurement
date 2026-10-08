import { NextResponse } from "next/server";
import { getRunQueue } from "@/mvp/scheduler";
import { NO_STORE, jsonError } from "../../_shared/http";
import { ticketBody } from "../../_shared/queue";
import { getDb } from "@/mvp/db";

/** GET /api/mvp/queue/[ticket] — { ticketId, runId, state, position } for a queued search. */
export async function GET(_request: Request, { params }: { params: Promise<{ ticket: string }> }) {
  const { ticket: id } = await params;
  if(/^durable-[0-9a-f-]{36}$/i.test(id)){
    const runId=id.slice(8);const run=(await getDb().query<{status:string;error:string|null}>('select status,error from runs where id=$1',[runId])).rows[0];
    if(!run)return jsonError(404,'Search not found.');
    return NextResponse.json({ticketId:id,runId,state:run.status==='queued'?'waiting':run.status==='running'?'running':run.status==='done'?'done':'failed',position:0,error:run.error},{headers:NO_STORE});
  }
  const ticket = getRunQueue().get(String(id).slice(0, 200));
  if (!ticket) return jsonError(404, "This search is no longer in the queue.");
  return NextResponse.json(ticketBody(ticket), { headers: NO_STORE });
}
