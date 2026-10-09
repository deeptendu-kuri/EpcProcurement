/**
 * Follow contractors down their chain (docs/mvp/19 Phase 5). A main contractor or owner that wins work
 * usually passes the piping, mechanical or fabrication package to subcontractors, who then buy the
 * material. For the best-rated contractors and owners of a search, one targeted web search looks for
 * those subcontractors; companies named on the pages found are recorded as working under that contractor.
 * Uses the search's normal web-search allowance; runs once per contractor.
 */
import type { Db } from '@/mvp/db';
import type { RunInput } from '@/mvp/types';
import { MATERIAL_ACTIVITIES } from '@/mvp/discovery/material';
import { getCatalogueItem } from '@/mvp/config/buyers-config';
import { hasSpec, parseMaterialSpec, specUses } from '@/mvp/discovery/spec';
import { addJob } from './store';

/** Contractors and owners followed per search. */
export const CHAIN_TOP = 5;
/** Only well-rated contractors and owners are followed. */
export const CHAIN_MIN_RATING = 60;
export interface ChainParent { candidateId: string; company: string }

/** "McDermott pipeline construction subcontractor" — the work that needs the material, plus "subcontractor". */
export function chainQuery(company: string, input: Pick<RunInput, 'productId' | 'query'>): string {
  const spec = parseMaterialSpec(input.query ?? '');
  const use = hasSpec(spec) ? specUses(input.productId ?? '', spec)[0] : undefined;
  const work = use ?? MATERIAL_ACTIVITIES[input.productId ?? '']?.[0] ?? getCatalogueItem(input.productId ?? '')?.shortName ?? 'piping';
  return `"${company.replace(/"/g, '')}" ${work} subcontractor`;
}

/** Queue one subcontractor search for each of the top contractors and owners not followed yet. Returns how many. */
export async function planChainSearches(db: Db, runId: string, input: RunInput): Promise<number> {
  if (!process.env.TAVILY_API_KEY?.trim() || !input.productId) return 0;
  const top = (await db.query<{ id: string; company: string }>(`select c.id,c.company from research_candidates c
    where c.run_id=$1 and c.rating_buyer_type in ('contractor','owner') and c.rating>=$2
      and not exists(select 1 from research_jobs j where j.run_id=c.run_id and j.key='chain:'||c.id::text)
    order by c.rating desc,c.created_at limit $3`, [runId, CHAIN_MIN_RATING, CHAIN_TOP])).rows;
  let added = 0;
  for (const c of top) {
    const parent: ChainParent = { candidateId: c.id, company: c.company };
    const query = { key: `chain:${c.id}`, market: input.markets[0] ?? '', lane: 'directory' as const, activityIndex: 0, query: chainQuery(c.company, input), topic: 'general' as const, sourcingLane: 'roundup' as const };
    if (await db.tx((tx) => addJob(tx, runId, 'collect', `chain:${c.id}`, { source: 'tavily', sourcingLane: 'roundup', query, chainParent: parent }, 900))) added++;
  }
  return added;
}
