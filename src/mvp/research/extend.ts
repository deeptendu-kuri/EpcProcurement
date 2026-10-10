/**
 * Keep researching until a minimum number of buyers is saved (default 2).
 *
 * When a search settles with fewer saved buyers than the minimum, the work it skipped only because a
 * limit was reached (searches, page reads, AI analyses) is queued again under a larger budget. Each
 * extension round adds the search's original budget once more, never beyond the "deep" ceiling, and
 * always leaves a share of the daily AI allowance for email replies. Nothing is invented: rounds only
 * re-run real collection, reading and evidence checks.
 */
import type { Db } from '@/mvp/db';
import { MODE_BUDGETS } from '@/mvp/discovery/plan';
import { mvpEnv } from '@/mvp/config/env';
import { QUOTA_HEADROOM, dailyBudget, usedToday } from '@/mvp/llm/quota';
import { researchProgress, type ResearchBudget } from './store';

type Limits = Pick<ResearchBudget, 'searchQueries' | 'bingQueries' | 'maxPages' | 'maxAiPages' | 'maxAiTokens'>;
export type ExtendableBudget = ResearchBudget & { extensions?: number; base?: Limits };
const LIMIT_KEYS = ['searchQueries', 'bingQueries', 'maxPages', 'maxAiPages', 'maxAiTokens'] as const;

import { emailAiReserve, maxExtensionRounds, minimumBuyers } from './limits';
export { emailAiReserve, maxExtensionRounds, minimumBuyers };

/** Next round's limits: the original budget added once more, capped at the deep-mode ceiling. */
export function extendedBudget(budget: ExtendableBudget, aiTokenAllowance = Number.POSITIVE_INFINITY): ExtendableBudget {
  const base: Limits = budget.base ?? Object.fromEntries(LIMIT_KEYS.map((k) => [k, budget[k]])) as Limits;
  const ceiling = MODE_BUDGETS.deep;
  const next = { ...budget, base, extensions: (budget.extensions ?? 0) + 1 };
  // A limit set to 0 means that source is switched off; it stays off.
  for (const key of LIMIT_KEYS) next[key] = Math.min(ceiling[key], budget[key] + base[key]);
  next.maxAiTokens = Math.min(next.maxAiTokens, budget.maxAiTokens + Math.max(0, Math.floor(aiTokenAllowance)));
  return next;
}

/** AI tokens this server may still spend today on research, after the email reserve. */
export async function researchAiAllowance(db: Db): Promise<number> {
  if (!mvpEnv.groqApiKey()) return Number.POSITIVE_INFINITY; // mock/offline provider costs nothing
  const budget = dailyBudget('groq');
  if (!Number.isFinite(budget)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(budget * (1 - QUOTA_HEADROOM)) - (await usedToday('groq', db)) - emailAiReserve());
}

/** Jobs that ended only because a limit was reached; re-running them repeats no paid request. */
const SKIPPED_FOR_LIMIT = `run_id=$1 and (
    state='done' and result ? 'skipped' and coalesce((result->>'budgetLimited')::boolean,false)
    or state='paused' and coalesce(error,'') ~* 'budget exhausted')`;

/**
 * Called when a search has no runnable work left. Returns true when it queued another round, in
 * which case the search stays active.
 */
