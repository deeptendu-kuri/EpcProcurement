import { NextResponse } from "next/server";
import { getChainContacts } from "@/mvp/buyers";
import { chainFailure, chainLeadId, expandParam } from "../../../_shared/chain";
import { NO_STORE, jsonError } from "../../../_shared/http";

type Ctx = { params: Promise<{ leadId: string }> };

/**
 * GET /api/mvp/chain/[leadId]/contacts?expand=… → ChainContactRow[] (docs/mvp/15 §E)
 * Every node × buying-team slot across tiers: named people (with email / phone / LinkedIn when
 * known), empty slots (Not found + Find links), and "Company first" rows for unidentified nodes.
 */
export async function GET(request: Request, { params }: Ctx) {
  const leadId = chainLeadId((await params).leadId);
  if (!leadId) return jsonError(404, "Buyer not found.");
  try {
    const rows = await getChainContacts(leadId, { expand: expandParam(request.url) });
    if (!rows) return jsonError(404, "Buyer not found.");
    return NextResponse.json(rows, { headers: NO_STORE });
  } catch (error) {
    return chainFailure("get chain contacts", error);
  }
}
