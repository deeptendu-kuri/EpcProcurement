import { getDb, type Db } from "@/mvp/db";
import { getCatalogue } from "@/mvp/config/buyers-config";
import { loadBuyerRecords } from "@/mvp/buyers/load";
import type { BuyerRecord } from "@/mvp/buyers/view";
import type { RunInput, RunRow } from "@/mvp/types";
import { journey, verifiedProspect } from "./workflow";

export interface Opportunity {
  id: string; run_id: string; lead_id: string; keyword: string; product_id: string; product_name: string;
  contact_role: string; buying_reason: string; evidence_ids: string[]; qualification: string;
  summary: string; owner_name: string; next_action: string; follow_up_at: string | null; created_at: string;
  name: string; country: string | null; is_sample: boolean; validated_emails: number; sent: boolean;
  project_id?: string | null; project_name?: string | null; project_country?: string | null;
  discovery_kind?: "project" | "company"; fit_score?: number;
  source_urls?: string[];
}
/** Conservative product-specific eligibility. Inference remains a prospect, never a confirmed order. */
export function eligibleForProduct(record: BuyerRecord, productId: string): boolean {
  const v = record.view;
  return !record.consultant && record.leadStatus !== "rejected" && v.stage !== "not_buyer"
    && v.role !== "owner" && v.role !== "distributor"
    && record.signals.some(s => s === "contract_won" || s === "order_won")
    && v.sellItems.some(i => i.itemId === productId && i.fit !== "competitor");
}
/** Snapshot only evidence actually read by this search; never use a global/timestamp-based lead list. */
export async function captureOpportunities(runId: string, input: RunInput, db: Db = getDb()): Promise<number> {
  if (!input.productId) return 0; // historic/unscoped flows are kept separate
  const product = getCatalogue().items.find(i => i.id === input.productId);
  if (!product) throw new Error("Search product is not in the catalogue.");
  const evidence = (await db.query<{ id: string }>(`select e.id from evidence e join run_documents rd on rd.document_id = e.document_id
    where rd.run_id = $1 and e.quote_verified = true`, [runId])).rows;
  const readIds = new Set(evidence.map(e => e.id));
  const awards = (await db.query<{ company_id: string; project_id: string | null; evidence_ids: string[] }>(
    "select company_id, project_id, evidence_ids from signals where type in ('contract_awarded','subcontract_awarded','supply_order_announced')", [])).rows;
  const leadIds = (await db.query<{ id: string }>("select id from leads where kind = 'supply_subcontract' order by created_at desc limit 2000")).rows.map(l => l.id);
  const records = (await loadBuyerRecords({ db, leadIds })).sort((a,b) => b.view.fitScore - a.view.fitScore || (b.view.triggerDate ?? "").localeCompare(a.view.triggerDate ?? "") || a.view.leadId.localeCompare(b.view.leadId));
  const companies = new Set<string>();
  let count = 0;
  await db.tx(async tx => {
    for (const record of records) {
      if (!eligibleForProduct(record, product.id)) continue;
      if (!awards.some(s => s.company_id === record.view.companyId && s.project_id === record.projectId && s.evidence_ids.some(id => readIds.has(id)))) continue;
      if (!record.view.country || !input.markets.includes(record.view.country)) continue;
      const proof = record.view.proof.filter(p => readIds.has(p.evidenceId));
      if (!proof.length) continue;
      if (companies.has(record.view.companyId)) continue;
      companies.add(record.view.companyId);
      const item = record.view.sellItems.find(i => i.itemId === product.id)!;
      const result = await tx.query(`insert into search_opportunities
        (run_id, lead_id, keyword, product_id, product_name, contact_role, buying_reason, evidence_ids, company_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9) on conflict (run_id, company_id, product_id) do nothing returning id`,
        [runId, record.view.leadId, input.query, product.id, product.shortName || product.name,
          input.contactRole ?? "buyer", `${record.view.buyingReason} Potential need: ${item.why}`, proof.map(p => p.evidenceId), record.view.companyId]);
      count += result.rows.length;
    }
  });
  return count;
}
const OPPORTUNITY_SQL = `select o.*, c.canonical_name as name, c.country, l.is_sample, l.project_id, pj.name as project_name, pj.country as project_country,
  array(select distinct e.url from evidence e where e.id=any(o.evidence_ids) and e.quote_verified=true order by e.url limit 3) as source_urls,
  (select count(distinct cp.id)::int from contact_points cp join people p on p.id = cp.person_id
    where p.current_company_id = l.buyer_company_id and p.confirmed_at > now() - interval '90 days'
      and cp.kind = 'email' and cp.verified_at is not null
      and cp.verified_at > now() - interval '90 days' and cp.source like 'provider:%'
      and cp.value ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      and exists (select 1 from person_roles pr where pr.person_id = p.id
        and (pr.company_id = p.current_company_id or pr.company_id is null) and pr.end_date is null and
        case o.contact_role when 'buyer' then pr.buying_role in ('procurement_lead','package_manager')
          when 'decision_maker' then pr.buying_role in ('decision_maker','executive')
          when 'approver' then pr.buying_role in ('decision_maker','project_director')
          when 'technical_approver' then pr.buying_role in ('technical_evaluator','discipline_lead')
          when 'influencer' then pr.buying_role in ('project_director','package_manager')
          else false end)) as validated_emails,
  (exists(select 1 from outreach_drafts d where d.opportunity_id = o.id and d.delivery_state = 'sent')
    or exists(select 1 from funnel_threads ft join funnel_messages fm on fm.thread_id=ft.id where ft.opportunity_id=o.id and fm.direction='out' and fm.state='accepted')) as sent
  from search_opportunities o join leads l on l.id = o.lead_id join companies c on c.id = l.buyer_company_id left join projects pj on pj.id=l.project_id`;
