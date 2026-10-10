/**
 * Dashboard read model: the action plan (what needs the user today), every search with its progress,
 * and the pipeline from companies found to meetings. Read-only; never starts research or email.
 */
import { getDb } from '@/mvp/db';
import { recentSearches } from '@/mvp/opportunities';
import { searchWorkflowCounts } from '@/mvp/opportunities/workspace-stats';
import { listFoundCompanies } from '@/mvp/research/found';
import { listFunnelThreads } from '@/mvp/automation/engine';
import { runMinutes, runUsage } from '@/mvp/research/usage';
import type { RunRow } from '@/mvp/types';
import { searchKind } from '@/components/mvp/run-steps';
import { aiAllowance, type ModelAllowance } from '@/mvp/llm/quota';
import { groqBlockedModels } from '@/mvp/llm/groq';
import { EMAIL_LABELS } from '@/mvp/buyers';

export interface DashboardSearch {
  run: RunRow & { result_count: number };
  /** Work-related companies found; null for older searches not counted on the dashboard. */
  found: number | null;
  toCheck: number | null;
  conversations: number;
  meetings: number;
  /** AI tokens used by the search (provider-reported), its allowance, and minutes it ran. */
  tokens: number;
  tokenLimit: number | null;
  minutes: number | null;
  /** Leads proven by their own website or listed work, and leads only rated likely. */
  verified: number;
  likely: number;
}
/** A lead saved this week, best first, for "Best new leads". */
export interface DashboardLead { opportunityId: string; runId: string; name: string; country: string | null; product: string; fit: number; verification: 'website' | 'listing' | 'rating'; email: string | null }
export interface DashboardMeeting { opportunityId: string | null; company: string; product: string; start: string | null; meetUrl: string | null }
export interface DashboardData {
  searches: DashboardSearch[];
  earlierSearches: (RunRow & { result_count: number })[];
  actions: { review: number; meetings: DashboardMeeting[]; nextMeeting: DashboardMeeting | null; inProgress: number; newBuyers: number; toCheck: number;
    running: { id: string; label: string }[]; paused: { id: string; label: string }[]; toVerify: number };
  pipeline: { found: number; buyers: number; verified: number; likely: number; emailed: number; replied: number; meetings: number };
  topLeads: DashboardLead[];
  /** Free AI allowance per model over the last 24 hours, as Groq counts it (empty without a Groq key). */
  allowance: { models: ModelAllowance[]; left: number };
  latestSearchId: string | null;
}

const IN_PROGRESS = new Set(['active', 'engaged', 'awaiting_time', 'awaiting_calendar', 'meeting_pending']);
const REPLIED = new Set(['engaged', 'awaiting_time', 'awaiting_calendar', 'meeting_pending', 'meeting_booked']);
/** Found-company lists are counted for the most recent searches only, to keep the dashboard fast. */
const COUNTED_SEARCHES = 8;

