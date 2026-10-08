import { NextResponse } from "next/server";
import { z } from "zod";
import { AUTOMATION_RECIPIENT,funnelStatus,setFunnelEnabled } from "@/mvp/automation/config";
import { listFunnelThreads,controlThread,startEmailTest,sendSellerTestIntroduction,recoverMeetingSelection } from "@/mvp/automation/engine";
import { rejectCrossOrigin } from "../outreach/_origin";
import { NO_STORE,readJson,jsonError,serverError } from "../_shared/http";
export const runtime="nodejs";
export async function GET() {
  try{return NextResponse.json({settings:await funnelStatus(),threads:await listFunnelThreads()},{headers:NO_STORE});}
  catch(e){return serverError("read sales funnel",e);}
}
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("enable"),confirmedRecipient:z.literal(AUTOMATION_RECIPIENT)}).strict(),
  z.object({action:z.literal("start_email_test"),confirmedRecipient:z.literal(AUTOMATION_RECIPIENT),productId:z.string().min(1).max(100)}).strict(),
  z.object({action:z.literal("send_seller_test_intro"),confirmedRecipient:z.literal(AUTOMATION_RECIPIENT),threadId:z.uuid()}).strict(),
  z.object({action:z.literal("recover_meeting_selection"),threadId:z.uuid(),messageId:z.uuid()}).strict(),
  z.object({action:z.literal("disable")}).strict(),
  z.object({action:z.enum(["pause","resume","stop","retry"]),threadId:z.uuid()}).strict(),
]);
export async function POST(request:Request) {
  const rejected=rejectCrossOrigin(request);if(rejected)return rejected;
  const parsed=await readJson(request,schema);if(parsed.response)return parsed.response;
  try {
    const d=parsed.data;
    if(d.action==="enable"||d.action==="disable") await setFunnelEnabled(d.action==="enable");
    else if(d.action==="start_email_test")await startEmailTest(d.productId);
    else if(d.action==="send_seller_test_intro")await sendSellerTestIntroduction(d.threadId);
    else if(d.action==="recover_meeting_selection")await recoverMeetingSelection(d.threadId,d.messageId);
    else await controlThread(d.threadId,d.action);
    return NextResponse.json({settings:await funnelStatus(),threads:await listFunnelThreads()},{headers:NO_STORE});
  } catch(e){return jsonError(409,e instanceof Error?e.message:"Automation configuration/action failed.");}
}
