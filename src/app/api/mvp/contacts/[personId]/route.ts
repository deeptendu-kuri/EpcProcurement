import { NextResponse } from "next/server";
import { deleteManualContact } from "@/mvp/buyers";
import { chainFailure } from "../../_shared/chain";
import { NO_STORE, jsonError, uuidSchema } from "../../_shared/http";

type Ctx = { params: Promise<{ personId: string }> };

/** DELETE /api/mvp/contacts/[personId] → { ok: true }: removes a contact added by hand (source manual only). */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { personId } = await params;
  if (!uuidSchema.safeParse(personId).success) return jsonError(404, "Person not found.");
  try {
    const ok = await deleteManualContact(personId);
    if (!ok) return jsonError(404, "No hand-added contact with that id.");
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return chainFailure("delete contact", error);
  }
}
