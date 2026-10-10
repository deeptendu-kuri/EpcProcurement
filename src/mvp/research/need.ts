/**
 * The need check (docs/mvp/20 stage 5–7): for one award article or company page in a work-search run, would the
 * work buy the searched item, and what is each named company's role in it, with the exact sentence. Only a
 * company that does the work (EPC, construction partner, subcontractor, maintenance contractor) on work that
 * needs the item, in his countries, within 18 months, with a verified sentence, becomes a lead.
 *
 * The rules come from 13 prototype runs on 10 Oct (cryogenic valves, HDPE pipe, stud bolts; UAE, Saudi Arabia,
 * India, Norway); their numbers below refer to docs/mvp/20 §7b.
 */
import type { Queryable } from '@/mvp/db';
import type { LLMProvider } from '@/mvp/llm';
import { firstJsonObject } from '@/mvp/llm/groq';
import { verifyQuote } from '@/mvp/pipeline/quote-check';
import { detectCountry, detectMarkets } from '@/mvp/pipeline/filter';
import type { SearchBrief } from '@/mvp/discovery/brief';
import { companyKey, initialsOf, sameCompanyName } from './company-names';

export type NeedRole = 'owner' | 'developer' | 'epc' | 'jv_partner' | 'subcontractor' | 'maintenance_contractor' | 'seller_of_item' | 'other_supplier' | 'consultant' | 'investor' | 'other';
export type Verdict = 'lead' | 'owner' | 'rejected';
export interface NeedCompany { name: string; role: NeedRole; package: string; quote: string; quoteVerified: boolean; since: string | null; verdict: Verdict; reason: string }
export interface NeedResult {
  project: string | null; country: string | null; market: string | null; date: string | null; use: string | null;
  needsItem: 'yes' | 'no' | 'unclear'; needWhy: string; companies: NeedCompany[];
}

const ROLES = new Set<NeedRole>(['owner', 'developer', 'epc', 'jv_partner', 'subcontractor', 'maintenance_contractor', 'seller_of_item', 'other_supplier', 'consultant', 'investor', 'other']);
/** Roles that buy the material for the work. */
const DOES_WORK = new Set<NeedRole>(['epc', 'jv_partner', 'subcontractor', 'maintenance_contractor']);
/** Makers and traders are recognised by trade words, never by the item's own words (§4 check 3). */
const SELLER = /\b(?:manufactur\w*|mills?|trading|traders?|stockists?|distribut\w*|dealers?|makers?)\b/i;
const STAKE = /\b(?:stake|shareholding|equity|acquir\w*|acquisition|invest(?:s|ed|ment|or)?)\b/i;
const WORK = /\b(?:EPC\w*|contract\w*|construct\w*|build\w*|install\w*|fabricat\w*|engineering|maintenance|services)\b/i;
// Rule 14: an engineering-only package (detailed engineering, FEED, design) buys no material.
const ENGINEERING_ONLY = /\b(?:detailed|front[- ]end|basic|FEED|pre-?FEED|design|consultancy|engineering services|engineering contract|engineering role)\b/i;
const BUYS_MATERIAL = /\b(?:EPC\w*|procurement|construct\w*|install\w*|fabricat\w*|build\w*|supply|maintenance)\b/i;
/** Awards older than this have mostly been bought for (as shortlistAwardWinners). */
export const NEED_WINDOW_MONTHS = 18;

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');
/** Does the sentence name this company: its core name (legal suffixes dropped) or its initials? */
export function namesCompany(quote: string, name: string): boolean {
  const core = companyKey(name), plain = quote.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (core.length >= 3 && plain.includes(core)) return true;
  const first = (name.toLowerCase().match(/[\p{L}\p{N}]{4,}/u) ?? [])[0];
  return Boolean(first && plain.includes(first) && first.length >= 5) || (initialsOf(name).length >= 3 && new RegExp(`\\b${initialsOf(name)}\\b`, 'i').test(quote));
}

