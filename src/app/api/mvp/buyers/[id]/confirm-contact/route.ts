import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmContact, getBuyerView } from "@/mvp/buyers";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../../../_shared/http";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ personId: uuidSchema, slotId: z.string().trim().min(1).max(60).optional() }).strict();

/**
 * POST /api/mvp/buyers/[leadId]/confirm-contact  { personId, slotId? } → { ok: true, view: BuyerView }
 * Marks a named person as confirmed for a buying-team slot (docs/mvp/14 §8), stored as an activity.
 */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Buyer not found.");
  const body = await readJson(request, bodySchema);
  if (body.response) return body.response;
  try {
    const ok = await confirmContact(id, body.data.personId, body.data.slotId ?? null);
    if (!ok) return jsonError(404, "Buyer or person not found.");
    return NextResponse.json({ ok: true, view: await getBuyerView(id) }, { headers: NO_STORE });
  } catch (error) {
    return serverError("confirm contact", error);
  }
}
