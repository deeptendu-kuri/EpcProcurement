import { NextResponse } from "next/server";
import { z } from "zod";
import { beginCalendarConnection,calendarReturnPath } from "@/mvp/automation/calendar";
import { rejectCrossOrigin } from "../../../outreach/_origin";
import { jsonError,readJson } from "../../../_shared/http";
export const runtime="nodejs";
export async function POST(request:Request) {
  const rejected=rejectCrossOrigin(request);if(rejected)return rejected;
  const parsed=await readJson(request,z.object({returnTo:z.string().max(200).optional()}).strict());if(parsed.response)return parsed.response;
  try {
    const connection=await beginCalendarConnection();const res=NextResponse.json({url:connection.url},{headers:{"Cache-Control":"no-store"}});
    const cookie={httpOnly:true,sameSite:'lax' as const,secure:new URL(process.env.APP_URL!).protocol==='https:',maxAge:600,path:'/api/mvp/automation/calendar'};
    res.cookies.set("funnel_oauth",connection.state,cookie);
    res.cookies.set('funnel_return',calendarReturnPath(parsed.data.returnTo),cookie);return res;
  } catch(e){return jsonError(503,e instanceof Error?e.message:"Calendar connection unavailable.");}
}
