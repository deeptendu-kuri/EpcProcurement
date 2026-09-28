import { NextResponse } from "next/server";
import { z } from "zod";
import { createLeadList, listLeadLists } from "@/mvp/buyers";
import { NO_STORE, readJson, serverError, uuidSchema } from "../_shared/http";

/** GET /api/mvp/lists → { lists: LeadList[] } (docs/mvp/14 §10 Lead Lists). */
export async function GET() {
  try {
    return NextResponse.json({ lists: await listLeadLists() }, { headers: NO_STORE });
  } catch (error) {
    return serverError("list lead lists", error);
  }
}

const createSchema = z
  .object({
    name: z.string().trim().min(1, "Name the list.").max(120),
    leadIds: z.array(uuidSchema).max(2000).optional(),
  })
  .strict();

/** POST /api/mvp/lists  { name, leadIds? } → 201 { list } */
export async function POST(request: Request) {
  const body = await readJson(request, createSchema);
  if (body.response) return body.response;
  try {
    const list = await createLeadList(body.data.name, body.data.leadIds ?? []);
    return NextResponse.json({ list }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return serverError("create lead list", error);
  }
}
