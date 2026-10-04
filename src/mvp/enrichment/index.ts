/** Server-only orchestration: scoped contacts, bounded provider usage and durable audit/cache. */
import { createHash } from "node:crypto";
import { getDb, type Queryable } from "@/mvp/db";
import { getBuyerView } from "@/mvp/buyers";
import { clearChainCache } from "@/mvp/buyers/chain-db";
import { slotDefs } from "@/mvp/buyers/team";
import { companyDomain, EnrichmentError, findHunterEmail, hunterConfigured, searchHunter, verifyHunterEmail } from "./hunter";

export interface EnrichedContact {
  id: string; name: string; title: string | null; confirmed_at: string | null;
  email: string | null; point_id: string | null; verified_at: string | null;
  validation_status: string | null; validation_checked_at: string | null; source: string | null;
}
export interface EnrichmentView { configured: boolean; domain: string | null; domainConfirmed: boolean; contacts: EnrichedContact[] }
interface Context { company_id: string; lead_id: string; is_sample: boolean; domain: string | null; domain_confirmed_at: string | null }
export type EnrichmentInput = { action: "search"; domain: string; domainConfirmed: true }
  | { action: "find"; personId: string } | { action: "verify"; personId: string; pointId: string }
  | { action: "confirm_role"; personId: string };

