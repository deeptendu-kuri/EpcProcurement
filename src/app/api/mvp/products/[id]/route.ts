import { NextResponse } from "next/server";
import { removeOurProduct } from "@/mvp/products/our-products";
import { NO_STORE, jsonError, serverError, uuidSchema } from "../../_shared/http";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/mvp/products/[id] → { ok: true }. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Product not found.");
  try {
    if (!(await removeOurProduct(id))) return jsonError(404, "Product not found.");
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return serverError("remove product", error);
  }
}
