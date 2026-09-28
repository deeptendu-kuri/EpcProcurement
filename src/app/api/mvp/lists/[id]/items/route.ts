import { NextResponse } from "next/server";
import { z } from "zod";
import { addToLeadList, getLeadList, removeFromLeadList } from "@/mvp/buyers";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../../../_shared/http";

type Ctx = { params: Promise<{ id: string }> };

const itemsSchema = z.object({ leadIds: z.array(uuidSchema).min(1, "Pick at least one buyer.").max(2000) }).strict();

/** POST /api/mvp/lists/[id]/items  { leadIds } → { added, list } (buyers already on the list are kept once). */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "List not found.");
  const body = await readJson(request, itemsSchema);
  if (body.response) return body.response;
  try {
    if (!(await getLeadList(id))) return jsonError(404, "List not found.");
    const added = await addToLeadList(id, body.data.leadIds);
    return NextResponse.json({ added, list: await getLeadList(id) }, { headers: NO_STORE });
  } catch (error) {
    return serverError("add to lead list", error);
  }
}

/** DELETE /api/mvp/lists/[id]/items  { leadIds } → { removed, list } */
export async function DELETE(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "List not found.");
  const body = await readJson(request, itemsSchema);
  if (body.response) return body.response;
  try {
    if (!(await getLeadList(id))) return jsonError(404, "List not found.");
    const removed = await removeFromLeadList(id, body.data.leadIds);
    return NextResponse.json({ removed, list: await getLeadList(id) }, { headers: NO_STORE });
  } catch (error) {
    return serverError("remove from lead list", error);
  }
}
