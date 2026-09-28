import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteLeadList, getLeadListWithRows, renameLeadList } from "@/mvp/buyers";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../../_shared/http";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/mvp/lists/[id] → { list: LeadList & { leadIds, rows: BuyerRow[] } } */
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "List not found.");
  try {
    const list = await getLeadListWithRows(id);
    if (!list) return jsonError(404, "List not found.");
    return NextResponse.json({ list }, { headers: NO_STORE });
  } catch (error) {
    return serverError("get lead list", error);
  }
}

const patchSchema = z.object({ name: z.string().trim().min(1, "Name the list.").max(120) }).strict();

/** PATCH /api/mvp/lists/[id]  { name } → { list } */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "List not found.");
  const body = await readJson(request, patchSchema);
  if (body.response) return body.response;
  try {
    const list = await renameLeadList(id, body.data.name);
    if (!list) return jsonError(404, "List not found.");
    return NextResponse.json({ list }, { headers: NO_STORE });
  } catch (error) {
    return serverError("rename lead list", error);
  }
}

/** DELETE /api/mvp/lists/[id] → { ok: true } */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "List not found.");
  try {
    if (!(await deleteLeadList(id))) return jsonError(404, "List not found.");
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return serverError("delete lead list", error);
  }
}
