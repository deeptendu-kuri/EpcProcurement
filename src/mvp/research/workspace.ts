/**
 * Search workspace (docs/mvp/18 §4): one snapshot of a search for /find?run=… — what it is doing now,
 * how long it has run, the AI tokens it used, what it read, the rated shortlist of companies it found,
 * the buyers it verified and its recent activity. Read-only.
 */
import { getDb, type Queryable } from '@/mvp/db';
import { getRun } from '@/mvp/repo';
import { getCatalogueItem } from '@/mvp/config/buyers-config';
import { runStatusText } from '@/components/mvp/run-steps';
import { EMAIL_LABELS } from '@/mvp/buyers';
import type { RunStatus } from '@/mvp/types';
import { listFoundCompanies, type FoundCompany } from './found';
import { runMinutes, runUsage } from './usage';
import { parseMaterialSpec, specChips } from '@/mvp/discovery/spec';

export interface WorkspaceBuyer { opportunityId: string; name: string; role: string | null; country: string | null; fit: number; reason: string; email: string }
export interface WorkspaceEvent { id: number; ts: string; message: string }
export interface SearchWorkspaceData {
  run: { id: string; query: string; productId: string | null; product: string | null; markets: string[]; status: RunStatus; statusText: string;
    createdAt: string; finishedAt: string | null; error: string | null; stopReason: string | null };
  /** Plain words for what the search is doing now. */
  phase: string;
  running: boolean;
  minutes: number | null;
  usage: { tokens: number; tokenLimit: number | null; aiCalls: number; pagesRead: number; pageLimit: number | null; searches: number; searchLimit: number | null };
  counts: { found: number; rated: number; likely: number; verified: number; checking: number; notBuyers: number };
  /** Doc 19: each country's searches (done of planned) and verified buyers, searched in parallel. */
  countries: { code: string; searchesDone: number; searchesTotal: number; verified: number }[];
  /** Doc 19: the exact variant typed ("Welded", "316L", "ASTM A312"). */
  variant: string[];
  buyers: WorkspaceBuyer[];
  companies: FoundCompany[];
  events: WorkspaceEvent[];
}

const PHASES: Record<string, string> = {
  collect: 'Finding companies', read: 'Reading pages', filter: 'Reading pages', extract: 'Checking companies', check: 'Rating and checking companies',
  resolve: 'Checking companies', signals: 'Ranking buyers', score: 'Ranking buyers', research: 'Checking companies',
};

/** Plain words for the engine's most frequent progress notes. */
const PLAIN: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^registry: (\d+) original-page candidates/i, (m) => `Found ${m[1]} company ${m[1] === '1' ? 'page' : 'pages'} in a directory.`],
  [/Bing coverage limit reached|News search allowance reached/i, () => 'News search allowance for this search used up; carrying on with the pages already found.'],
  [/Tavily coverage limit reached/i, () => 'Web search allowance for this search used up; carrying on with the pages already found.'],
  [/^Original page saved for company\/material analysis/i, () => 'Read a company page.'],
  [/^Original page saved/i, () => 'Read a page.'],
];
/** Newest first, plain where possible, with repeats merged ("… ×3"). */
export function readableEvents(events: { id: number; ts: string; message: string }[]): WorkspaceEvent[] {
  const out: (WorkspaceEvent & { n: number })[] = [];
  for (const e of events) {
    if (!e.message) continue;
    const rule = PLAIN.find(([re]) => re.test(e.message));
    const message = rule ? rule[1](e.message.match(rule[0])!) : e.message;
    const last = out[out.length - 1];
    if (last && last.message.replace(/ ×\d+$/, '') === message) { last.n++; last.message = `${message} ×${last.n}`; continue; }
    out.push({ id: e.id, ts: e.ts, message, n: 1 });
  }
  return out.map(({ id, ts, message }) => ({ id, ts, message }));
}

