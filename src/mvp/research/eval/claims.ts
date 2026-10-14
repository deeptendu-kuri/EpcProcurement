/**
 * Claims golden set (docs/mvp/22 §3.16): is each saved buyer a true claim? Real claims from live runs, hand-labelled,
 * replayed through the current need-check rules. Pure: give it the set and (optionally) the AI's answers.
 */
import type { SearchBrief } from '@/mvp/discovery/brief';
import { judgeNeed } from '../need';
import { sameCompanyName } from '../company-names';

export type ClaimTruth = 'buyer' | 'potential' | 'not_buyer';
export interface ClaimRow {
  id: string; productId: string; query: string; markets: string[]; brief: string;
  /** What the AI said about this company on this source. */
  company: string; role: string; use: string | null; country: string; date: string | null; quote: string;
  source: { url: string; title: string | null; publishedAt: string | null; text: string };
  truth: ClaimTruth; expect: 'lead' | 'reject'; note: string;
  /** A real buyer the rules do not find yet (recall work), with why. */
  knownMiss?: string;
}
export interface ClaimsGolden { checkedAt: string; briefs: Record<string, SearchBrief>; rows: ClaimRow[] }
export interface ClaimResult { id: string; company: string; expect: 'lead' | 'reject'; got: 'lead' | 'reject'; reason: string; truth: ClaimTruth; knownMiss?: string }
export interface ClaimsScore {
  rows: number; leads: number; trueLeads: number; falseLeads: ClaimResult[]; missed: ClaimResult[];
  /** Saved leads that are true claims (the client's measure). */
  precision: number;
  /** True buyers that became leads. */
  recall: number;
}

/** The AI answer as the live run recorded it (role, use, country, date), for this one company. */
export function recordedAnswer(r: ClaimRow): string {
  return JSON.stringify({ project: null, country: r.country, date: r.date, use: r.use, needsItem: 'yes', needWhy: r.note,
    companies: [{ name: r.company, role: r.role, package: r.note, quote: r.quote, since: null, buysItem: 'yes' }] });
}

/** Replay one claim through the current rules; `answer` is a live AI answer (EVAL_LIVE) or the recorded one. */
export function replayClaim(set: ClaimsGolden, r: ClaimRow, answer = recordedAnswer(r)): ClaimResult {
  const brief = set.briefs[r.brief];
  const text = `${r.source.title ?? ''}\n${r.source.text}`;
  const result = judgeNeed(answer, { text, title: r.source.title, publishedAt: r.source.publishedAt, url: r.source.url }, brief, r.markets, new Date(set.checkedAt));
  const c = result?.companies.find((x) => sameCompanyName(x.name, r.company));
  const got = c?.verdict === 'lead' ? 'lead' : 'reject';
  return { id: r.id, company: r.company, expect: r.expect, got, reason: c?.reason ?? (result ? 'company not in the answer' : 'unreadable answer'), truth: r.truth, ...(r.knownMiss ? { knownMiss: r.knownMiss } : {}) };
}

export function scoreClaims(results: ClaimResult[]): ClaimsScore {
  const leads = results.filter((r) => r.got === 'lead');
  const trueLeads = leads.filter((r) => r.expect === 'lead');
  const shouldLead = results.filter((r) => r.expect === 'lead');
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    rows: results.length, leads: leads.length, trueLeads: trueLeads.length,
    falseLeads: leads.filter((r) => r.expect === 'reject'),
    missed: shouldLead.filter((r) => r.got === 'reject'),
    precision: round(leads.length ? trueLeads.length / leads.length : 1),
    recall: round(shouldLead.length ? trueLeads.length / shouldLead.length : 1),
  };
}
