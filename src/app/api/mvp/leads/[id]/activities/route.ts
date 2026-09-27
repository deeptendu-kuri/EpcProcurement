import { NextResponse } from "next/server";
import { z } from "zod";
import { addActivity, isUuid, leadExists } from "@/mvp/repo";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../../../_shared/http";

const activitySchema = z.object({
  type: z.enum(["note", "call", "meeting"]).default("note"),
  body: z.string().trim().min(1, "Write something first.").max(4000),
  personId: uuidSchema.nullable().optional(),
});

/** POST /api/mvp/leads/[id]/activities — add a note (or a call / meeting log) → 201 { activity }. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Lead not found.");
  const body = await readJson(request, activitySchema);
  if (body.response) return body.response;
  try {
    if (!(await leadExists(id))) return jsonError(404, "Lead not found.");
    const activity = await addActivity({ leadId: id, type: body.data.type, body: body.data.body, personId: body.data.personId ?? null });
    return NextResponse.json({ activity }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return serverError("add activity", error);
  }
}
