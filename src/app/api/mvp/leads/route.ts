import { NextResponse } from "next/server";
import { listLeads } from "@/mvp/repo";
import { NO_STORE, jsonError, serverError } from "../_shared/http";
import { parseLeadQuery } from "./filter";

/**
 * GET /api/mvp/leads?class=&market=&product=&kind=&status=&run=&limit=&offset=
 * → { items, counts }, sorted by score then newest. `status` defaults to "open".
 */
export async function GET(request: Request) {
  const parsed = parseLeadQuery(request.url);
  if ("error" in parsed) return jsonError(400, parsed.error);
  try {
    return NextResponse.json(await listLeads(parsed.filter), { headers: NO_STORE });
  } catch (error) {
    return serverError("list leads", error);
  }
}
