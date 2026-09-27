import { NextResponse } from "next/server";
import { listBuyerOpportunities } from "@/modules/dashboard/repository";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const minScore = url.searchParams.get("minScore");

  const opportunities = await listBuyerOpportunities({
    query: url.searchParams.get("q") ?? undefined,
    country: url.searchParams.get("country") ?? undefined,
    confidence: url.searchParams.get("confidence") ?? undefined,
    minScore: minScore ? Number(minScore) : undefined,
  });

  return NextResponse.json({ opportunities });
}