async function context(id: string): Promise<Context> {
  const row = (await getDb().query<Context>(`select o.company_id, o.lead_id, l.is_sample, c.domain, c.domain_confirmed_at
    from search_opportunities o join leads l on l.id = o.lead_id join companies c on c.id = o.company_id where o.id = $1`, [id])).rows[0];
  if (!row) throw new EnrichmentError(404, "Opportunity not found.");
  return row;
}
export async function enrichmentView(id: string): Promise<EnrichmentView> {
  const c = await context(id);
  const rows = (await getDb().query<EnrichedContact>(`select p.id, p.full_name as name, p.title, p.confirmed_at,
    cp.value as email, cp.id as point_id, cp.verified_at, cp.validation_status, cp.validation_checked_at, cp.source
    from people p left join contact_points cp on cp.person_id = p.id and cp.kind = 'email'
    where p.current_company_id = $1 order by p.full_name, cp.created_at desc limit 100`, [c.company_id])).rows;
  return { configured: hunterConfigured(), domain: c.domain, domainConfirmed: Boolean(c.domain_confirmed_at), contacts: rows };
}
function quotaLimit() {
  const value = Number(process.env.HUNTER_DAILY_REQUEST_LIMIT ?? "5");
  return Number.isInteger(value) && value >= 1 && value <= 25 ? value : 5;
}
/** Reserve a provider request atomically across processes; never hold a transaction during HTTP. */
async function providerRequest<T>(opportunityId: string, companyId: string, action: "search" | "find" | "verify", input: string, perform: () => Promise<T>): Promise<T> {
  if (!hunterConfigured()) throw new EnrichmentError(503, "Hunter is not connected. Set HUNTER_API_KEY in the ignored server environment file.");
  const hash = createHash("sha256").update(input).digest("hex");
  const db = getDb();
  const reservation = await db.tx(async tx => {
    await tx.query("select pg_advisory_xact_lock(78240322)");
    await tx.query("update enrichment_requests set status = 'failed', error = 'Request interrupted; review before retrying.' where status = 'running' and expires_at <= now()");
    const existing = (await tx.query<{ id: string; status: string; result: T }>(`select id, status, result from enrichment_requests
      where company_id = $1 and action = $2 and input_hash = $3 and expires_at > now() order by created_at desc limit 1`, [companyId, action, hash])).rows[0];
    if (existing?.status === "completed") return { cached: true as const, result: existing.result };
    if (existing?.status === "running") throw new EnrichmentError(409, "This lookup is already running. Wait before trying again.");
    if (existing?.status === "failed") throw new EnrichmentError(429, "This lookup recently failed. Wait one minute before retrying.");
    const used = (await tx.query<{ total: number }>("select count(*)::int as total from enrichment_requests where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'")).rows[0].total;
    if (used >= quotaLimit()) throw new EnrichmentError(429, "The app's daily Hunter request cap was reached. Try tomorrow or review HUNTER_DAILY_REQUEST_LIMIT.");
    const job = (await tx.query<{ id: string }>(`insert into enrichment_requests (company_id, opportunity_id, action, input_hash)
      values ($1,$2,$3,$4) returning id`, [companyId, opportunityId, action, hash])).rows[0];
    return { cached: false as const, id: job.id };
  });
  if (reservation.cached) return reservation.result;
  try {
    const result = await perform();
    await db.query("update enrichment_requests set status = 'completed', result = $2::jsonb, expires_at = now() + interval '1 day' where id = $1 and status = 'running'", [reservation.id, JSON.stringify(result)]);
    return result;
  } catch (error) {
    const message = error instanceof EnrichmentError ? error.message : "Contact lookup failed. No verification was recorded.";
    await db.query("update enrichment_requests set status = 'failed', error = $2, expires_at = now() + interval '1 minute' where id = $1", [reservation.id, message]);
    throw error instanceof EnrichmentError ? error : new EnrichmentError(502, message);
  }
}
const ROLE_MAP: Record<string, string> = { buyer: "procurement_lead", decision_maker: "decision_maker", approver: "project_director", technical_approver: "technical_evaluator", influencer: "package_manager" };
async function event(tx: Queryable, id: string, body: string) {
  await tx.query("insert into opportunity_events (opportunity_id, body) values ($1,$2)", [id, body]);
}
async function person(companyId: string, personId: string) {
  const p = (await getDb().query<{ id: string; full_name: string; title: string | null }>("select id, full_name, title from people where id = $1 and current_company_id = $2", [personId, companyId])).rows[0];
  if (!p) throw new EnrichmentError(404, "This contact does not belong to the selected buyer.");
  return p;
}
export async function enrichOpportunity(id: string, input: EnrichmentInput): Promise<{ message: string; view: EnrichmentView }> {
  const c = await context(id);
  if (c.is_sample) throw new EnrichmentError(409, "Sample contacts cannot be looked up or validated with a real provider. Use a real search result.");
  const db = getDb();
  let message: string;
  if (input.action === "search") {
    const domain = companyDomain(input.domain);
    const buyer = await getBuyerView(c.lead_id);
    if (!buyer) throw new EnrichmentError(404, "Buyer not found.");
    const candidates = await providerRequest(id, c.company_id, "search", domain, () => searchHunter(domain));
    const defs = slotDefs(buyer.role);
    let imported = 0;
    await db.tx(async tx => {
      await tx.query("select pg_advisory_xact_lock(78240323)");
      // A domain change invalidates earlier Hunter validation, not historical manual data.
      const current = (await tx.query<{ domain: string | null }>("select domain from companies where id = $1 for update", [c.company_id])).rows[0];
      if (current.domain && current.domain !== domain) await tx.query(`update contact_points set verified_at = null, validation_status = 'domain_changed'
        where source like 'provider:hunter%' and person_id in (select id from people where current_company_id = $1)`, [c.company_id]);
      await tx.query("update companies set domain = $2, domain_confirmed_at = now() where id = $1", [c.company_id, domain]);
      for (const candidate of candidates) {
        const matches = defs.filter(d => d.match?.test(candidate.title));
        if (!matches.length) continue;
        const normalized = candidate.name.trim().replace(/\s+/g, " ").toLowerCase();
        // A same-name employee with another title is not automatically the same identity.
        const existing = (await tx.query<{ id: string }>("select id from people where current_company_id = $1 and normalized_name = $2 and lower(coalesce(title,'')) = lower($3) order by created_at limit 1", [c.company_id, normalized, candidate.title])).rows[0];
        const personId = existing?.id ?? (await tx.query<{ id: string }>(`insert into people
          (full_name, normalized_name, current_company_id, title, source, notes) values ($1,$2,$3,$4,'provider:hunter', $5) returning id`,
          [candidate.name, normalized, c.company_id, candidate.title, `Hunter discovery candidate; employment/role and email require separate checks. Sources: ${candidate.sources.join(", ")}`])).rows[0].id;
        for (const role of new Set(matches.map(d => ROLE_MAP[d.role]).filter(Boolean))) await tx.query(`insert into person_roles (person_id, company_id, buying_role)
          select $1,$2,$3 where not exists (select 1 from person_roles where person_id = $1 and company_id = $2 and buying_role = $3 and end_date is null)`, [personId, c.company_id, role]);
        await tx.query(`insert into contact_points (person_id,kind,value,source,validation_status)
          values ($1,'email',$2,'provider:hunter:discovery','not_checked') on conflict do nothing`, [personId, candidate.email]);
        imported++;
      }
      await event(tx, id, `Hunter returned ${candidates.length} named candidates; saved ${imported} matching buying-team roles for the confirmed domain. These are not validated contacts.`);
    });
    message = imported ? `${imported} relevant named contacts saved. Confirm their current role and validate the email next.` : "No named buying-team contacts found on this domain. No contacts were invented.";
  } else {
    const p = await person(c.company_id, input.personId);
    if (input.action === "confirm_role") {
      const buyer = await getBuyerView(c.lead_id);
      const matches = buyer ? slotDefs(buyer.role).filter(d => d.match?.test(p.title ?? "")) : [];
      if (!matches.length) throw new EnrichmentError(409, "No buying-team role matches this contact's title. Review the contact details first.");
      await db.tx(async tx => {
        await tx.query("update people set confirmed_at = now() where id = $1 and current_company_id = $2", [p.id, c.company_id]);
        for (const role of new Set(matches.map(d => ROLE_MAP[d.role]).filter(Boolean))) await tx.query(`insert into person_roles (person_id,company_id,buying_role)
          select $1,$2,$3 where not exists (select 1 from person_roles where person_id=$1 and company_id=$2 and buying_role=$3 and end_date is null)`, [p.id, c.company_id, role]);
        await event(tx, id, `User confirmed ${p.full_name}'s current company/role. This is manual review, not email validation.`);
      });
      message = "Current company/role recorded as reviewed by you. Email deliverability is a separate check.";
    } else {
      if (!c.domain || !c.domain_confirmed_at) throw new EnrichmentError(409, "Confirm the buyer company's official website using Find contacts first.");
      const domain = companyDomain(c.domain);
      if (input.action === "find") {
        const email = await providerRequest(id, c.company_id, "find", `${domain}:${p.full_name}`, () => findHunterEmail(domain, p.full_name));
        if (email) await db.query(`insert into contact_points (person_id,kind,value,source,validation_status)
          values ($1,'email',$2,'provider:hunter:finder','not_checked') on conflict do nothing`, [p.id, email]);
        message = email ? "Email found and saved; it still needs validation." : "Hunter did not find an email for this person. No address was guessed.";
        await event(db, id, `${p.full_name}: ${message}`);
      } else {
        const point = (await db.query<{ id: string; value: string }>("select id, value from contact_points where id = $1 and person_id = $2 and kind = 'email'", [input.pointId, p.id])).rows[0];
        if (!point) throw new EnrichmentError(404, "Email does not belong to this contact.");
        const result = await providerRequest(id, c.company_id, "verify", `${domain}:${point.value.toLowerCase()}`, () => verifyHunterEmail(point.value, domain));
        await db.tx(async tx => {
          const current = (await tx.query<{ domain: string }>("select domain from companies where id = $1 for share", [c.company_id])).rows[0];
          if (current.domain !== domain) throw new EnrichmentError(409, "Company domain changed during verification. Review the contact again.");
          await tx.query(`update contact_points set source = 'provider:hunter:verifier', verified_at = case when $2::boolean then $6::timestamptz else null end,
            validation_status = $3, validation_checked_at = $6::timestamptz where id = $1 and person_id = $4 and value = $5`,
            [point.id, result.deliverable, result.deliverable ? "valid" : result.status === "valid" ? "needs_review" : result.status, p.id, point.value, result.checkedAt]);
          await event(tx, id, `${p.full_name}: Hunter email check ${result.deliverable ? "valid (deliverability only)" : result.status + " — not validated"}. Role/employment and product fit remain separate reviews.`);
        });
        message = result.deliverable ? "Hunter validated email deliverability. Current role/employment and buyer fit still require review." : `Hunter result: ${result.status}. This email was not marked validated.`;
      }
    }
  }
  clearChainCache();
  return { message, view: await enrichmentView(id) };
}
