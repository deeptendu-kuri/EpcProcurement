import { NextResponse } from "next/server";
import { z } from "zod";
import { addContact } from "@/mvp/buyers";
import { chainFailure } from "../_shared/chain";
import { NO_STORE, readJson, uuidSchema } from "../_shared/http";

const blankToUndefined = (v: string | undefined) => (v ? v : undefined);
const bodySchema = z
  .object({
    companyId: uuidSchema,
    slotId: z.string().trim().min(1).max(60),
    name: z.string().trim().min(2).max(160),
    title: z.string().trim().max(160).default(""),
    email: z.union([z.literal(""), z.string().trim().email().max(200)]).optional().transform(blankToUndefined),
    phone: z.string().trim().max(60).optional().transform(blankToUndefined),
    linkedinUrl: z.union([z.literal(""), z.string().trim().url().max(300)]).optional().transform(blankToUndefined),
    notes: z.string().trim().max(2000).optional().transform(blankToUndefined),
    // Sent by the UI for context (may be a derived: id); not needed to store the person.
    leadId: z.string().max(260).optional(),
  })
  .strict();

function withoutLead<T extends { leadId?: string }>(data: T): Omit<T, "leadId"> {
  const { leadId: _leadId, ...rest } = data;
  void _leadId;
  return rest;
}

/**
 * POST /api/mvp/contacts  { companyId, slotId, name, title, email?, phone?, linkedinUrl?, notes? }
 * → 201 { personId } — a person (source manual, status Likely) plus contact points (docs/mvp/15 §E).
 */
export async function POST(request: Request) {
  const body = await readJson(request, bodySchema);
  if (body.response) return body.response;
  try {
    return NextResponse.json(await addContact(withoutLead(body.data)), { status: 201, headers: NO_STORE });
  } catch (error) {
    return chainFailure("add contact", error);
  }
}
