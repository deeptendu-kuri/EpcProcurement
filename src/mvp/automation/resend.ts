import { z } from "zod";
import { AUTOMATION_RECIPIENT, receivingDomain, requireFunnelConfig } from "./config";
import { messageIdSafe } from "./policy";
import { paceResend } from "@/mvp/email/pacing";

export const receivedSchema = z.object({ id:z.uuid(),from:z.string(),to:z.array(z.string()),subject:z.string(),created_at:z.string(),
  text:z.string().nullable().optional(),html:z.string().nullable().optional(),headers:z.record(z.string(),z.string()).optional(),message_id:z.string().optional(),
  authentication:z.object({dmarc:z.string(),dkim:z.string(),spf:z.string()}).nullable().optional() }).passthrough();
export type ReceivedEmail = z.infer<typeof receivedSchema>;
async function request(path: string,options: RequestInit={}) {
  const key=process.env.RESEND_API_KEY?.trim(); if (!key) throw new Error("Resend is not connected.");
  await paceResend();
  const res=await fetch(`https://api.resend.com/${path}`,{...options,redirect:"error",headers:{authorization:`Bearer ${key}`,"content-type":"application/json",...options.headers},signal:AbortSignal.timeout(20_000)});
  const json=await res.json().catch(()=>null);
  if (!res.ok) throw new Error(`Resend request failed (HTTP ${res.status}). Receiving requires a key with read/full-access permissions; check permissions and quota.`);
  return json;
}
/** Only the managed receiving API is read; Gmail password/IMAP access is not needed. */
export async function listInboxPage(after?: string): Promise<{ data: ReceivedEmail[];has_more:boolean }> {
  const data=await request(`emails/receiving?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
  return z.object({data:z.array(receivedSchema),has_more:z.boolean()}).parse(data);
}
export async function readInbound(id: string): Promise<ReceivedEmail> {
  return receivedSchema.parse(await request(`emails/receiving/${z.uuid().parse(id)}`));
}
export function approvedIncoming(email: ReceivedEmail): boolean {
  const address=email.from.match(/<([^<>]+)>$/)?.[1] ?? email.from;
  // Authentication comes from Resend's receiving server, not forgeable email headers.
  return address.trim().toLowerCase()===AUTOMATION_RECIPIENT && email.authentication?.dmarc==="pass";
}
export function replyAddress(token: string): string {
  if (!/^[a-f0-9]{48}$/.test(token)) throw new Error("Invalid conversation token.");
  return `lead-${token}@${receivingDomain()}`;
}
export async function sendFunnelMessage(message: { id:string;subject:string;body:string;reply_to:string;in_reply_to:string|null }): Promise<{id:string;rfcId:string|null}> {
  const settings=requireFunnelConfig();
  if (!/^lead-[a-f0-9]{48}@/.test(message.reply_to) || !message.reply_to.endsWith(`@${receivingDomain()}`)) throw new Error("Conversation receiving domain changed; review before sending.");
  const previous=messageIdSafe(message.in_reply_to);
  const data=await request("emails",{method:"POST",headers:{"Idempotency-Key":`funnel-${message.id}`},body:JSON.stringify({
    from:settings.from,to:[AUTOMATION_RECIPIENT],reply_to:message.reply_to,
    subject:message.subject.replace(/[\r\n]/g," ").slice(0,180),text:message.body,
    ...(previous ? {headers:{"In-Reply-To":previous,References:previous}} : {}),
  })});
  if (typeof data?.id!=="string") throw new Error("Resend acceptance could not be confirmed.");
  // The provider resource ID is not an RFC Message-ID; never use it in In-Reply-To.
  return {id:data.id,rfcId:null};
}
