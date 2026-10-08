import { NextResponse,type NextRequest } from "next/server";
import { finishCalendarConnection,calendarReturnPath } from "@/mvp/automation/calendar";
import { publicOrigin } from "@/mvp/auth/origin";
export const runtime="nodejs";
export async function GET(request:NextRequest) {
  const url=new URL(calendarReturnPath(request.cookies.get('funnel_return')?.value),publicOrigin(request.url));
  try {
    const code=request.nextUrl.searchParams.get("code");const state=request.nextUrl.searchParams.get("state");
    if(!code||!state)throw new Error("Calendar connection was declined. You can reconnect in Outreach.");
    await finishCalendarConnection(code,state,request.cookies.get("funnel_oauth")?.value);url.searchParams.set("calendar","connected");
  } catch {url.searchParams.set("calendar","failed");}
  const res=NextResponse.redirect(url);for(const name of ['funnel_oauth','funnel_return'])res.cookies.set(name,"",{httpOnly:true,sameSite:"lax",maxAge:0,path:"/api/mvp/automation/calendar"});return res;
}
