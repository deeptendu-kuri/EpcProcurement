/** Server-only live verification with durable caching and a small daily request budget. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/mvp/db";
import { EnrichmentError, companyDomain, namedEmail, type HunterVerification } from "./hunter";

export function emailableConfigured() { return /^live_[A-Za-z0-9_-]+$/.test(process.env.EMAILABLE_API_KEY?.trim() || ""); }
const schema = z.object({ email: z.email(), state: z.enum(["deliverable","undeliverable","risky","unknown"]),
  accept_all: z.boolean().nullable(), disposable: z.boolean(), role: z.boolean(), no_reply: z.boolean(),
  mailbox_full: z.boolean(), mx_record: z.string().nullable() }).passthrough();
export async function verifyEmailableEmail(email: string, domainInput: string): Promise<HunterVerification> {
  const domain = companyDomain(domainInput);
  if (!namedEmail(email, domain)) throw new EnrichmentError(409, "Only a named address on the confirmed company domain can authorize buyer outreach.");
  if (!emailableConfigured()) throw new EnrichmentError(503, "Configure a private live Emailable key; test keys cannot validate real contacts.");
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const db = getDb();
  const job = await db.tx(async tx => {
    await tx.query("select pg_advisory_xact_lock(78240324)");
    const prior = (await tx.query<{status:string;result:HunterVerification}>("select status,result from contact_verification_requests where provider='emailable' and email_hash=$1 and expires_at>now() order by created_at desc limit 1", [hash])).rows[0];
    if (prior?.status === "completed") return { cached: true as const, result: prior.result };
    if (prior) throw new EnrichmentError(429, "This verification is already running or recently failed. Wait before retrying.");
    const limit = Math.max(1, Math.min(10, Number(process.env.EMAILABLE_DAILY_REQUEST_LIMIT) || 2));
    const used = (await tx.query<{count:number}>("select count(*)::int as count from contact_verification_requests where created_at>=date_trunc('day',now())")).rows[0].count;
    if (used >= limit) throw new EnrichmentError(429, `Emailable demo budget reached (${limit} requests/day). No verification credit was spent.`);
    const row = (await tx.query<{id:string}>("insert into contact_verification_requests(provider,email_hash,status,expires_at) values('emailable',$1,'running',now()+interval '5 minutes') returning id", [hash])).rows[0];
    return { cached: false as const, id: row.id };
  });
  if (job.cached) return job.result;
  try {
    const url = new URL("https://api.emailable.com/v1/verify");
    url.search = new URLSearchParams({email:email.toLowerCase(),smtp:"true",accept_all:"true",timeout:"10"}).toString();
    const response = await fetch(url, { headers:{authorization:`Bearer ${process.env.EMAILABLE_API_KEY!.trim()}`}, redirect:"error", cache:"no-store", signal:AbortSignal.timeout(20_000) });
    if (!response.ok) throw new EnrichmentError(response.status===429?429:502, `Emailable verification did not complete (HTTP ${response.status}). No contact was validated; no automatic credit-consuming retry.`);
    const v = schema.parse(await response.json());
    if (v.email.toLowerCase() !== email.toLowerCase()) throw new Error("Mismatched address");
    const result = {email:email.toLowerCase(),checkedAt:new Date().toISOString(),status:v.state,
      deliverable:v.state==="deliverable" && v.accept_all===false && !v.disposable && !v.role && !v.no_reply && !v.mailbox_full && Boolean(v.mx_record)};
    await db.query("update contact_verification_requests set status='completed',result=$2::jsonb,expires_at=now()+interval '1 day' where id=$1",[job.id,JSON.stringify(result)]);
    return result;
  } catch (e) {
    await db.query("update contact_verification_requests set status='failed',expires_at=now()+interval '5 minutes' where id=$1",[job.id]);
    throw e instanceof EnrichmentError ? e : new EnrichmentError(502,"Emailable returned an unavailable, incomplete or mismatched result. No contact was validated.");
  }
}
