import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteSavedSearch, updateSavedSearch } from "@/mvp/saved-searches";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../../_shared/http";
import { refreshSchema } from "../../_shared/schemas";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    active: z.boolean().optional(),
    refreshHours: refreshSchema.optional(),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), "Nothing to update.");

/** PATCH /api/mvp/saved-searches/[id] — { active?, refreshHours?, name? } (Pause / Resume) → { savedSearch }. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Saved search not found.");
  const body = await readJson(request, patchSchema);
  if (body.response) return body.response;
  try {
    const savedSearch = await updateSavedSearch(id, body.data);
    if (!savedSearch) return jsonError(404, "Saved search not found.");
    return NextResponse.json({ savedSearch }, { headers: NO_STORE });
  } catch (error) {
    return serverError("update saved search", error);
  }
}

/** DELETE /api/mvp/saved-searches/[id] → { ok: true }. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Saved search not found.");
  try {
    if (!(await deleteSavedSearch(id))) return jsonError(404, "Saved search not found.");
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return serverError("delete saved search", error);
  }
}
