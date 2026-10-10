/** docs/mvp/20 §8: the evidence panel's "Why they are a buyer" card, from the search's need checks. */
import type { Queryable } from '@/mvp/db';
import type { NeedCard } from '@/mvp/buyers/types';
import { sameCompanyName } from '@/mvp/research/company-names';
import { marketName } from '@/mvp/config/markets';

const ROLE_WORD: Record<string, string> = {
  epc: 'EPC contractor', jv_partner: 'Construction joint-venture partner', subcontractor: 'Subcontractor', maintenance_contractor: 'Maintenance contractor',
};
/** Buying now: work won in the last 6 months; soon: within 18; still building: within 30 (big plants keep buying). */
export function buyingWindow(date: string | null, now = new Date()): NeedCard['window'] {
  if (!date) return 'check date';
  const months = (now.getTime() - Date.parse(date.length === 7 ? `${date}-15` : date)) / 2.63e9;
  return months <= 6 ? 'buying now' : months <= 18 ? 'buying soon' : 'still building';
}
const hostOf = (url: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, '') : null; } catch { return null; } };

/** The card for a company in a search, or null when the search has no accepted need check for it. */
export async function needCard(db: Queryable, runId: string, company: string, item: string, now = new Date()): Promise<NeedCard | null> {
  const rows = (await db.query<{ company_name: string; role: string; quote: string; need_why: string | null; use_name: string | null; project: string | null; work_date: string | null;
    market: string | null; document_id: string; url: string | null }>(
    `select n.company_name,n.role,n.quote,n.need_why,n.use_name,n.project,n.work_date,n.market,n.document_id,d.url from need_checks n
     left join source_documents d on d.id=n.document_id where n.run_id=$1 and n.verdict='lead' order by n.work_date desc nulls last, n.created_at`, [runId])).rows
    .filter((r) => sameCompanyName(r.company_name, company));
  const best = rows[0];
  if (!best) return null;
  // The strongest signal: a maker named in the same article as supplying the item to this work.
  const competitor = (await db.query<{ company_name: string; package: string | null }>(
    "select company_name, package from need_checks where run_id=$1 and document_id=$2 and role='seller_of_item' limit 1", [runId, best.document_id])).rows[0];
  return {
    item, work: best.quote, why: best.need_why ?? '', use: best.use_name, project: best.project, date: best.work_date,
    window: buyingWindow(best.work_date, now), role: ROLE_WORD[best.role] ?? null, country: best.market ? marketName(best.market) : null,
    url: best.url, source: hostOf(best.url),
    competitor: competitor ? `${competitor.company_name}${competitor.package ? `: ${competitor.package}` : ''}` : null,
    checks: ['Sentence found in the source', ...(best.work_date ? ['Date of the work read from the source'] : []), ...(best.market ? ['Work is in your countries'] : [])],
    more: rows.length - 1,
  };
}
