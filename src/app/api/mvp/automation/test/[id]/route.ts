import { NextResponse } from "next/server";
import { AUTOMATION_RECIPIENT } from "@/mvp/automation/config";
import { listFunnelThreads,listEmailTestMessages } from "@/mvp/automation/engine";
import { NO_STORE,jsonError,serverError,uuidSchema } from "../../../_shared/http";
export const runtime="nodejs";
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;if(!uuidSchema.safeParse(id).success)return jsonError(400,"Invalid test conversation ID.");
  try {
    const threads=(await listFunnelThreads()).filter(t=>t.id===id&&t.mode==="email_test"&&t.recipient===AUTOMATION_RECIPIENT);
    if(!threads.length)return jsonError(404,"Test conversation not found.");
    return NextResponse.json({threads,messages:await listEmailTestMessages(id)},{headers:NO_STORE});
  }catch(e){return serverError("read email workflow test",e);}
}
