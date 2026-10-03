import { NextResponse } from "next/server";
import { z } from "zod";
import { generateDraft } from "@/mvp/drafts";
import { leadExists } from "@/mvp/repo";
import { getOpportunity } from "@/mvp/opportunities";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../_shared/http";

const draftSchema = z.object({
  leadId: uuidSchema,
  personId: uuidSchema.nullable().default(null),
  templateOnly: z.boolean().optional(),
  demoContact: z.boolean().optional(),
  demoContactTitle: z.string().trim().max(120).optional(),
  opportunityId: uuidSchema.optional(),
}).strict();

/**
 * POST /api/mvp/drafts — { leadId, personId|null } → 201 { id, subject, body, blockedReason? }.
 * When the contact's country needs consent first, no text is generated and `blockedReason` says why.
 */
export async function POST(request: Request) {
  const body = await readJson(request, draftSchema);
  if (body.response) return body.response;
  try {
    if (!(await leadExists(body.data.leadId))) return jsonError(404, "Lead not found.");
    if (body.data.opportunityId) {
      const opportunity = await getOpportunity(body.data.opportunityId);
      if (!opportunity || opportunity.lead_id !== body.data.leadId) return jsonError(400, "Opportunity does not belong to this lead.");
      if (opportunity.qualification !== "approved") return jsonError(409, "Review buyer fit before preparing outreach.");
    }
    const draft = await generateDraft(body.data.leadId, body.data.personId, body.data);
    return NextResponse.json(draft, { status: 201, headers: NO_STORE });
  } catch (error) {
    return serverError("generate draft", error, "The draft could not be written. Try again in a moment.");
  }
}
