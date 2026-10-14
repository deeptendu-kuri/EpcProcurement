import { NextResponse } from "next/server";
import { z } from "zod";
import { addOurProduct, listOurProducts } from "@/mvp/products/our-products";
import { NO_STORE, jsonError, readJson, serverError } from "../_shared/http";

const createSchema = z.object({ name: z.string().trim().min(2, "Type a product name.").max(80) }).strict();

/** GET /api/mvp/products — { products } (his own products; shortcuts and email context, never a search filter). */
export async function GET() {
  try {
    return NextResponse.json({ products: await listOurProducts() }, { headers: NO_STORE });
  } catch (error) {
    return serverError("list products", error);
  }
}

/** POST /api/mvp/products — { name } → 201 { product }. */
export async function POST(request: Request) {
  const body = await readJson(request, createSchema);
  if (body.response) return body.response;
  try {
    return NextResponse.json({ product: await addOurProduct(body.data.name) }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof RangeError) return jsonError(422, error.message);
    return serverError("add product", error, "The product could not be saved. Try again.");
  }
}