export async function listOpportunities(runId?: string): Promise<Opportunity[]> {
  return (await getDb().query<Opportunity>(`${OPPORTUNITY_SQL} ${runId ? "where o.run_id = $1" : ""} order by o.fit_score desc,o.created_at desc, o.id limit 2000`, runId ? [runId] : [])).rows;
}
export async function getOpportunity(id: string): Promise<Opportunity | null> {
  return (await getDb().query<Opportunity>(`${OPPORTUNITY_SQL} where o.id = $1`, [id])).rows[0] ?? null;
}
export function isVerified(o: Opportunity): boolean { return verifiedProspect(o.qualification, o.validated_emails, o.is_sample); }
export function opportunityJourney(o: Opportunity) { return journey(o.qualification, o.validated_emails, o.sent, o.is_sample); }
export async function recentSearches(): Promise<(RunRow & { result_count: number })[]> {
  return (await getDb().query<RunRow & { result_count: number }>(`select r.*, (select count(*)::int from search_opportunities o where o.run_id = r.id) as result_count
    from runs r order by r.created_at desc limit 50`)).rows;
}
export async function updateOpportunity(id: string, patch: { qualification?: string; summary?: string; ownerName?: string; nextAction?: string; followUpAt?: string | null }): Promise<Opportunity | null> {
  return getDb().tx(async tx => {
    const current = (await tx.query<Opportunity>("select * from search_opportunities where id = $1 for update", [id])).rows[0];
    if (!current) return null;
    await tx.query(`update search_opportunities set qualification = coalesce($2,qualification), summary = coalesce($3,summary),
      owner_name = coalesce($4,owner_name), next_action = coalesce($5,next_action),
      follow_up_at = case when $6::boolean then $7::timestamptz else follow_up_at end,
      reviewed_at = case when $2::text is not null then now() else reviewed_at end where id = $1`,
      [id, patch.qualification ?? null, patch.summary ?? null, patch.ownerName ?? null, patch.nextAction ?? null, patch.followUpAt !== undefined, patch.followUpAt ?? null]);
    await tx.query("insert into opportunity_events (opportunity_id, body) values ($1,$2)", [id,
      patch.qualification ? `Buyer fit reviewed: ${patch.qualification}` : "CRM notes / next action updated"]);
    // Query through the same transaction to avoid a second-connection deadlock.
    return (await tx.query<Opportunity>(`${OPPORTUNITY_SQL} where o.id = $1`, [id])).rows[0];
  });
}
