import { NextResponse } from "next/server";
import { z } from "zod";
import { DraftBlockedError, updateDraft } from "@/mvp/repo";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../../_shared/http";

const patchSchema = z
  .object({
    subject: z.string().max(300).optional(),
    body: z.string().max(10_000).optional(),
    status: z.literal("sent_externally").optional(),
  })
  .strict()
  .refine((value) => value.subject !== undefined || value.body !== undefined || value.status !== undefined, "Nothing to update.");

/** PATCH /api/mvp/drafts/[id] — edit subject/body and/or mark as sent (logs an "Email sent" activity) → { draft }. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Draft not found.");
  const body = await readJson(request, patchSchema);
  if (body.response) return body.response;
  try {
    const draft = await updateDraft(id, body.data);
    if (!draft) return jsonError(404, "Draft not found.");
    return NextResponse.json({ draft }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof DraftBlockedError) return jsonError(409, error.reason);
    return serverError("update draft", error);
  }
}
