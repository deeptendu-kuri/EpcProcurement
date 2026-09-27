import { NextResponse } from "next/server";
import { z } from "zod";
import { startRun } from "@/mvp/pipeline";
import { listRecentRuns } from "@/mvp/repo";
import { MARKET_CODES } from "@/mvp/types";
import { NO_STORE, readJson, serverError } from "../_shared/http";

const runInputSchema = z.object({
  query: z.string().trim().min(2, "Type what you offer.").max(200),
  markets: z
    .array(z.string().trim().toUpperCase().pipe(z.enum(MARKET_CODES)))
    .min(1, "Pick at least one market.")
    .max(MARKET_CODES.length)
    .transform((markets) => [...new Set(markets)]),
  leadKinds: z
    .array(z.enum(["bid", "supply_subcontract"]))
    .min(1, "Pick a lead type.")
    .transform((kinds) => [...new Set(kinds)]),
});

/** POST /api/mvp/runs — start a "Search now" run. Body: { query, markets[], leadKinds[] } → 202 { runId }. */
export async function POST(request: Request) {
  const body = await readJson(request, runInputSchema);
  if (body.response) return body.response;
  try {
    const runId = await startRun(body.data);
    return NextResponse.json({ runId }, { status: 202, headers: NO_STORE });
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
