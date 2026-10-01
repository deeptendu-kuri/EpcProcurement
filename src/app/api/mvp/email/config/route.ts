import { NextResponse } from "next/server";
import { demoEmailInfo } from "@/mvp/email/config";
import { NO_STORE } from "../../_shared/http";

export async function GET() {
  return NextResponse.json(demoEmailInfo(), { headers: NO_STORE });
}
