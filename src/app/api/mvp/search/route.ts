import { NextResponse } from "next/server";
import { listLeads } from "@/mvp/repo";
import { NO_STORE, serverError } from "../_shared/http";

/**
 * GET /api/mvp/search?q= — global search in the top bar: up to 8 leads whose company, project,
 * package or product matches → { results: [{ id, buyerName, projectName, country, score, class }] }.
 */
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ results: [] }, { headers: NO_STORE });
  try {
    const { items } = await listLeads({ q, status: "all", sort: "score", limit: 8 });
    const results = items.map((item) => ({
      id: item.id,
      buyerName: item.buyerName,
      projectName: item.projectName,
      country: item.projectCountry ?? item.buyerCountry,
      score: item.score,
      class: item.class,
    }));
    return NextResponse.json({ results }, { headers: NO_STORE });
  } catch (error) {
    return serverError("search", error);
  }
}
