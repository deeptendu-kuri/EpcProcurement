import { NextResponse } from "next/server";
import { getAppStatus } from "@/mvp/scheduler/status";
import { NO_STORE, serverError } from "../_shared/http";

/** GET /api/mvp/status — { lastFinishedAt, newGenuine, queue } for the top bar and sidebar badge. */
export async function GET() {
  try {
    return NextResponse.json(await getAppStatus(), { headers: NO_STORE });
  } catch (error) {
    return serverError("status", error);
  }
}
