import { NextResponse } from "next/server";
import { z } from "zod";
import { enrichOpportunity, enrichmentView } from "@/mvp/enrichment";
import { EnrichmentError } from "@/mvp/enrichment/hunter";
import { NO_STORE, readJson, serverError, jsonError, uuidSchema } from "../../../_shared/http";
import { rejectCrossOrigin } from "../../../outreach/_origin";

export const runtime = "nodejs";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), domain: z.string().trim().min(3).max(253), domainConfirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("find"), personId: uuidSchema }).strict(),
  z.object({ action: z.literal("verify"), personId: uuidSchema, pointId: uuidSchema }).strict(),
  z.object({ action: z.literal("confirm_role"), personId: uuidSchema }).strict(),
]);
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(400, "Invalid opportunity id.");
  try { return NextResponse.json(await enrichmentView(id), { headers: NO_STORE }); }
  catch (error) { return error instanceof EnrichmentError ? jsonError(error.status, error.message) : serverError("get enrichment", error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOrigin(request); if (originError) return originError;
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(400, "Invalid opportunity id.");
  const body = await readJson(request, schema); if (body.response) return body.response;
  try { return NextResponse.json(await enrichOpportunity(id, body.data), { headers: NO_STORE }); }
  catch (error) { return error instanceof EnrichmentError ? jsonError(error.status, error.message) : serverError("enrich contact", error); }
}
