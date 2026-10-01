import { NextResponse } from "next/server";
import { z } from "zod";
import { DemoSendError, sendDemoEmail } from "@/mvp/email/send";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../../../_shared/http";

export const runtime = "nodejs";
const sendSchema = z.object({ subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(10_000) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Draft not found.");
  const body = await readJson(request, sendSchema);
  if (body.response) return body.response;
  try { return NextResponse.json(await sendDemoEmail(id, body.data), { headers: NO_STORE }); }
  catch (error) {
    if (error instanceof DemoSendError) return jsonError(error.status, error.message);
    return serverError("send demo email", error, "Delivery could not be confirmed. Retry this same draft; do not create another until you have checked the test inbox.");
  }
}
