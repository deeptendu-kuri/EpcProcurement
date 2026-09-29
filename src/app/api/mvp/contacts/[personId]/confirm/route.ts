import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmPerson } from "@/mvp/buyers";
import { chainFailure } from "../../../_shared/chain";
import { NO_STORE, jsonError, uuidSchema } from "../../../_shared/http";

type Ctx = { params: Promise<{ personId: string }> };

// The UI also sends companyId, and leadId may be a `derived:` id (no stored lead yet) — ignored then.
const bodySchema = z
  .object({
    leadId: z.string().max(260).optional(),
    slotId: z.string().trim().min(1).max(60).optional(),
    companyId: z.string().max(80).nullable().optional(),
  })
  .strict();

/**
 * POST /api/mvp/contacts/[personId]/confirm  { leadId?, slotId? } → { ok: true }
 * Confirm decision maker (docs/mvp/15 §E): the person becomes Confirmed; logged as an activity on the
 * given lead, else the newest lead of their company. The body is optional.
 */
export async function POST(request: Request, { params }: Ctx) {
  const { personId } = await params;
  if (!uuidSchema.safeParse(personId).success) return jsonError(404, "Person not found.");
  let raw: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return jsonError(400, "Body must be JSON.");
    }
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request.", parsed.error.issues);
  try {
    const { leadId, slotId } = parsed.data;
    const ok = await confirmPerson(personId, { leadId: leadId && uuidSchema.safeParse(leadId).success ? leadId : undefined, slotId });
    if (!ok) return jsonError(404, "Person not found.");
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return chainFailure("confirm contact", error);
  }
}
