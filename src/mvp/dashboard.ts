/**
 * Dashboard read model: the action plan (what needs the user today), every search with its progress,
 * and the pipeline from companies found to meetings. Read-only; never starts research or email.
 */
import { getDb } from '@/mvp/db';
import { recentSearches } from '@/mvp/opportunities';
import { searchWorkflowCounts } from '@/mvp/opportunities/workspace-stats';
import { listFoundCompanies } from '@/mvp/research/found';
import { listFunnelThreads } from '@/mvp/automation/engine';
import type { RunRow } from '@/mvp/types';

export interface DashboardSearch {
  run: RunRow & { result_count: number };
  /** Work-related companies found; null for older searches not counted on the dashboard. */
  found: number | null;
  toCheck: number | null;
  conversations: number;
  meetings: number;
}
export interface DashboardMeeting { opportunityId: string | null; company: string; product: string; start: string | null; meetUrl: string | null }
export interface DashboardData {
  searches: DashboardSearch[];
  earlierSearches: (RunRow & { result_count: number })[];
  actions: { review: number; meetings: DashboardMeeting[]; nextMeeting: DashboardMeeting | null; inProgress: number; newBuyers: number; toCheck: number; running: { id: string; label: string }[] };
  pipeline: { found: number; buyers: number; emailed: number; replied: number; meetings: number };
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
  const searches: DashboardSearch[] = [];
  for (const [index, run] of productSearches.entries()) {
    let found: number | null = null, toCheck: number | null = null;
    if (index < COUNTED_SEARCHES) {
      const list = (await listFoundCompanies(db, run.id).catch(() => [])).filter((c) => c.relevant);
      found = list.length;
      toCheck = list.filter((c) => c.status !== 'saved' && c.status !== 'no_match').length;
    }
    const w = workflows.find((x) => x.run_id === run.id);
    searches.push({ run, found, toCheck, conversations: w?.workflow_count ?? 0, meetings: w?.meeting_count ?? 0 });
  }
  const threads = (await listFunnelThreads().catch(() => [])).filter((t) => t.mode !== 'email_test');
  const newBuyers = (await db.query<{ n: number }>(`select count(*)::int as n from search_opportunities
    where created_at > $1::timestamptz - interval '7 days' and qualification <> 'rejected'`, [now.toISOString()])).rows[0]?.n ?? 0;
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
      running: productSearches.filter((r) => r.status === 'running' || r.status === 'queued').map((r) => ({ id: r.id, label: r.adhoc_query?.query ?? 'Search' })),
    },
    pipeline: {
      found: searches.reduce((n, s) => n + (s.found ?? 0), 0),
      buyers: productSearches.reduce((n, r) => n + r.result_count, 0),
      emailed: threads.filter((t) => t.state !== 'review' && t.state !== 'qualifying' && t.state !== 'needs_contact').length,
      replied: threads.filter((t) => REPLIED.has(t.state)).length,
      meetings: meetings.length,
    },
    latestSearchId: productSearches[0]?.id ?? null,
  };
}
