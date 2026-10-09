/**
 * Every company a search named — from contractor lists, award news or its own pages — shown at once,
 * before its website, work and contacts are checked. Unchecked fields stay empty; "Check now" queues
 * the same evidence checks the search uses, so a listed company is never presented as a verified buyer.
 */
import type { Db, Queryable } from '@/mvp/db';
import type { RawDoc } from '@/mvp/pipeline/contracts';
import { MODE_BUDGETS } from '@/mvp/discovery/plan';
import { addJob, researchProgress } from './store';
import { queueRead } from './investigation';
import { researchAiAllowance, type ExtendableBudget } from './extend';
import { looksLikeSupplier, relevantFound } from '@/mvp/sourcing/names';

export type FoundStatus = 'saved' | 'checking' | 'not_checked' | 'no_website' | 'no_match' | 'unreadable';
export interface FoundCompany {
  id: string; name: string; website: string | null; status: FoundStatus; statusText: string;
  source: { title: string | null; url: string | null } | null; quote: string | null; pagesRead: number;
  opportunityId: string | null;
  /** False for names that only appear in page furniture: finance widgets, publishers, unrelated articles. */
  relevant: boolean;
  /** A hint from the source wording only; never a verified role. */
  likelyRole: LikelyRole | null;
}
export type LikelyRole = 'owner' | 'contractor' | 'pipe_maker' | 'supplier';
// "GASCO, Abu Dhabi" and "GASCO" are one company: the place after a comma is not part of the name.
// "(KPIL)" is a short form, not part of the name, so "… Ltd (KPIL)" and "… Limited" match.
const key = (name: string) => name.split(',')[0].replace(/\([^)]*\)/g, ' ').toLowerCase().replace(/\b(?:ltd|limited|llc|l\.l\.c|pvt|private|inc|plc|co|company|corporation|corp)\b\.?/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Likely role from how the source names the company: "Pipeline Project for GAIL" (the project owner, who
 * often buys line pipe directly), a pipe mill or pipe order (a manufacturer, possibly a competitor), or
 * construction and EPC wording (a contractor). Unknown stays empty.
 */
export function likelyRole(name: string, quote: string | null): LikelyRole | null {
  const q = quote ?? '';
  const short = name.split(/\s*[,(]/)[0].trim();
  if (looksLikeSupplier(q)) return 'supplier';
  if (/\b(?:pipes?|tubulars?|tubes?)\b/i.test(name) || /\b(?:pipe|tube)s?\b[^.]{0,30}\b(?:order|maker|manufactur\w*|mills?)\b/i.test(q)) return 'pipe_maker';
  const owner = [name, short].filter((n) => n.length >= 3).some((n) =>
    new RegExp(`\\b(?:projects?|pipelines?|contracts?|orders?|network)\\b[^.]{0,80}?\\b(?:for|of|with|from|by)\\s+(?:the\\s+)?${escapeRe(n)}`, 'i').test(q));
  if (owner) return 'owner';
  if (/\b(?:construct\w*|contract\w*|EPC|engineer\w*|infrastructure|builders?|projects)\b/i.test(`${name} ${q}`)) return 'contractor';
  return null;
}

interface CandidateRow {
  id: string; company: string; domain_hint: string | null; state: string; reason: string | null; identity_quote: string | null;
  pages: number; title: string | null; url: string | null; pending: boolean;
}
const LIMIT_REASON = /budget|deferred|limit/i;
export { relevantFound };

export async function listFoundCompanies(db: Queryable, runId: string): Promise<FoundCompany[]> {
  const rows = (await db.query<CandidateRow>(`select c.id,c.company,c.domain_hint,c.state,c.reason,c.identity_quote,cardinality(c.document_ids)::int as pages,d.title,d.url,
      exists(select 1 from research_jobs j where j.run_id=c.run_id and j.state in ('queued','running')
        and (j.payload->>'candidateId'=c.id::text or j.payload->'raw'->'research'->>'candidateId'=c.id::text)) as pending
    from research_candidates c left join source_documents d on d.id=c.identity_document_id
    where c.run_id=$1 order by c.created_at limit 300`, [runId])).rows;
  const saved = (await db.query<{ id: string; name: string }>(`select o.id,c.canonical_name as name from search_opportunities o join companies c on c.id=o.company_id
    where o.run_id=$1 and o.qualification<>'rejected'`, [runId])).rows;
  const savedBy = new Map(saved.map((s) => [key(s.name), s.id]));
  const seen = new Set<string>();
  const result: FoundCompany[] = [];
  for (const r of rows) {
    const k = key(r.company);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const opportunityId = savedBy.get(k) ?? null;
    const [status, statusText]: [FoundStatus, string] = opportunityId ? ['saved', 'Saved as a buyer']
      : r.pending ? ['checking', 'Checking now']
      : r.state === 'unreadable' ? ['unreadable', 'Website could not be read']
      : r.state === 'review' && /website not confirmed/i.test(r.reason ?? '') ? ['no_website', 'Website not confirmed']
      : r.state === 'review' && /no search result matched/i.test(r.reason ?? '') ? ['no_website', 'Own website not found']
      : r.state === 'review' && /website not established/i.test(r.reason ?? '') ? (r.domain_hint ? ['not_checked', 'Website found · not read yet'] : ['no_website', 'Website not found yet'])
      // Check now started but nothing is queued or done any more: the last step ended without a result.
      : r.state === 'investigating' && !r.pages && r.domain_hint ? ['unreadable', 'Website checked · no company page']
      : r.state === 'review' && !LIMIT_REASON.test(r.reason ?? '') ? ['no_match', r.reason ?? 'No matching work found on its pages']
      : r.state === 'qualified' ? ['no_match', 'Matched, but not saved for this product or country']
      : ['not_checked', 'Not checked yet'];
    result.push({ id: r.id, name: r.company, website: r.domain_hint, status, statusText, source: r.url ? { title: r.title, url: r.url } : null,
      quote: r.identity_quote, pagesRead: r.pages, opportunityId,
      // Suppliers of the material are competitors, not buyers: folded with the other non-buyer names.
      relevant: relevantFound(r.company, r.identity_quote, r.domain_hint, Boolean(opportunityId), r.title) && (Boolean(opportunityId) || !looksLikeSupplier(r.identity_quote)),
      likelyRole: likelyRole(r.company, r.identity_quote) });
  }
  return result;
}

interface Candidate { id: string; company: string; domain_hint: string | null; document_ids: string[]; state: string; reason: string | null }
/** Queue the next real step for one company: analyse read pages, read its website, or find its website. */
export async function queueCandidateCheck(tx: Queryable, runId: string, c: Candidate, budget: { maxPages: number }): Promise<boolean> {
  const requeue = async (where: string, params: unknown[]) => (await tx.query(`update research_jobs set state='queued',result=null,error=null,attempts=0,
      lease_token=null,lease_until=null,available_at=now(),updated_at=now() where run_id=$1 and state in ('done','paused','failed') and ${where} returning id`, [runId, ...params])).rows.length > 0;
  let queued = false;
  if (!c.document_ids.length && c.domain_hint) {
    // Its looked-up site was already read and gave no company page: drop that guess and search again.
    const read = (await tx.query("select 1 from research_jobs where run_id=$1 and stage='read' and key=$2 and state='done' and not (result ? 'skipped')", [runId, `https://${c.domain_hint}/`])).rows.length > 0;
    if (read) { await tx.query('update research_candidates set domain_hint=null where id=$1', [c.id]); c = { ...c, domain_hint: null }; }
  }
  if (c.document_ids.length) {
    queued = Boolean(await addJob(tx, runId, 'analyse', `bundle:${c.id}`, { candidateId: c.id }, 30))
      || await requeue(`stage='analyse' and key=$2 and (result ? 'skipped' or state<>'done')`, [`bundle:${c.id}`]);
  } else if (c.domain_hint) {
    const raw: RawDoc = { sourceKey: 'company-investigation', sourceName: c.company, tier: 'B', url: `https://${c.domain_hint}/`, title: null, publishedAt: null, text: null, isSample: false,
      research: { lane: 'investigation', candidateId: c.id, sourcingLane: 'roundup' } };
    queued = await requeue(`stage='read' and key=$2 and (result ? 'skipped' or state<>'done')`, [raw.url]) || await queueRead(tx, runId, raw, budget, 46);
  } else {
    queued = Boolean(await addJob(tx, runId, 'collect', `official:${c.id}`, { source: 'roundup-website', candidateId: c.id, sourcingLane: 'roundup' }, 760))
      // A repeated lookup reuses the cached search results, so it costs no new search credit.
      || await requeue(`stage='collect' and key=$2`, [`official:${c.id}`]);
  }
  if (queued) await tx.query("update research_candidates set state='investigating',reason=null,updated_at=now() where id=$1", [c.id]);
  return queued;
}

/** Companies parked only because a reading limit was hit get their next step queued again. */
export async function requeueDeferredCandidates(db: Db, runId: string, budget: { maxPages: number }): Promise<number> {
  const deferred = (await db.query<Candidate>(`select id,company,domain_hint,document_ids,state,reason from research_candidates
    where run_id=$1 and state='review' and coalesce(reason,'') ~* '(budget|deferred)' order by created_at limit 40`, [runId])).rows;
  let queued = 0;
  for (const c of deferred) if (await db.tx((tx) => queueCandidateCheck(tx, runId, c, budget))) queued++;
  return queued;
}

/** "Check now" for one listed company: a small extra allowance, then the normal evidence checks. */
export async function checkFoundCompany(db: Db, runId: string, candidateId: string): Promise<{ queued: boolean; message: string }> {
  const c = (await db.query<Candidate>('select id,company,domain_hint,document_ids,state,reason from research_candidates where id=$1 and run_id=$2', [candidateId, runId])).rows[0];
  if (!c) throw new Error('Company not found in this search.');
  const allowance = await researchAiAllowance(db);
  if (allowance < 8_000) return { queued: false, message: "Today's AI allowance is kept for email replies. Try again tomorrow." };
  const queued = await db.tx(async (tx) => {
    const session = (await tx.query<{ budget: ExtendableBudget }>('select budget from research_sessions where run_id=$1 for update', [runId])).rows[0];
    if (!session) throw new Error('This search has no saved research to continue.');
    const deep = MODE_BUDGETS.deep, b = session.budget;
    // Room for this company's own website search, a few pages and one AI analysis.
    const next = { ...b, searchQueries: Math.min(deep.searchQueries, b.searchQueries + 1), maxPages: Math.min(deep.maxPages, b.maxPages + 4),
      maxAiPages: Math.min(deep.maxAiPages, b.maxAiPages + 1), maxAiTokens: Math.min(deep.maxAiTokens, b.maxAiTokens + Math.min(15_000, allowance)) };
    await tx.query('update research_sessions set budget=$2::jsonb where run_id=$1', [runId, JSON.stringify(next)]);
    const ok = await queueCandidateCheck(tx, runId, c, next);
    if (ok) {
      await tx.query("update research_sessions set state='active',stop_reason=null,updated_at=now() where run_id=$1 and state<>'cancelled'", [runId]);
      await tx.query("update runs set status='running',finished_at=null where id=$1 and status in ('done','failed')", [runId]);
    }
    return ok;
  });
  if (queued) await researchProgress(db, runId, 'info', `Checking ${c.company}: website, work and contacts. It is not a buyer until its own pages show matching work.`);
  return { queued, message: queued ? `Checking ${c.company}. Results appear here and in the tables when done.` : `${c.company} was already checked; see its status.` };
}

/** "Check next 5": the same per-company check for several listed companies, stopping if the AI allowance runs out. */
export async function checkFoundCompanies(db: Db, runId: string, candidateIds: string[]): Promise<{ queued: number; message: string }> {
  let queued = 0, last = '';
  for (const id of candidateIds) {
    const result = await checkFoundCompany(db, runId, id);
    if (result.queued) queued++;
    else { last = result.message; if (/allowance/i.test(result.message)) break; }
  }
  return { queued, message: queued ? `Checking ${queued} ${queued === 1 ? 'company' : 'companies'}: website, work and contacts. Results appear here as each finishes.` : last || 'Nothing left to check.' };
}
