import { NextResponse } from "next/server";
import { getBuyerView, isDerivedLeadId } from "@/mvp/buyers";
import { NO_STORE, jsonError, serverError, uuidSchema } from "../../_shared/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/mvp/buyers/[leadId] → BuyerView (docs/mvp/14 §9, 15): the buyer sidebar / full page, with all
 * deals of the company and the supply-chain summary. `leadId` may be `derived:<key>` (a derived buyer).
 */
export async function GET(_request: Request, { params }: Ctx) {
  const leadId = decodeURIComponent((await params).id);
  if (!uuidSchema.safeParse(leadId).success && !isDerivedLeadId(leadId)) return jsonError(404, "Buyer not found.");
  try {
    const view = await getBuyerView(leadId);
    if (!view) return jsonError(404, "Buyer not found.");
    return NextResponse.json(view, { headers: NO_STORE });
  } catch (error) {
    return serverError("get buyer", error);
  }
}
