import { NextResponse } from "next/server";
import { z } from "zod";
import { listFunnelThreads,listThreadMessages,reviewedProspectStatus,startReviewedProspectDemo } from "@/mvp/automation/engine";
import { AUTOMATION_RECIPIENT,funnelStatus } from "@/mvp/automation/config";
import { rejectCrossOrigin } from "../../../outreach/_origin";
import { NO_STORE,jsonError,readJson,serverError,uuidSchema } from "../../../_shared/http";
export const runtime="nodejs";
async function conversation(id:string) {
  const eligibility=await reviewedProspectStatus(id);
  if(!eligibility)return null;
  return {threads:await listFunnelThreads(id),messages:await listThreadMessages(id),settings:await funnelStatus(),eligibility};
}
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;if(!uuidSchema.safeParse(id).success)return jsonError(400,"Invalid opportunity ID.");
  try{const data=await conversation(id);return data?NextResponse.json(data,{headers:NO_STORE}):jsonError(404,"Prospect not found.");}
  catch(e){return serverError("read conversation",e);}
}
const startSchema=z.object({action:z.literal('start_demo'),confirmedRecipient:z.literal(AUTOMATION_RECIPIENT)}).strict();
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  const rejected=rejectCrossOrigin(request);if(rejected)return rejected;
  const {id}=await context.params;if(!uuidSchema.safeParse(id).success)return jsonError(400,"Invalid opportunity ID.");
  const parsed=await readJson(request,startSchema);if(parsed.response)return parsed.response;
  try {
    await startReviewedProspectDemo(id);
    return NextResponse.json(await conversation(id),{headers:NO_STORE});
  } catch(e){return jsonError(409,e instanceof Error?e.message:"This prospect cannot enter the demo funnel.");}
}
