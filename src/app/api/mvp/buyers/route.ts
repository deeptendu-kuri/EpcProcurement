import { NextResponse } from "next/server";
import { parseBuyerSearch, searchBuyers, searchFromUrl } from "@/mvp/buyers";
import { NO_STORE, jsonError, serverError } from "../_shared/http";

/**
 * GET  /api/mvp/buyers?s=<BuyerSearch as JSON>&page=&size=&sort=&q=
 * POST /api/mvp/buyers   body: BuyerSearch
 * → { rows: BuyerRow[], total, facets, contactsFound, contactsTotal, page, pageSize } (docs/mvp/14 §9).
 */
export async function GET(request: Request) {
  const parsed = searchFromUrl(request.url);
  if (!parsed.ok) return jsonError(400, parsed.error);
  try {
    return NextResponse.json(await searchBuyers(parsed.search), { headers: NO_STORE });
  } catch (error) {
    return serverError("search buyers", error);
  }
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "Body must be JSON.");
  }
  const parsed = parseBuyerSearch(raw);
  if (!parsed.ok) return jsonError(400, parsed.error, parsed.issues);
  try {
    return NextResponse.json(await searchBuyers(parsed.search), { headers: NO_STORE });
  } catch (error) {
    return serverError("search buyers", error);
  }
}
