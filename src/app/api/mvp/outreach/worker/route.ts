import { NextResponse } from "next/server";
import { processCampaignQueue, workerAuthorized } from "@/mvp/email/campaigns";
import { DemoSendError } from "@/mvp/email/send";
import { NO_STORE, jsonError } from "../../_shared/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  // Deliberately independent of browser sessions; never put the worker secret in a client bundle.
  if (!workerAuthorized(request.headers.get("authorization"))) return jsonError(401, "Worker authentication required.");
  try { return NextResponse.json(await processCampaignQueue(), { headers: NO_STORE }); }
  catch (e) {
    if (e instanceof DemoSendError) return jsonError(e.status, e.message);
    return jsonError(503, "Worker unavailable. Queued jobs remain stored.");
  }
}
