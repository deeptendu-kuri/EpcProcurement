import { NextResponse } from "next/server";
import { getBuyerView } from "@/mvp/buyers";
import { NO_STORE, jsonError, serverError, uuidSchema } from "../../_shared/http";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/mvp/buyers/[leadId] → BuyerView (docs/mvp/14 §9): the buyer sidebar / full page. */
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Buyer not found.");
  try {
    const view = await getBuyerView(id);
    if (!view) return jsonError(404, "Buyer not found.");
    return NextResponse.json(view, { headers: NO_STORE });
  } catch (error) {
    return serverError("get buyer", error);
  }
}