export async function searchWorkspace(runId: string, db: Queryable = getDb(), now = new Date()): Promise<SearchWorkspaceData | null> {
  const run = await getRun(runId);
  if (!run) return null;
  const input = run.adhoc_query;
  const running = run.status === 'running' || run.status === 'queued';
  const [usage, companies, events, buyers, perCountry] = await Promise.all([
    runUsage(db, [runId]).then((m) => m.get(runId)),
    listFoundCompanies(db, runId).catch(() => [] as FoundCompany[]),
    db.query<{ id: number; ts: string; stage: string; message: string }>(`select id,ts::text,stage,message from run_events where run_id=$1 order by id desc limit 30`, [runId]).then((r) => r.rows),
    db.query<{ id: string; name: string; buyer_type: string | null; country: string | null; fit_score: number; buying_reason: string; state: string | null }>(
      `select o.id,c.canonical_name as name,l.buyer_type,c.country,o.fit_score,o.buying_reason,
         (select t.state from funnel_threads t where t.opportunity_id=o.id and t.mode<>'email_test' order by t.created_at desc limit 1) as state
       from search_opportunities o join companies c on c.id=o.company_id join leads l on l.id=o.lead_id
       where o.run_id=$1 and o.qualification<>'rejected' and o.verification<>'rating' order by o.fit_score desc,o.created_at`, [runId]).then((r) => r.rows),
    db.query<{ market: string; done: number; total: number }>(`select coalesce(payload->>'market',payload->'query'->>'market') as market,
        count(*) filter (where state in ('done','failed','cancelled'))::int as done, count(*)::int as total
      from research_jobs where run_id=$1 and stage='collect' and coalesce(payload->>'market',payload->'query'->>'market') is not null group by 1`, [runId]).then((r) => r.rows),
  ]);
  const latestStage = events.find((e) => PHASES[e.stage])?.stage;
  const relevant = companies.filter((c) => c.relevant);
  const counters = run.counters ?? {};
  return {
    run: { id: run.id, query: input?.query ?? 'Search', productId: input?.productId ?? null, product: input?.productId ? getCatalogueItem(input.productId)?.shortName ?? null : null,
      markets: input?.markets ?? [], status: run.status, statusText: runStatusText(run.status, counters), createdAt: run.created_at, finishedAt: run.finished_at,
      error: run.error, stopReason: counters.researchStopReason ?? null },
    phase: running ? (latestStage ? PHASES[latestStage] : 'Starting') : run.status === 'done' ? 'Finished' : 'Stopped',
    running,
    minutes: runMinutes(run, now),
    usage: { tokens: usage?.tokens ?? counters.researchUsage?.estimatedAiTokens ?? 0, tokenLimit: counters.researchLimits?.estimatedAiTokens ?? null,
      aiCalls: usage?.aiCalls ?? counters.researchUsage?.aiCalls ?? 0, pagesRead: counters.itemsRead ?? counters.researchUsage?.reads ?? 0,
      pageLimit: counters.researchLimits?.reads ?? null, searches: counters.researchUsage?.search ?? 0, searchLimit: counters.researchLimits?.search ?? null },
    counts: { found: relevant.length, rated: companies.filter((c) => c.rating !== null).length, likely: relevant.filter((c) => (c.rating ?? 0) >= 45).length,
      verified: buyers.length, checking: companies.filter((c) => c.status === 'checking').length, notBuyers: companies.length - relevant.length },
    buyers: buyers.map((b) => ({ opportunityId: b.id, name: b.name, role: b.buyer_type, country: b.country,
      fit: Math.max(Number(b.fit_score) || 0, companies.find((c) => c.opportunityId === b.id)?.rating ?? 0), reason: b.buying_reason,
      email: b.state ? EMAIL_LABELS[b.state] ?? b.state : 'Not started' })),
    companies,
    events: readableEvents(events),
    variant: specChips(parseMaterialSpec(input?.query ?? '')),
    countries: (input?.markets ?? []).map((code) => {
      const c = perCountry.find((p) => p.market === code);
      return { code, searchesDone: c?.done ?? 0, searchesTotal: c?.total ?? 0, verified: buyers.filter((b) => b.country === code).length };
    }),
  };
}
