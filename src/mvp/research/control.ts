/**
 * Search control (docs/mvp/18 §9): pause, resume and finish a running search, and pause it on its own
 * once it has saved the number of leads the user asked for.
 *
 * - Pause: no new step starts; steps already running finish and keep their results (owned() accepts a
 *   paused search). Nothing is cancelled, so Resume carries on from the same saved work.
 * - Finish now: the remaining work is cancelled, likely buyers already rated are saved as leads (no AI
 *   call), and the search is marked finished, so automatic email can start.
 */
import type { Db } from '@/mvp/db';
import type { RunInput } from '@/mvp/types';
import { researchProgress } from './store';
import { saveLikelyBuyers } from './likely';

const ACTIVE_RUN = "r.id=s.run_id and r.status in ('queued','running')";

/** Pause a running search. False when it was not running. */
export async function pauseResearchRun(db: Db, runId: string, reason = 'Paused by you.'): Promise<boolean> {
  const paused = (await db.query<{ run_id: string }>(`update research_sessions s set state='paused',stop_reason=$2,updated_at=now()
    from runs r where s.run_id=$1 and s.state='active' and ${ACTIVE_RUN} returning s.run_id`, [runId, reason])).rows.length > 0;
  if (paused) await researchProgress(db, runId, 'info', `${reason} Nothing new starts; steps already running finish. Leads found so far are kept.`);
  return paused;
}

/** Resume a paused search from where it stopped. False when it was not paused. */
export async function resumePausedRun(db: Db, runId: string): Promise<boolean> {
  const resumed = await db.tx(async (tx) => {
    const session = (await tx.query<{ generation: number }>(`update research_sessions s set state='active',stop_reason=null,generation=s.generation+1,updated_at=now()
      from runs r where s.run_id=$1 and s.state='paused' and ${ACTIVE_RUN} returning s.generation`, [runId])).rows[0];
    if (!session) return false;
    // Hosted workers are woken through the outbox; the local worker simply claims the queued steps.
    await tx.query(`insert into research_outbox(run_id,job_id,dedupe_key) select run_id,id,'job:'||id||':unpause:'||$2 from research_jobs
      where run_id=$1 and state='queued' on conflict do nothing`, [runId, String(session.generation)]);
    return true;
  });
  if (resumed) await researchProgress(db, runId, 'info', 'Resumed. The search carries on from where it stopped.');
  return resumed;
}

/** Finish a running or paused search now, keeping everything found. False when it was not running. */
export async function finishResearchNow(db: Db, runId: string): Promise<boolean> {
  const finished = await db.tx(async (tx) => {
    const session = (await tx.query(`update research_sessions s set state='done',stop_reason='Finished early by you.',updated_at=now()
      from runs r where s.run_id=$1 and s.state in ('active','paused') and ${ACTIVE_RUN} returning s.run_id`, [runId])).rows[0];
    if (!session) return false;
    // A step still running finishes, but its result is discarded (owned() needs a running job).
    await tx.query(`update research_jobs set state='cancelled',lease_token=null,lease_until=null,updated_at=now() where run_id=$1 and state in ('queued','paused','running')`, [runId]);
    await tx.query(`update runs set status='done',finished_at=now(),error=null where id=$1`, [runId]);
    return true;
  });
  if (!finished) return false;
  const input = (await db.query<{ adhoc_query: RunInput }>('select adhoc_query from runs where id=$1', [runId])).rows[0]?.adhoc_query;
  const likely = input?.productId ? await saveLikelyBuyers(db, runId, input).catch(() => ({ saved: 0, listing: 0 })) : { saved: 0, listing: 0 };
  await researchProgress(db, runId, 'done', `Finished early by you.${likely.saved ? ` Saved ${likely.saved} more likely ${likely.saved === 1 ? 'buyer' : 'buyers'} as leads.` : ''} Everything found so far is kept.`);
  return true;
}

/** Leads saved by a search so far (verified and likely). */
export async function leadsSaved(db: Db, runId: string): Promise<number> {
  return (await db.query<{ n: number }>("select count(*)::int as n from search_opportunities where run_id=$1 and qualification<>'rejected'", [runId])).rows[0].n;
}

/**
 * Pause once the search has saved the number of leads asked for ("Pause after 10 leads"). Happens once
 * per search: after Resume it runs to the end.
 */
export async function autoPauseIfDue(db: Db, runId: string): Promise<boolean> {
  const row = (await db.query<{ input: RunInput; budget: { autoPaused?: boolean } }>(`select r.adhoc_query as input,s.budget from research_sessions s join runs r on r.id=s.run_id
    where s.run_id=$1 and s.state='active' and r.status in ('queued','running')`, [runId])).rows[0];
  const wanted = row?.input?.pauseAfter;
  if (!row || !wanted || row.budget.autoPaused) return false;
  const saved = await leadsSaved(db, runId);
  if (saved < wanted) return false;
  await db.query(`update research_sessions set budget=budget||'{"autoPaused":true}'::jsonb where run_id=$1`, [runId]);
  return pauseResearchRun(db, runId, `Paused at ${saved} leads, as you asked. Review them, then resume or finish.`);
}
