/**
 * Likely buyers become leads straight away (docs/mvp/19 §6). Before, a company had to have its own
 * website found and read to be saved: with 8–24 website checks per search, most good names never became
 * leads (72 of 125 in the 9 Oct steel plates search). Now every well-rated company is saved as a lead,
 * marked by how it is proven:
 *   - 'listing': its list or directory entry describes its work with the material (quoted as evidence);
 *   - 'rating':  only the shortlist rating ("likely, not verified"); never emailed automatically.
 * A later website check upgrades the same lead to 'website' (saveBuyer).
 */
import type { Db } from '@/mvp/db';
import type { RunInput } from '@/mvp/types';
import { getCatalogueItem } from '@/mvp/config/buyers-config';
import { searchedProductLabel } from '@/mvp/config/product-label';
import { materialEvidenceKind } from '@/mvp/discovery/plan';
import { resolveBuyerCompany, storeTrigger } from '@/mvp/sourcing/triggers';
import { clearBuyerCache } from '@/mvp/buyers/load';
import { listFoundCompanies } from './found';
import type { BuyerType } from './shortlist';
import { sameCompanyName } from './company-names';
import { namesWork } from '@/mvp/discovery/brief';

/** A need check's accepted company, with its source (docs/mvp/20). */
interface NeedLead { company_name: string; role: string; quote: string; need_why: string | null; work_date: string | null; market: string | null; project: string | null;
  document_id: string; url: string | null; tier: string | null; publisher_key: string | null }
/** A need-proven lead's fit: its work needs the item, shown on a verified sentence. */
const NEED_FIT = 75;

