import { getDb } from "@/mvp/db";
import { enrichOpportunity, enrichmentView } from "@/mvp/enrichment";
import type { Opportunity } from "@/mvp/opportunities";

export interface ReadyContact { id:string;name:string;title:string|null }
/** Enrichment never substitutes a guessed official domain or falsely confirms current employment. */
export async function prepareContact(o: Opportunity): Promise<ReadyContact|null> {
  let view=await enrichmentView(o.id);
  if (!view.domainConfirmed || !view.domain) throw new Error("Official company website needs confirmation in Contacts. A guessed domain cannot authorize discovery.");
  if (!view.contacts.length) view=(await enrichOpportunity(o.id,{action:"search",domain:view.domain,domainConfirmed:true})).view;
  // All role holders may be shown; one role-matched, reviewed contact per company/product enters outreach.
  const p=(await getDb().query<{id:string;name:string;title:string|null;point_id:string|null;verified_at:string|null;source:string|null}>(`select p.id,p.full_name as name,p.title,cp.id as point_id,cp.verified_at,cp.source
    from people p left join contact_points cp on cp.person_id=p.id and cp.kind='email'
    where p.current_company_id=(select company_id from search_opportunities where id=$1) and p.confirmed_at>now()-interval '90 days'
      and exists(select 1 from person_roles pr where pr.person_id=p.id and (pr.company_id=p.current_company_id or pr.company_id is null)
        and pr.end_date is null and case $2 when 'buyer' then pr.buying_role in ('procurement_lead','package_manager')
        when 'decision_maker' then pr.buying_role in ('decision_maker','executive') when 'approver' then pr.buying_role in ('decision_maker','project_director')
        when 'technical_approver' then pr.buying_role in ('technical_evaluator','discipline_lead') when 'influencer' then pr.buying_role in ('project_director','package_manager') else false end)
    order by cp.verified_at desc nulls last,p.full_name limit 1`,[o.id,o.contact_role])).rows[0];
  if (!p) throw new Error("No reviewed current buying-team contact. Review a named contact's employer/role in Contacts; email deliverability alone does not prove employment.");
  if (!p.point_id) {
    await enrichOpportunity(o.id,{action:"find",personId:p.id});
    const updated=await enrichmentView(o.id);const found=updated.contacts.find(c=>c.id===p.id&&c.point_id);
    if (!found?.point_id) throw new Error("No published or provider-found email for this contact. Nothing was guessed.");
    p.point_id=found.point_id;
  }
  if (!p.verified_at || Date.parse(p.verified_at)<Date.now()-90*24*60*60_000 || !p.source?.startsWith("provider:")) {
    const updated=(await enrichOpportunity(o.id,{action:"verify",personId:p.id,pointId:p.point_id})).view;
    if (!updated.contacts.some(c=>c.id===p.id && c.point_id===p.point_id && c.verified_at)) throw new Error("The contact's email is not provider-validated. No automated email queued.");
  }
  return {id:p.id,name:p.name,title:p.title};
}
