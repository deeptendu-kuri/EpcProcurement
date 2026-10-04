/** Server-side Hunter adapter. Discovery is NOT verification or proof of employment. */
import { z } from "zod";

export class EnrichmentError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "EnrichmentError"; }
}
export function hunterConfigured(): boolean {
  const key = process.env.HUNTER_API_KEY?.trim();
  return Boolean(key && key !== "test-api-key");
}
export function companyDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/^www\./, "");
  if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    || /\.(?:local|localhost|internal|test|invalid|example)$/.test(domain) || domain === "example.com")
    throw new EnrichmentError(400, "Enter the company's actual public website domain, without https:// or a path.");
  return domain;
}
const emailSchema = z.email();
const sourceSchema = z.object({ uri: z.string() }).passthrough();
const candidateSchema = z.object({
  value: emailSchema, type: z.string(), first_name: z.string().nullable(), last_name: z.string().nullable(),
  position: z.string().nullable(), sources: z.array(sourceSchema).default([]),
}).passthrough();
const domainSchema = z.object({ domain: z.string(), emails: z.array(candidateSchema) }).passthrough();
const verifierSchema = z.object({
  email: emailSchema, status: z.string(), regexp: z.boolean(), gibberish: z.boolean(), disposable: z.boolean(),
  webmail: z.boolean(), mx_records: z.boolean(), smtp_server: z.boolean(), smtp_check: z.boolean(),
  accept_all: z.boolean(), block: z.boolean(),
}).passthrough();
export interface HunterCandidate { email: string; name: string; title: string; sources: string[] }
export interface HunterVerification { email: string; status: string; deliverable: boolean; checkedAt: string }
const GENERIC = /^(?:info|contact|sales|support|admin|office|hello|enquir(?:y|ies)|procurement|purchase|purchasing|noreply|no-reply)$/i;
export function namedEmail(email: string, domain: string): boolean {
  if (!emailSchema.safeParse(email).success) return false;
  const [local, host] = email.toLowerCase().split("@");
  return host === domain && !GENERIC.test(local);
}
async function request(endpoint: string, params: Record<string, string>): Promise<unknown> {
  if (!hunterConfigured()) throw new EnrichmentError(503, "Set a real HUNTER_API_KEY in the server's ignored environment file. Test keys cannot validate contacts.");
  const url = new URL(`https://api.hunter.io/v2/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, { headers: { "X-API-KEY": process.env.HUNTER_API_KEY!.trim() },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch { throw new EnrichmentError(502, "Hunter could not be reached. No contact was marked verified."); }
  if (!response.ok) {
    const message = response.status === 401 ? "Hunter rejected the API key. Check its configuration."
      : [403, 429].includes(response.status) ? "Hunter rate limit or account quota reached. No automatic retry was made."
      : response.status === 451 ? "Hunter cannot process this contact due to a legal restriction."
      : "Hunter request failed. No contact was marked verified.";
    throw new EnrichmentError([403, 429].includes(response.status) ? 429 : 502, message);
  }
  try {
    const envelope = z.object({ data: z.unknown() }).parse(await response.json());
    return envelope.data;
  } catch { throw new EnrichmentError(502, "Hunter returned an unreadable response. No contact was marked verified."); }
}
export async function searchHunter(domainInput: string): Promise<HunterCandidate[]> {
  const domain = companyDomain(domainInput);
  const parsed = domainSchema.safeParse(await request("domain-search", { domain, limit: "5", type: "personal" }));
  if (!parsed.success || parsed.data.domain.toLowerCase() !== domain)
    throw new EnrichmentError(502, "Hunter returned an unexpected company response; no contacts were imported.");
  return parsed.data.emails.flatMap(c => {
    const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
    if (c.type !== "personal" || !c.first_name?.trim() || !c.last_name?.trim() || !c.position?.trim() || !namedEmail(c.value, domain)) return [];
    const sources = c.sources.map(s => s.uri).filter(uri => /^https?:\/\//i.test(uri));
    return [{ email: c.value.toLowerCase(), name, title: c.position, sources }];
  }).slice(0, 5);
}
export async function findHunterEmail(domainInput: string, name: string): Promise<string | null> {
  const domain = companyDomain(domainInput);
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) throw new EnrichmentError(409, "A first and last name are needed. We won't guess a person's identity.");
  const result = z.object({ email: emailSchema.nullable(), domain: z.string().optional(),
    first_name: z.string().optional(), last_name: z.string().optional() }).passthrough().safeParse(
    await request("email-finder", { domain, first_name: parts[0], last_name: parts.slice(1).join(" ") }));
  if (!result.success) throw new EnrichmentError(502, "Hunter returned an unexpected finder response.");
  if (!result.data.email) return null;
  if (!namedEmail(result.data.email, domain) || result.data.first_name?.toLowerCase() !== parts[0].toLowerCase()
    || result.data.last_name?.toLowerCase() !== parts.slice(1).join(" ").toLowerCase())
    throw new EnrichmentError(502, "Hunter returned an email for a different identity or domain; it was not saved.");
  return result.data.email.toLowerCase();
}
export async function verifyHunterEmail(email: string, domainInput: string): Promise<HunterVerification> {
  const domain = companyDomain(domainInput);
  if (!namedEmail(email, domain)) throw new EnrichmentError(409, "Only a named business contact on the confirmed company domain can be validated here.");
  const result = verifierSchema.safeParse(await request("email-verifier", { email }));
  if (!result.success || result.data.email.toLowerCase() !== email.toLowerCase())
    throw new EnrichmentError(502, "Hunter returned an incomplete or mismatched verification. No contact was marked verified.");
  const v = result.data;
  return { email: email.toLowerCase(), status: v.status, checkedAt: new Date().toISOString(), deliverable: v.status === "valid" && v.regexp
    && !v.gibberish && !v.disposable && !v.webmail && v.mx_records && v.smtp_server && v.smtp_check && !v.accept_all && !v.block };
}
