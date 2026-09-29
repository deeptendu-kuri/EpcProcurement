import { NextResponse } from "next/server";
import { getSupplyChain } from "@/mvp/buyers";
import { chainFailure, chainLeadId, expandParam } from "../../_shared/chain";
import { NO_STORE, jsonError } from "../../_shared/http";

type Ctx = { params: Promise<{ leadId: string }> };

/**
 * GET /api/mvp/chain/[leadId]?expand=all|<nodeId,…> → SupplyChain (docs/mvp/15 §B)
 * Tier 1 = this buyer; tier 2 = its supplier types; tier 3 = expanded tier-2 nodes (default: the
 * identified ones). Each node has its link status, reason, evidence ids and up to 5 candidates.
 */
export async function GET(request: Request, { params }: Ctx) {
  const leadId = chainLeadId((await params).leadId);
  if (!leadId) return jsonError(404, "Buyer not found.");
  try {
    const chain = await getSupplyChain(leadId, { expand: expandParam(request.url) });
    if (!chain) return jsonError(404, "Buyer not found.");
    return NextResponse.json(chain, { headers: NO_STORE });
  } catch (error) {
    return chainFailure("get supply chain", error);
  }
}
