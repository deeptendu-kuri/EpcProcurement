import { NextResponse } from "next/server";
import { listRecentRuns } from "@/mvp/repo";
import { NO_STORE, readJson, serverError } from "../_shared/http";
import { enqueueResponse } from "../_shared/queue";
import { runInputSchema } from "../_shared/schemas";

/**
 * POST /api/mvp/runs — "Search now". Body: { query, markets[], leadKinds[] }.
 * The search goes through the shared run queue (one run at a time) → 202 { ticketId, runId, state, position }.
 * `runId` is null while the search waits in line; poll GET /api/mvp/queue/[ticketId] until it is set.
 */
export async function POST(request: Request) {
  const body = await readJson(request, runInputSchema);
  if (body.response) return body.response;
  try {
    return await enqueueResponse({ input: body.data });
  } catch (error) {
    return serverError("start run", error, "The search could not start. Try again in a moment.");
  }
}

/** GET /api/mvp/runs?limit=10 — most recent runs first. */
export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 10);
  try {
    const runs = await listRecentRuns(Number.isFinite(limit) ? limit : 10);
    return NextResponse.json({ runs }, { headers: NO_STORE });
  } catch (error) {
    return serverError("list runs", error);
  }
}
