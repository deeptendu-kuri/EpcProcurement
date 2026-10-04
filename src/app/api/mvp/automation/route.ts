import { NextResponse } from "next/server";
import { z } from "zod";
import { funnelStatus,setFunnelEnabled } from "@/mvp/automation/config";
import { listFunnelThreads,controlThread } from "@/mvp/automation/engine";
import { rejectCrossOrigin } from "../outreach/_origin";
import { NO_STORE,readJson,jsonError,serverError } from "../_shared/http";
export const runtime="nodejs";
export async function GET() {
  try{return NextResponse.json({settings:await funnelStatus(),threads:await listFunnelThreads()},{headers:NO_STORE});}
  catch(e){return serverError("read sales funnel",e);}
}
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("enable"),confirmedRecipient:z.literal("deeptendukuri@gmail.com")}).strict(),
  z.object({action:z.literal("disable")}).strict(),
  z.object({action:z.enum(["pause","resume","stop","retry"]),threadId:z.uuid()}).strict(),
]);
export async function POST(request:Request) {
  const rejected=rejectCrossOrigin(request);if(rejected)return rejected;
  const parsed=await readJson(request,schema);if(parsed.response)return parsed.response;
  try {
    const d=parsed.data;
    if(d.action==="enable"||d.action==="disable") await setFunnelEnabled(d.action==="enable");
    else await controlThread(d.threadId,d.action);
    return NextResponse.json({settings:await funnelStatus(),threads:await listFunnelThreads()},{headers:NO_STORE});
  } catch(e){return jsonError(409,e instanceof Error?e.message:"Automation configuration/action failed.");}
}