export async function dashboardData(now = new Date()): Promise<DashboardData> {
  const db = getDb();
  const all = await recentSearches();
  const productSearches = all.filter((r) => r.adhoc_query?.productId);
  const workflows = await searchWorkflowCounts(productSearches.map((r) => r.id));
  const usage = await runUsage(db, productSearches.map((r) => r.id)).catch(() => new Map());
  // Counted per company, as Leads counts them: a company is verified when any of its leads in the search is.
  const proof = new Map((await db.query<{ run_id: string; verified: number; likely: number }>(`select run_id, count(*) filter (where verified)::int as verified,
      count(*) filter (where not verified)::int as likely from (select run_id, company_id, bool_or(verification<>'rating') as verified from search_opportunities
      where qualification<>'rejected' and run_id = any($1::uuid[]) group by run_id, company_id) per_company group by run_id`,
    [productSearches.map((r) => r.id)])).rows.map((r) => [r.run_id, r]));
  const searches: DashboardSearch[] = [];
  for (const [index, run] of productSearches.entries()) {
    let found: number | null = null, toCheck: number | null = null;
    if (index < COUNTED_SEARCHES) {
      const list = (await listFoundCompanies(db, run.id).catch(() => [])).filter((c) => c.relevant);
      found = list.length;
      toCheck = list.filter((c) => c.status !== 'saved' && c.status !== 'no_match').length;
    }
    const w = workflows.find((x) => x.run_id === run.id);
    searches.push({ run, found, toCheck, conversations: w?.workflow_count ?? 0, meetings: w?.meeting_count ?? 0,
      tokens: usage.get(run.id)?.tokens ?? run.counters.researchUsage?.estimatedAiTokens ?? 0, tokenLimit: run.counters.researchLimits?.estimatedAiTokens ?? null,
      minutes: runMinutes(run, now), verified: proof.get(run.id)?.verified ?? 0, likely: proof.get(run.id)?.likely ?? 0 });
  }
  const threads = (await listFunnelThreads().catch(() => [])).filter((t) => t.mode !== 'email_test');
  const newBuyers = (await db.query<{ n: number }>(`select count(*)::int as n from search_opportunities
    where created_at > $1::timestamptz - interval '7 days' and qualification <> 'rejected'`, [now.toISOString()])).rows[0]?.n ?? 0;
  const topLeads = (await db.query<{ id: string; run_id: string; name: string; country: string | null; product_name: string; fit_score: number; verification: DashboardLead['verification']; state: string | null }>(
    `select o.id, o.run_id, c.canonical_name as name, c.country, o.product_name, o.fit_score, o.verification,
       (select t.state from funnel_threads t where t.opportunity_id=o.id and t.mode<>'email_test' order by t.created_at desc limit 1) as state
     from search_opportunities o join companies c on c.id=o.company_id join leads l on l.id=o.lead_id
     where o.qualification<>'rejected' and not l.is_sample and o.created_at > $1::timestamptz - interval '7 days'
     order by o.fit_score desc, o.created_at desc limit 10`, [now.toISOString()])).rows
    .map((r) => ({ opportunityId: r.id, runId: r.run_id, name: r.name, country: r.country, product: r.product_name, fit: Number(r.fit_score) || 0, verification: r.verification,
      email: r.state ? EMAIL_LABELS[r.state] ?? r.state : null }));
  const ai = await aiAllowance(db, groqBlockedModels()).catch(() => null);
  const allowance = ai?.groq ? { models: ai.models, left: ai.left } : { models: [], left: 0 };
  const kindOf = (r: RunRow) => searchKind(r.status, r.counters ?? {});
  const meetings: DashboardMeeting[] = threads.filter((t) => t.state === 'meeting_booked')
    .map((t) => ({ opportunityId: t.opportunity_id, company: t.company, product: t.product, start: t.meeting_start, meetUrl: t.meet_url }))
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  return {
    searches,
    earlierSearches: all.filter((r) => !r.adhoc_query?.productId),
    actions: {
      review: threads.filter((t) => t.state === 'review').length,
      meetings,
      nextMeeting: meetings.find((m) => m.start && Date.parse(m.start) > now.getTime()) ?? null,
      inProgress: threads.filter((t) => IN_PROGRESS.has(t.state)).length,
      newBuyers,
      toCheck: searches.reduce((n, s) => n + (s.toCheck ?? 0), 0),
      running: productSearches.filter((r) => kindOf(r) === 'running').map((r) => ({ id: r.id, label: r.adhoc_query?.query ?? 'Search' })),
      paused: productSearches.filter((r) => kindOf(r) === 'paused').map((r) => ({ id: r.id, label: r.adhoc_query?.query ?? 'Search' })),
      toVerify: searches.reduce((n, s) => n + s.likely, 0),
    },
    pipeline: {
      found: searches.reduce((n, s) => n + (s.found ?? 0), 0),
      buyers: productSearches.reduce((n, r) => n + r.result_count, 0),
      verified: searches.reduce((n, s) => n + s.verified, 0),
      likely: searches.reduce((n, s) => n + s.likely, 0),
      emailed: threads.filter((t) => t.state !== 'review' && t.state !== 'qualifying' && t.state !== 'needs_contact').length,
      replied: threads.filter((t) => REPLIED.has(t.state)).length,
      meetings: meetings.length,
    },
    latestSearchId: productSearches[0]?.id ?? null,
    topLeads,
    allowance,
  };
}