export function needPrompt(doc: { text: string; url: string; title: string | null; publishedAt: string | null }, brief: SearchBrief): { system: string; user: string } {
  return {
    system: 'Extract facts only from the page text. Never invent. Reply with JSON only.',
    user: `Uses we care about: ${brief.uses.map((u) => u.name).join('; ')}.
Item sold: ${brief.item}${brief.mustHave.length ? ` (must-have: ${brief.mustHave.join(', ')})` : ''}. Not buyers: ${brief.notBuyers.join('; ') || 'none listed'}.
Page (${doc.publishedAt?.slice(0, 10) ?? 'undated'}) ${doc.url}
Title: ${doc.title ?? ''}
Text: ${doc.text.replace(/\s+/g, ' ').trim().slice(0, 4500)}
Return {"project": project name or null, "country": country where the work is done or null, "date": "YYYY-MM" of the announcement or award if the text gives it, else null,
"use": the matching use name from the list, or null if the work is none of them,
"needsItem": judge as a procurement engineer from what the work IS; news never lists valves, pipes or gaskets, so do not require the text to name the item.
  "yes" if the work is one of the uses above (the item is standard in such work) or the text names the item;
  "no" if the work is none of the uses, or the text shows a different material doing that job (e.g. GRE or steel pipe instead of the item);
  "unclear" only if what the work is cannot be told from the text,
"needWhy": one line explaining that verdict,
"companies": [{"name": company, "role": one of owner|developer|epc|jv_partner|subcontractor|maintenance_contractor|seller_of_item|other_supplier|consultant|investor|other, "package": what it does in this work, "quote": one sentence copied character for character from the text (no rewording, no shortening) that names the company and its work, "since": "YYYY" or "YYYY-MM" when the text says when it got this work, else null}]}
Roles: epc = won the engineering, procurement and construction contract; jv_partner = partner in a CONSTRUCTION joint venture that won such a contract; developer = developer, sponsor or shareholder of a concession (IWP, IPP, IWTP), not the builder; owner = owns or operates the plant or field, including equity partners that co-own or co-develop a field or plant with the operator (e.g. oil majors partnering in a field) — they are never jv_partner.
If the page is a company's own page describing its regular work, list that company with role subcontractor or maintenance_contractor and project null.`,
  };
}

/** The country of the work (rule 12: the engine's names and aliases, then the brief's own-language names and hubs). */
export function workMarket(text: string | null, brief: SearchBrief, markets: string[]): string | null {
  if (!text) return null;
  const code = detectCountry(text);
  if (code && markets.includes(code)) return code;
  const named = detectMarkets(text, markets).find((m) => markets.includes(m));
  if (named) return named;
  const lower = text.toLowerCase();
  return markets.find((m) => (brief.places[m] ?? []).some((p) => p.length >= 3 && new RegExp(`(?:^|[^\\p{L}])${p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}])`, 'u').test(lower))) ?? null;
}

/** Rule 3: when the sentence dates the work ("In 2005, …", since), that date counts, not the article's. */
export function workDate(quote: string, since: string | null, articleDate: string | null): string | null {
  if (since && /^\d{4}/.test(since)) return since.length === 4 ? `${since}-06` : since.slice(0, 7);
  const years = [...quote.matchAll(/\b(19\d\d|20\d\d)\b/g)].map((m) => Number(m[1]));
  const article = articleDate ? Number(articleDate.slice(0, 4)) : new Date().getFullYear();
  return years.length && Math.max(...years) < article - 1 ? `${Math.max(...years)}-06` : articleDate?.slice(0, 10) ?? null;
}
const monthsAgo = (date: string | null, now: Date) => (date ? (now.getTime() - Date.parse(date.length === 7 ? `${date}-15` : date)) / 2.63e9 : null);

