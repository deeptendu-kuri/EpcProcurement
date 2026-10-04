import { NextResponse } from "next/server";
import { beginCalendarConnection } from "@/mvp/automation/calendar";
import { rejectCrossOrigin } from "../../../outreach/_origin";
import { jsonError } from "../../../_shared/http";
export const runtime="nodejs";
export async function POST(request:Request) {
  const rejected=rejectCrossOrigin(request);if(rejected)return rejected;
  try {
    const connection=await beginCalendarConnection();const res=NextResponse.json({url:connection.url},{headers:{"Cache-Control":"no-store"}});
    res.cookies.set("funnel_oauth",connection.state,{httpOnly:true,sameSite:"lax",secure:new URL(process.env.APP_URL!).protocol==="https:",maxAge:600,path:"/api/mvp/automation/calendar"});return res;
  } catch(e){return jsonError(503,e instanceof Error?e.message:"Calendar connection unavailable.");}
}
