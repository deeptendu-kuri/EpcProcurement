import { NextResponse } from "next/server";
import { z } from "zod";
import { controlCampaign } from "@/mvp/email/campaigns";
import { DemoSendError } from "@/mvp/email/send";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../../../_shared/http";
import { rejectCrossOrigin } from "../../_origin";

export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Campaign not found.");
  const parsed = await readJson(request, z.object({ action: z.enum(["pause", "resume", "cancel"]) }).strict());
  if (parsed.response) return parsed.response;
  try { await controlCampaign(id, parsed.data.action); return NextResponse.json({ ok: true }, { headers: NO_STORE }); }
  catch (e) {
    if (e instanceof DemoSendError) return jsonError(e.status, e.message);
    return serverError("control outreach campaign", e);
  }
}
