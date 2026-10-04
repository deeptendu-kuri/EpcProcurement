import { NextResponse } from "next/server";
import { listFunnelThreads,listThreadMessages } from "@/mvp/automation/engine";
import { NO_STORE,jsonError,serverError,uuidSchema } from "../../../_shared/http";
export const runtime="nodejs";
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;if(!uuidSchema.safeParse(id).success)return jsonError(400,"Invalid opportunity ID.");
  try{return NextResponse.json({threads:await listFunnelThreads(id),messages:await listThreadMessages(id)},{headers:NO_STORE});}
  catch(e){return serverError("read conversation",e);}
}
