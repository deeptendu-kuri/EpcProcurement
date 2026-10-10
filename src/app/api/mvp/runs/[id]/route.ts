import { after,NextResponse } from "next/server";
import { z } from "zod";
import { getRun } from "@/mvp/repo";
import { continueBuyerRun,waitForRun } from "@/mvp/pipeline";
import { cancelResearchRun,replayCachedCompanyAnalyses } from '@/mvp/research/store';
import { finishResearchNow,pauseResearchRun,resumePausedRun } from '@/mvp/research/control';
import { getDb } from '@/mvp/db';
import { startResearchWorker } from '@/mvp/research/worker';
import { serverlessRuntime } from '@/mvp/runtime';
import { rejectCrossOrigin } from "../../outreach/_origin";
import { NO_STORE, jsonError,readJson,serverError, uuidSchema } from "../../_shared/http";

/**
 * GET /api/mvp/runs/[id]?after=<eventId> — { run } with status, counters and progress events.
 * `after` returns only newer events, for the 2 s polling on Find.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Search not found.");
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
  try {
    const run = await getRun(id, Number.isFinite(after) && after > 0 ? after : undefined);
    if (!run) return jsonError(404, "Search not found.");
    return NextResponse.json({ run }, { headers: NO_STORE });
  } catch (error) {
    return serverError("get run", error);
  }
}
/**
 * Explicit bounded analysis of saved pages (no new source/search requests); "cancel" stops a running search;
 * "pause", "resume" and "finish" control it (research/control.ts). Auth is enforced by proxy.
 */
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const rejected=rejectCrossOrigin(request);if(rejected)return rejected;
  const {id}=await params;if(!uuidSchema.safeParse(id).success)return jsonError(404,"Search not found.");
  const parsed=await readJson(request,z.object({action:z.enum(["continue_analysis","replay_cached","cancel","pause","resume","finish"])}).strict());if(parsed.response)return parsed.response;
  try{
    if(parsed.data.action==='cancel'){
      const stopped=await cancelResearchRun(getDb(),id);
      return stopped?NextResponse.json({runId:id,state:'cancelled'},{headers:NO_STORE}):jsonError(409,'This search is not running.');
    }
    if(parsed.data.action==='pause'){
      return await pauseResearchRun(getDb(),id)?NextResponse.json({runId:id,state:'paused'},{headers:NO_STORE}):jsonError(409,'This search is not running.');
    }
    if(parsed.data.action==='resume'){
      if(!await resumePausedRun(getDb(),id))return jsonError(409,'This search is not paused.');
      startResearchWorker();return NextResponse.json({runId:id,state:'running'},{headers:NO_STORE});
    }
    if(parsed.data.action==='finish'){
      return await finishResearchNow(getDb(),id)?NextResponse.json({runId:id,state:'done'},{headers:NO_STORE}):jsonError(409,'This search is not running.');
    }
    if(parsed.data.action==='replay_cached'){
      if(serverlessRuntime())return jsonError(409,'Run cached-response repair on the persistent local worker.');
      const queued=await replayCachedCompanyAnalyses(id);startResearchWorker();after(()=>waitForRun(id));
      return NextResponse.json({runId:id,state:'running',cachedAnalyses:queued},{status:202,headers:NO_STORE});
    }
    await continueBuyerRun(id);after(()=>waitForRun(id));return NextResponse.json({runId:id,state:"running"},{status:202,headers:NO_STORE});
  }
  catch(error){return jsonError(409,error instanceof Error?error.message:"Saved-page analysis could not start.");}
}
