import { NextResponse } from "next/server";
import { getRun } from "@/mvp/repo";
import { NO_STORE, jsonError, serverError, uuidSchema } from "../../_shared/http";

/**
 * GET /api/mvp/runs/[id]?after=<eventId> — { run } with status, counters and progress events.
 * `after` returns only newer events, for the 2 s polling on Find.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Search not found.");
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
  try {
    const run = await getRun(id, Number.isFinite(after) && after > 0 ? after : undefined);
    if (!run) return jsonError(404, "Search not found.");
    return NextResponse.json({ run }, { headers: NO_STORE });
  } catch (error) {
    return serverError("get run", error);
  }
}
