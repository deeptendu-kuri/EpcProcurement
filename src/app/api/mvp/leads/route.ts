import { NextResponse } from "next/server";
import { leadFacets, listLeads } from "@/mvp/repo";
import { NO_STORE, serverError } from "../_shared/http";
import { parseLeadQuery } from "./filter";

/**
 * GET /api/mvp/leads?tab=&q=&category=&market=&kind=&stage=&status=&added=&conf=&min=&product=&source=&sort=&page=&size=&run=
 * → { items, counts, total } (+ `facets` when `facets=1`). `status` defaults to open leads, `sort` to latest.
 */
export async function GET(request: Request) {
  const { filter } = parseLeadQuery(request.url);
  const withFacets = new URL(request.url).searchParams.get("facets") === "1";
  try {
    const [result, facets] = await Promise.all([listLeads(filter), withFacets ? leadFacets(filter) : Promise.resolve(undefined)]);
    return NextResponse.json(facets ? { ...result, facets } : result, { headers: NO_STORE });
  } catch (error) {
    return serverError("list leads", error);
  }
}
