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

export const LIKELY_MIN = 45;
export const LIKELY_MAX_PER_SEARCH = 60;
// Stockists and traders are secondary: listed under Companies found, never saved as leads.
const ROLE: Record<BuyerType, string | null> = {
  end_user: 'fabricator', contractor: 'epc_contractor', subcontractor: 'subcontractor', owner: 'owner', reseller: null, competitor: null, not_buyer: null,
};
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function saveLikelyBuyers(db: Db, runId: string, input: Pick<RunInput, 'productId' | 'query' | 'contactRole'>): Promise<{ saved: number; listing: number }> {
  const productId = input.productId;
  if (!productId || !getCatalogueItem(productId)) return { saved: 0, listing: 0 };
  const label = searchedProductLabel(productId, input.query ?? '');
  const picks = (await listFoundCompanies(db, runId))
    .filter((c) => c.relevant && !c.opportunityId && (c.rating ?? 0) >= LIKELY_MIN && c.buyerType && ROLE[c.buyerType])
    .slice(0, LIKELY_MAX_PER_SEARCH);
  if (!picks.length) return { saved: 0, listing: 0 };
  const docs = new Map((await db.query<{ id: string; doc: string | null; text: string | null; url: string | null; tier: string | null; publisher_key: string | null }>(
    `select c.id,c.identity_document_id as doc,d.text,d.url,d.tier,d.publisher_key from research_candidates c left join source_documents d on d.id=c.identity_document_id
     where c.id=any($1::uuid[])`, [picks.map((p) => p.id)])).rows.map((r) => [r.id, r]));
  let saved = 0, listing = 0;
  for (const c of picks) {
    const role = ROLE[c.buyerType!]!;
    const doc = docs.get(c.id);
    // A list entry that itself describes work with the material is quoted evidence ("listing").
    const quote = c.quote && squash(c.quote).length >= 20 ? squash(c.quote) : null;
    const listed = Boolean(quote && doc?.doc && doc.text && squash(doc.text).includes(quote) && materialEvidenceKind(quote, productId) !== 'none');
    // A plain-rule guess (no AI yet) becomes a lead only with its listed work as evidence.
    if (c.guessed && !listed) continue;
    const verification = listed ? 'listing' : 'rating';
    const reason = `Likely ${label} buyer (${listed ? 'its listed work uses it' : 'rated from the source; not verified yet'}): ${c.ratingReason ?? c.ratingRole ?? 'see source'}`;
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
        [runId, lead.id, company.id, input.query ?? label, productId, label, input.contactRole ?? 'buyer', reason, evidence, c.rating ?? LIKELY_MIN, c.match === 'named' ? 'explicit' : 'potential', verification]);
      if (inserted.rows.length && listed && quote)
        await storeTrigger(tx, runId, company.id, productId, { kind: 'capability', role: c.buyerType === 'subcontractor' ? 'subcontractor' : 'contractor', title: quote, date: null, datePrecision: 'unknown',
          valueUsd: null, valueText: null, country: null, projectId: null, projectName: null, ownerName: null, strength: 'possible', evidenceIds: evidence });
      return inserted.rows.length > 0;
    }).catch(() => false);
    if (ok) { saved++; if (listed) listing++; }
  }
  if (saved) clearBuyerCache();
  return { saved, listing };
}
