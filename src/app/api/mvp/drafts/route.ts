import { NextResponse } from "next/server";
import { z } from "zod";
import { generateDraft } from "@/mvp/drafts";
import { leadExists } from "@/mvp/repo";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../_shared/http";

const draftSchema = z.object({
  leadId: uuidSchema,
  personId: uuidSchema.nullable().default(null),
});

/**
 * POST /api/mvp/drafts — { leadId, personId|null } → 201 { id, subject, body, blockedReason? }.
 * When the contact's country needs consent first, no text is generated and `blockedReason` says why.
 */
export async function POST(request: Request) {
  const body = await readJson(request, draftSchema);
  if (body.response) return body.response;
  try {
    if (!(await leadExists(body.data.leadId))) return jsonError(404, "Lead not found.");
    const draft = await generateDraft(body.data.leadId, body.data.personId);
    return NextResponse.json(draft, { status: 201, headers: NO_STORE });
  } catch (error) {
    return serverError("generate draft", error, "The draft could not be written. Try again in a moment.");
  }
}
