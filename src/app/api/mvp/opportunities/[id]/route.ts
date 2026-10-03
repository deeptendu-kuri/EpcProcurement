import { NextResponse } from "next/server";
import { z } from "zod";
import { updateOpportunity } from "@/mvp/opportunities";
import { NO_STORE, readJson, serverError, jsonError, uuidSchema } from "../../_shared/http";
const patchSchema = z.object({
  qualification: z.enum(["pending", "approved", "rejected"]).optional(),
  summary: z.string().trim().max(4000).optional(),
  ownerName: z.string().trim().max(120).optional(),
  nextAction: z.string().trim().max(300).optional(),
  followUpAt: z.iso.datetime().nullable().optional(),
}).strict();
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(400, "Invalid opportunity id.");
  const body = await readJson(request, patchSchema);
  if (body.response) return body.response;
  try {
    const opportunity = await updateOpportunity(id, body.data);
    return opportunity ? NextResponse.json({ opportunity }, { headers: NO_STORE }) : jsonError(404, "Opportunity not found.");
  } catch (error) { return serverError("update opportunity", error); }
}