export const LIKELY_MIN = 45;
export const LIKELY_MAX_PER_SEARCH = 60;
// Stockists and traders, and project owners (they buy through their EPC contractors), are secondary:
// listed under Companies found, never saved as leads from a rating alone. A website check can still prove an owner.
const ROLE: Record<BuyerType, string | null> = {
  end_user: 'fabricator', contractor: 'epc_contractor', subcontractor: 'subcontractor', owner: null, reseller: null, competitor: null, not_buyer: null,
};
/** The lead role a rated buyer type is saved with, or null when that type is never a lead. */
export const leadRoleFor = (type: BuyerType): string | null => ROLE[type];
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function saveLikelyBuyers(db: Db, runId: string, input: Pick<RunInput, 'productId' | 'query' | 'contactRole' | 'brief'>): Promise<{ saved: number; listing: number }> {
  const productId = input.productId;
  if (!productId || !getCatalogueItem(productId)) return { saved: 0, listing: 0 };
  const label = searchedProductLabel(productId, input.query ?? '');
  // docs/mvp/20: in a work-based search a company the need check accepted is a lead on that proof (its verified
  // sentence about work that needs the item), whatever its shortlist rating; the smoke test lost them all.
  const needs = input.brief?.source === 'ai' ? (await db.query<NeedLead>(
    `select n.company_name,n.role,n.quote,n.need_why,n.work_date,n.market,n.project,n.document_id,d.url,d.tier,d.publisher_key
     from need_checks n join source_documents d on d.id=n.document_id where n.run_id=$1 and n.verdict='lead' order by n.work_date desc nulls last`, [runId])).rows : [];
  const needFor = (name: string) => needs.find((n) => sameCompanyName(n.company_name, name)) ?? null;
  const work = input.brief?.source === 'ai';
  const picks = (await listFoundCompanies(db, runId))
    // Smoke test, 10 Oct: names rated without any source sentence (Fluor on LNG Canada, a package name) became
    // leads. In a work-based search a rated company needs its own sentence naming the brief's work.
    .filter((c) => !c.opportunityId && (needFor(c.name) || (c.relevant && (c.rating ?? 0) >= LIKELY_MIN && c.buyerType && ROLE[c.buyerType]
      && (!work || Boolean(c.quote && namesWork(c.quote, input.brief!))))))
    .slice(0, LIKELY_MAX_PER_SEARCH);
  if (!picks.length) return { saved: 0, listing: 0 };
  const docs = new Map((await db.query<{ id: string; doc: string | null; text: string | null; url: string | null; tier: string | null; publisher_key: string | null }>(
    `select c.id,c.identity_document_id as doc,d.text,d.url,d.tier,d.publisher_key from research_candidates c left join source_documents d on d.id=c.identity_document_id
     where c.id=any($1::uuid[])`, [picks.map((p) => p.id)])).rows.map((r) => [r.id, r]));
  let saved = 0, listing = 0;
  for (const c of picks) {
    const need = needFor(c.name);
    const role = need ? (need.role === 'subcontractor' || need.role === 'maintenance_contractor' ? 'subcontractor' : 'epc_contractor') : ROLE[c.buyerType!]!;
    const doc = need ? { doc: need.document_id, text: null, url: need.url, tier: need.tier, publisher_key: need.publisher_key } : docs.get(c.id);
    // A list entry that itself describes work with the material is quoted evidence ("listing"); the need check's
    // sentence was verified against its source when it was judged.
    const quote = need ? need.quote : c.quote && squash(c.quote).length >= 20 ? squash(c.quote) : null;
    const listed = Boolean(need) || Boolean(quote && doc?.doc && doc.text && squash(doc.text).includes(quote!)
      && (work ? namesWork(quote!, input.brief!) : materialEvidenceKind(quote!, productId) !== 'none'));
    // Every lead of a work-based search has a source sentence about the work.
    if (work && !listed) continue;
    // A plain-rule guess (no AI yet) becomes a lead only with its listed work as evidence.
    if (c.guessed && !listed) continue;
    const verification = listed ? 'listing' : 'rating';
    // The same form as an award winner's reason, so Leads shows "Their work" and "Why" as bullets.
    const reason = need ? `${need.quote}${need.need_why ? ` Why it needs ${label}: ${need.need_why}` : ''}`
      : `Likely ${label} buyer (${listed ? 'its listed work uses it' : 'rated from the source; not verified yet'}): ${c.ratingReason ?? c.ratingRole ?? 'see source'}`;
    const ok = await db.tx(async (tx) => {
      const company = await resolveBuyerCompany(tx, c.name, null, role === 'epc_contractor' ? 'main_epc' : role, c.website);
      let evidence: string[] = [];
      if (listed && doc?.doc && quote) {
        const existing = (await tx.query<{ id: string }>('select id from evidence where document_id=$1 and quote=$2 and quote_verified=true limit 1', [doc.doc, quote])).rows[0];
        const id = existing?.id ?? (await tx.query<{ id: string }>(`insert into evidence(document_id,url,quote,extracted_by,quote_verified,agreement,tier,publisher_key) values($1,$2,$3,'rule:listing',true,'single',$4,$5) returning id`,
          [doc.doc, doc.url, quote, doc.tier ?? 'C', doc.publisher_key])).rows[0].id;
        evidence = [id];
      }
      const lead = (await tx.query<{ id: string }>(`insert into leads(kind,buyer_company_id,client_product_ids,score_breakdown,gate_results,class,reasons,scoring_version,run_id,buyer_type)
        values('supply_subcontract',$1,$2::text[],'{}','[]','research',$3::jsonb,1,$4,$5)
        on conflict on constraint leads_candidate_uniq do update set updated_at=now() returning id`, [company.id, [productId], JSON.stringify([{ text: reason, evidenceIds: evidence }]), runId, role])).rows[0];
      const inserted = await tx.query(`insert into search_opportunities(run_id,lead_id,company_id,keyword,product_id,product_name,contact_role,buying_reason,evidence_ids,discovery_kind,fit_score,material_fit_kind,activity_status,verification,discovery_version)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],'company',$10,$11,'capability_only',$12,0) on conflict(run_id,company_id,product_id) do nothing returning id`,
        [runId, lead.id, company.id, input.query ?? label, productId, label, input.contactRole ?? 'buyer', reason, evidence, need ? Math.max(c.rating ?? 0, NEED_FIT) : c.rating ?? LIKELY_MIN, c.match === 'named' ? 'explicit' : 'potential', verification]);
      if (inserted.rows.length && listed && quote)
        await storeTrigger(tx, runId, company.id, productId, need
          // Its dated work on a project that needs the item (Recent work and the buying window come from this).
          ? { kind: 'award', role: role === 'subcontractor' ? 'subcontractor' : 'contractor', title: need.quote, date: need.work_date, datePrecision: need.work_date ? (need.work_date.length === 7 ? 'month' : 'day') : 'unknown',
            valueUsd: null, valueText: null, country: need.market, projectId: null, projectName: need.project, ownerName: null, strength: 'confirmed', evidenceIds: evidence }
          : { kind: 'capability', role: c.buyerType === 'subcontractor' ? 'subcontractor' : 'contractor', title: quote, date: null, datePrecision: 'unknown',
          valueUsd: null, valueText: null, country: null, projectId: null, projectName: null, ownerName: null, strength: 'possible', evidenceIds: evidence });
      return inserted.rows.length > 0;
    }).catch(() => false);
    if (ok) { saved++; if (listed) listing++; }
  }
  if (saved) clearBuyerCache();
  return { saved, listing };
}
