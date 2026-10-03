import { NextResponse } from "next/server";
import { z } from "zod";
import { approveCampaign, listCampaigns } from "@/mvp/email/campaigns";
import { DemoSendError } from "@/mvp/email/send";
import { rejectCrossOrigin } from "../_origin";
import { NO_STORE, jsonError, readJson, serverError, uuidSchema } from "../../_shared/http";

export const runtime = "nodejs";
const schema = z.object({ draftId: uuidSchema, subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(10_000) }).strict();
export async function GET() {
  try { return NextResponse.json(await listCampaigns(), { headers: NO_STORE }); }
  catch (e) { return serverError("list outreach campaigns", e); }
}
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const parsed = await readJson(request, schema);
  if (parsed.response) return parsed.response;
  try {
    const c = await approveCampaign(parsed.data.draftId, parsed.data);
    return NextResponse.json({ id: c.id, status: c.status, recipient: c.recipient }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof DemoSendError) return jsonError(e.status, e.message);
    return serverError("approve outreach campaign", e);
  }
}