export async function extendResearchIfShort(db: Db, runId: string): Promise<boolean> {
  const session = (await db.query<{ state: string; budget: ExtendableBudget & { targetCompanies?: number } }>('select state,budget from research_sessions where run_id=$1', [runId])).rows[0];
  const minimum = minimumBuyers(session?.budget.targetCompanies);
  if (minimum === 0) return false;
  // Verified buyers count; likely buyers saved from the shortlist alone do not stop the search.
  const saved = (await db.query<{ count: number }>(
    "select count(*)::int as count from search_opportunities where run_id=$1 and qualification<>'rejected' and verification<>'rating'", [runId])).rows[0].count;
  if (saved >= minimum) return false;
  const run = (await db.query<{ status: string }>('select status from runs where id=$1', [runId])).rows[0];
  if (!session || session.state !== 'active' || !run || run.status === 'cancelled') return false;
  const rounds = session.budget.extensions ?? 0;
  // The search's own choice (Quick = 0, Standard = 1) never exceeds the server setting.
  const allowed = Math.min(maxExtensionRounds(), (session.budget as { extraRounds?: number }).extraRounds ?? Number.POSITIVE_INFINITY);
  if (rounds >= allowed) {
    await researchProgress(db, runId, 'info', allowed === 0 ? `Quick search: finished with ${saved} verified buyer(s) and no extra rounds. Resume or run a Standard search to look further.`
      : `Stopped after ${rounds} extra rounds with ${saved} buyer(s) saved. Raise MVP_RESEARCH_EXTENSION_ROUNDS to search longer.`);
    return false;
  }
  const allowance = await researchAiAllowance(db);
  if (allowance < 8_000) {
    await researchProgress(db, runId, 'info', `Only ${saved} buyer(s) saved, but today's AI allowance is kept for email replies. Search again tomorrow or raise the AI allowance.`);
    return false;
  }
  const next = extendedBudget(session.budget, allowance);
  const grew = (key: (typeof LIMIT_KEYS)[number]) => next[key] > session.budget[key];
  // Only work whose own limit grows is re-run; a limit set to 0 (a switched-off source) never repeats.
  const lanes = [
    grew('searchQueries') ? "stage='collect' and coalesce(result->>'skipped','') ~* '(tavily|official-site) query budget'" : '',
    grew('bingQueries') ? "stage='collect' and coalesce(result->>'skipped','') ~* 'bing query budget'" : '',
    grew('maxPages') ? "stage='read'" : '',
    grew('maxAiPages') && grew('maxAiTokens') ? "stage='analyse'" : '',
  ].filter(Boolean);
  const runnable = lanes.length ? `${SKIPPED_FOR_LIMIT} and ((${lanes.join(') or (')}))` : 'false';
  const skipped = (await db.query<{ count: number }>(`select count(*)::int as count from research_jobs where ${runnable}`, [runId])).rows[0].count;
  const deferred = grew('maxPages') ? (await db.query<{ count: number }>(
    "select count(*)::int as count from research_jobs where run_id=$1 and stage='collect' and state='done' and coalesce((result->>'deferred')::int,0)>0", [runId])).rows[0].count : 0;
  const parked = grew('maxPages') ? (await db.query<{ count: number }>(
    "select count(*)::int as count from research_candidates where run_id=$1 and state='review' and coalesce(reason,'') ~* '(budget|deferred)'", [runId])).rows[0].count : 0;
  if (!skipped && !deferred && !parked) return false; // nothing a larger budget would change
  await db.tx(async (tx) => {
    await tx.query('update research_sessions set budget=$2::jsonb,stop_reason=null,updated_at=now() where run_id=$1', [runId, JSON.stringify(next)]);
    await tx.query(`update research_jobs set state='queued',result=null,error=null,attempts=0,lease_token=null,lease_until=null,available_at=now(),updated_at=now()
      where ${runnable}`, [runId]);
    // Buyers come from checking companies already named, then from direct company searches;
    // more news and list queries mostly add names. Spend the extra searches in that order.
    // Order: find a found company's website → read it → judge it → direct company searches;
    // reading more list pages (which only adds names) comes last.
    await tx.query(`update research_jobs set priority=case
        when stage='collect' and key like 'official:%' then 2300
        when stage='read' and payload->'raw'->'research'->>'lane'='investigation' then 2250
        when stage='analyse' and payload ? 'candidateId' then 2240
        when stage='collect' and payload->>'sourcingLane'='capability' then 2200
        when stage='analyse' and payload->>'kind'='analyse:roundup' then 100
        else priority end
      where run_id=$1 and state='queued'`, [runId]);
  });
  // Companies parked by a reading limit get their website read again (imported lazily: found.ts uses this module).
  if (parked) await (await import('./found')).requeueDeferredCandidates(db, runId, next);
  await researchProgress(db, runId, 'info',
    `Only ${saved} buyer(s) saved so far; searching further (round ${next.extensions} of ${Math.min(maxExtensionRounds(), (session.budget as { extraRounds?: number }).extraRounds ?? Number.POSITIVE_INFINITY)}): up to ${next.searchQueries} web searches, ${next.maxPages} pages and ${next.maxAiTokens.toLocaleString('en-US')} AI tokens.`);
  return true;
}

/**
 * A per-minute provider limit (HTTP 429) is not a daily quota: the request was refused, not charged.
 * Release this job's unfinished AI reservations and try it again after a pause instead of ending the
 * search. Daily quota errors still stop the search as before.
 */
export async function retryAfterRateLimit(db: Db, job: { id: string; run_id: string; lease_token: string | null; payload: Record<string, unknown> }, delaySeconds = 70, message?: string) {
  const documentId = typeof job.payload.documentId === 'string' ? job.payload.documentId : '';
  const candidateId = typeof job.payload.candidateId === 'string' ? job.payload.candidateId : '';
  await db.tx(async (tx) => {
    await tx.query(`delete from research_budget_reservations where run_id=$1 and kind in ('ai_pages','ai_tokens') and coalesce(outcome,'')<>'completed'
      and (($2<>'' and (key=$2 or key like 'award:'||$2||':%')) or ($3<>'' and key like 'bundle:%:'||$3||':%'))`, [job.run_id, documentId, candidateId]);
    await tx.query(`update research_jobs set state='queued',lease_token=null,lease_until=null,available_at=now()+make_interval(secs=>$3),updated_at=now()
      where id=$1 and lease_token=$2`, [job.id, job.lease_token, delaySeconds]);
  });
  await researchProgress(db, job.run_id, 'info', message ?? `AI provider is busy (per-minute limit); this step retries in about ${delaySeconds} seconds.`);
}
