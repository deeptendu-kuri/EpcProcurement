import { NextResponse } from "next/server";
import { z } from "zod";
import { removeNodeCompany, setNodeCompany } from "@/mvp/buyers";
import { chainFailure, chainLeadId } from "../../../../../_shared/chain";
import { NO_STORE, jsonError, readJson } from "../../../../../_shared/http";

type Ctx = { params: Promise<{ leadId: string; nodeId: string }> };

// companyId is sent by the UI when a candidate is picked ("Use this"); the name is authoritative.
const bodySchema = z.object({ name: z.string().trim().min(2).max(200), companyId: z.string().max(80).optional() }).strict();

/**
 * POST /api/mvp/chain/[leadId]/nodes/[nodeId]/company  { name } → SupplyChain
 * Sets the company of a node by name (creates or links the company); the link becomes confirmed with
 * source "your team" (docs/mvp/15 §B). 409 when the node's parent has no company yet.
 */
export async function POST(request: Request, { params }: Ctx) {
  const { leadId: rawLead, nodeId: rawNode } = await params;
  const leadId = chainLeadId(rawLead);
  if (!leadId) return jsonError(404, "Buyer not found.");
  const body = await readJson(request, bodySchema);
  if (body.response) return body.response;
  try {
    return NextResponse.json(await setNodeCompany(leadId, decodeURIComponent(rawNode), body.data.name), { headers: NO_STORE });
  } catch (error) {
    return chainFailure("set node company", error);
  }
}

/** DELETE /api/mvp/chain/[leadId]/nodes/[nodeId]/company → SupplyChain: removes a wrong company. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { leadId: rawLead, nodeId: rawNode } = await params;
  const leadId = chainLeadId(rawLead);
  if (!leadId) return jsonError(404, "Buyer not found.");
  try {
    return NextResponse.json(await removeNodeCompany(leadId, decodeURIComponent(rawNode)), { headers: NO_STORE });
  } catch (error) {
    return chainFailure("remove node company", error);
  }
}
