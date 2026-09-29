import { NextResponse } from "next/server";
import { z } from "zod";
import { deriveBuyer, getBuyerView } from "@/mvp/buyers";
import { chainFailure } from "../../_shared/chain";
import { NO_STORE, readJson } from "../../_shared/http";

const bodySchema = z.object({ derivedKey: z.string().trim().min(10).max(200) }).strict();

/**
 * POST /api/mvp/buyers/derive  { derivedKey } → { leadId, created, view: BuyerView }
 * Materialises a derived (tier 2/3) buyer as a lead — kind supply_subcontract, class research — so
 * Save as buyer / Good lead / Add to list work on it (docs/mvp/15 §D). `derivedKey` is BuyerRow.derivedKey
 * (a `derived:` prefix is accepted). Reuses an existing lead of that company on the same project.
 */
export async function POST(request: Request) {
  const body = await readJson(request, bodySchema);
  if (body.response) return body.response;
  try {
    const { leadId, created } = await deriveBuyer(body.data.derivedKey);
    return NextResponse.json({ leadId, created, view: await getBuyerView(leadId) }, { status: created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    return chainFailure("derive buyer", error);
  }
}
