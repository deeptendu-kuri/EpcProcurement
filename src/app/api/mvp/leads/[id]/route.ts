import { NextResponse } from "next/server";
import { z } from "zod";
import { getLeadDetail, updateLead } from "@/mvp/repo";
import { LEAD_STATUSES, REJECT_REASONS, type LeadPatch } from "@/mvp/types";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../../_shared/http";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/mvp/leads/[id] — everything the lead page shows (LeadDetail). */
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Lead not found.");
  try {
    const detail = await getLeadDetail(id);
    if (!detail) return jsonError(404, "Lead not found.");
    return NextResponse.json(detail, { headers: NO_STORE });
  } catch (error) {
    return serverError("get lead", error);
  }
}

const leadPatchSchema = z
  .object({
    status: z.enum(LEAD_STATUSES).optional(),
    rejectReason: z.enum(REJECT_REASONS).nullable().optional(),
    nextAction: z.string().trim().max(500).nullable().optional(),
    ownerUserId: z.string().trim().max(200).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), "Nothing to update.")
  .refine((body) => body.status !== "rejected" || Boolean(body.rejectReason), {
    message: "Pick a reason for rejecting.",
    path: ["rejectReason"],
  });

/** PATCH /api/mvp/leads/[id] — { status?, rejectReason?, nextAction?, ownerUserId? } → { lead }. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Lead not found.");
  const body = await readJson(request, leadPatchSchema);
  if (body.response) return body.response;

  const patch: LeadPatch = {};
  if (body.data.status !== undefined) patch.status = body.data.status;
  if (body.data.rejectReason !== undefined) patch.reject_reason = body.data.rejectReason;
  if (body.data.nextAction !== undefined) patch.next_action = body.data.nextAction || null;
  if (body.data.ownerUserId !== undefined) patch.owner_user_id = body.data.ownerUserId || null;

  try {
    const lead = await updateLead(id, patch);
    if (!lead) return jsonError(404, "Lead not found.");
    return NextResponse.json({ lead }, { headers: NO_STORE });
  } catch (error) {
    return serverError("update lead", error);
  }
}