/** Parse and judge the AI's answer for one page. */
export function judgeNeed(text: string, doc: { text: string; publishedAt: string | null }, brief: SearchBrief, markets: string[], now = new Date()): NeedResult | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(firstJsonObject(text) ?? 'null') as Record<string, unknown>; } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const use = brief.uses.find((u) => u.name === clip(raw.use, 120))?.name ?? null;
  const needsItem = raw.needsItem === 'yes' || raw.needsItem === 'no' ? raw.needsItem : 'unclear';
  const project = clip(raw.project, 160) || null, country = clip(raw.country, 80) || null;
  const market = workMarket(country, brief, markets) ?? (project ? null : workMarket(doc.text.slice(0, 4000), brief, markets));
  const needWhy = clip(raw.needWhy, 300);
  const companies: NeedCompany[] = (Array.isArray(raw.companies) ? raw.companies : []).slice(0, 25).flatMap((c: Record<string, unknown>) => {
    const name = clip(c?.name, 120);
    if (!name) return [];
    const role: NeedRole = ROLES.has(c?.role as NeedRole) ? (c.role as NeedRole) : 'other';
    const pkg = clip(c?.package, 200), quote = clip(c?.quote, 600), since = clip(c?.since, 10) || null;
    // Rule 9: the engine's own quote check (97% match). The sentence must name the company, by its core name at
    // least ("Tecnimont" for "Tecnimont S.p.A."), not necessarily the full legal form the AI gave.
    const quoteVerified = verifyQuote(name, quote, doc.text).ok || (verifyQuote(quote, quote, doc.text).ok && namesCompany(quote, name));
    const date = workDate(quote, since, doc.publishedAt), age = monthsAgo(date, now);
    const sells = role === 'seller_of_item' || SELLER.test(`${name} ${pkg}`);
    const owns = role === 'owner' || role === 'developer';
    const why = [
      sells && 'sells the item (a competitor)',
      !DOES_WORK.has(role) && !owns && !sells && `role ${role}`,
      !use && 'the work is not one of the uses',
      use && needsItem !== 'yes' && `need ${needsItem}${needWhy ? `: ${needWhy}` : ''}`,
      !market && `outside the chosen countries (${country ?? 'unknown'})`,
      age !== null && age > NEED_WINDOW_MONTHS && `older than ${NEED_WINDOW_MONTHS} months (${date})`,
      STAKE.test(quote) && !WORK.test(quote) && 'an investment, not work',
      ENGINEERING_ONLY.test(pkg) && !BUYS_MATERIAL.test(pkg) && 'engineering only, buys no material',
      !quoteVerified && 'sentence not found in the source',
    ].filter((x): x is string => Boolean(x));
    // Owners and developers (rule 4) on qualifying work are kept as owners: they buy through their contractors.
    const verdict: Verdict = why.length ? 'rejected' : owns ? 'owner' : 'lead';
    return [{ name, role, package: pkg, quote, quoteVerified, since: date, verdict, reason: why.join('; ') || (owns ? 'owner of work that needs the item' : 'does work that needs the item') }];
  });
  return { project, country, market, date: workDate('', null, clip(raw.date, 10) || doc.publishedAt), use, needsItem, needWhy, companies };
}

/**
 * Check one page: one AI call (or the saved answer when a job is replayed), judged, and stored in need_checks
 * (replacing earlier rows for the same page and run).
 */
export async function checkNeed(db: Queryable, runId: string, documentId: string, doc: { text: string; url: string; title: string | null; publishedAt: string | null },
  brief: SearchBrief, markets: string[], provider: LLMProvider, saved?: string | null): Promise<{ result: NeedResult | null; answer: string | null }> {
  let answer = saved ?? null;
  if (answer === null) {
    const res = await provider.complete({ ...needPrompt(doc, brief), json: true, maxTokens: 1500, temperature: 0, purpose: 'need_check', runId, singleAttempt: true });
    answer = res.text;
  }
  const result = judgeNeed(answer, doc, brief, markets);
  await db.query('delete from need_checks where run_id=$1 and document_id=$2', [runId, documentId]);
  for (const c of result?.companies ?? [])
    await db.query(`insert into need_checks(run_id,document_id,company_name,role,package,quote,quote_verified,work_date,project,project_country,market,use_name,needs_item,need_why,verdict,reason)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [runId, documentId, c.name, c.role, c.package, c.quote, c.quoteVerified, c.since, result!.project, result!.country, result!.market, result!.use, result!.needsItem, result!.needWhy, c.verdict, c.reason]);
  return { result, answer };
}

export interface NeedProof { company: string; quote: string; why: string; use: string | null; project: string | null; date: string | null; market: string | null; documentId: string; url: string | null }
/** A company's accepted need checks in a run (strongest first: most recent work). */
export async function needProofs(db: Queryable, runId: string, company: string): Promise<NeedProof[]> {
  const rows = (await db.query<{ company_name: string; quote: string; need_why: string | null; use_name: string | null; project: string | null; work_date: string | null; market: string | null; document_id: string; url: string | null }>(
    `select n.company_name,n.quote,n.need_why,n.use_name,n.project,n.work_date,n.market,n.document_id,d.url from need_checks n left join source_documents d on d.id=n.document_id
     where n.run_id=$1 and n.verdict='lead' order by n.work_date desc nulls last, n.created_at`, [runId])).rows;
  return rows.filter((r) => sameCompanyName(r.company_name, company))
    .map((r) => ({ company: r.company_name, quote: r.quote, why: r.need_why ?? '', use: r.use_name, project: r.project, date: r.work_date, market: r.market, documentId: r.document_id, url: r.url }));
}
/** Has this run's need check accepted the company (any page)? */
export async function needAccepted(db: Queryable, runId: string, company: string): Promise<boolean> {
  return (await needProofs(db, runId, company)).length > 0;
}
