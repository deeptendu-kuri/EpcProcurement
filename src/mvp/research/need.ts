/**
 * The need check (docs/mvp/20 stage 5–7): for one award article or company page in a work-search run, would the
 * work buy the searched item, and what is each named company's role in it, with the exact sentence. Only a
 * company that does the work (EPC, construction partner, subcontractor, maintenance contractor) on work that
 * needs the item, in his countries, within the current-work window (or supported ongoing work), becomes a lead.
 *
 * The rules come from 13 prototype runs on 10 Oct (cryogenic valves, HDPE pipe, stud bolts; UAE, Saudi Arabia,
 * India, Norway); their numbers below refer to docs/mvp/20 §7b.
 */
import type { Queryable } from '@/mvp/db';
import type { LLMProvider } from '@/mvp/llm';
import { firstJsonObject } from '@/mvp/llm/groq';
import { originalQuote,companyNames,namesCompany as literalNamesCompany } from '@/mvp/discovery/evidence';
import { detectCountry, detectMarkets } from '@/mvp/pipeline/filter';
import { fabricatedItem, matchUse, type SearchBrief } from '@/mvp/discovery/brief';
import { companyKey, initialsOf, sameCompanyName } from './company-names';
import { articleAnalysisText,tenderListingBlocks,workAnalysisParagraphs } from './relevance';
import { junkCompanyReason } from '@/mvp/sourcing/entities';
import { materialOutputOnly, namesItem } from '@/mvp/discovery/plan';
import { tenderWording } from '@/mvp/sourcing/tender-sources';
import {currentWorkProof,namesProject,type CurrentWorkDocument,type CurrentWorkProof} from './current-work';
import {ownDocumentIdentity} from './attribution';
import {pagePublishedAt} from './page-date';
import {missingMaterialOnly,potentialNeedReason,stainlessWorkApplication,sourceWorkApplication} from '@/mvp/discovery/potential-work';
import {engineeringOnlySource} from '@/mvp/discovery/work-scope';
import {countriesInQuote} from '@/mvp/discovery/locations';

export type NeedRole = 'owner' | 'developer' | 'epc' | 'jv_partner' | 'subcontractor' | 'maintenance_contractor' | 'direct_buyer' | 'seller_of_item' | 'other_supplier' | 'consultant' | 'investor' | 'other';
export type Verdict = 'lead' | 'owner' | 'rejected';
/** The use recorded for a direct buyer (its tender or order is the demand). */
export const DIRECT_PURCHASE = 'direct purchase (tender or order)';
/** Parts of the item or work on it, not the item (live probe, 14 Oct: the AI accepted impeller, pulley, spares and overhaul tenders). */
// Claims audit, 14 Oct: machining, inspection, radiography and GeM "custom bid for services" tenders were rejected
// only because the AI said so; the rules now reject them too ("supply, installation, testing and commissioning" stays a purchase).
const PART_OR_SERVICE = /\b(?:spares?|spare parts?|impellers?|pulleys?|bearings?|seals?|gaskets?|couplings?|repair(?:ing|s)?|overhaul(?:ing|s)?|refurbish\w*|recondition\w*|rewind\w*|servicing|annual maintenance|amc|custom bid for services|machining|inspection|examination|certification|calibration|radiography|ndt|hiring|hire of|rental|testing of)\b/i;
/**
 * Not an organisation: a portal or sector label standing in for a hidden buyer (live run 6, 14 Oct: tendersniper's
 * "Generation · GEM" listing became "Generation GEM"), or a catch-all ("Corporations And Associations And Others").
 */
export function maskedIssuer(name: string): boolean {
  const n = name.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  return /\b(?:gem|cppp|e-?procure\w*|e-?tenders?|tenders?|portal|bidding support)\b/i.test(n) && !/\b(?:limited|ltd|corporation|company|board|authority|department|ministry|army|navy|air force|council)\b/i.test(n)
    || /\band others\b/i.test(n)
    || /^(?:defen[cs]e|generation|transmission|distribution|railways?|power|energy|oil (?:and|&) gas|central government|state government|psus?|government|others?|private|public sector)$/i.test(n);
}
/** A tender whose title is for parts of the item or work on it, unless the searched item is that part or service. */
export function partOrServiceTender(text: string, pkg: string, item: string): boolean {
  if (PART_OR_SERVICE.test(item)) return false;
  const title = text.match(/\btender\s+for\s+([\s\S]{0,300}?)(?:\bAgency\b|\bDue Date\b|$)/i)?.[1] ?? pkg;
  return PART_OR_SERVICE.test(title);
}
export interface NeedCompany { name: string; role: NeedRole; package: string; quote: string; quoteVerified: boolean; since: string | null; verdict: Verdict; reason: string; identityQuote?:string; applicationUse?:string }
export interface NeedResult {
  project: string | null; country: string | null; market: string | null; date: string | null; use: string | null;
  needsItem: 'yes' | 'no' | 'unclear'; needWhy: string; companies: NeedCompany[];
  /** Supplementary progress evidence, separate from the original role/award. */
  currentWork?:CurrentWorkProof|null;
}

const ROLES = new Set<NeedRole>(['owner', 'developer', 'epc', 'jv_partner', 'subcontractor', 'maintenance_contractor', 'direct_buyer', 'seller_of_item', 'other_supplier', 'consultant', 'investor', 'other']);
/** Roles that buy the material for the work. */
const DOES_WORK = new Set<NeedRole>(['epc', 'jv_partner', 'subcontractor', 'maintenance_contractor']);
/** Makers and traders are recognised by trade words, never by the item's own words (§4 check 3). */
const SELLER = /\b(?:mills?|trading|traders?|stockists?|distribut\w*|dealers?)\b/i;
const STAKE = /\b(?:stake|shareholding|equity|acquir\w*|acquisition|invest(?:s|ed|ment|or)?)\b/i;
const WORK = /\b(?:EPC\w*|contract\w*|construct\w*|build\w*|install\w*|fabricat\w*|engineering|maintenance|services)\b/i;
// Rule 14: an engineering-only package (detailed engineering, FEED, design) buys no material.
const ENGINEERING_ONLY = /\b(?:detailed|front[- ]end|basic|FEED|pre-?FEED|design|consultancy|engineering services|engineering contract|engineering role)\b/i;
const BUYS_MATERIAL = /\b(?:EPC\w*|procurement|construct\w*|install\w*|fabricat\w*|build\w*|supply|maintenance)\b/i;
const CIVIL_ONLY = /^(?:(?:marine|heavy|general)\s+)?(?:civil|roads?|bridges?|dredging|jetty|jetties|electrical(?: only)?)\b/i;
/**
 * Work older than this has mostly been bought for. Big plants buy valves, pipe and fittings for 2-2.5 years after
 * the award (smoke test, 10 Oct: the Ruwais LNG EPC, awarded early 2025 and built until 2028, was dropped at 18).
 */
export const NEED_WINDOW_MONTHS = 30;
/**
 * docs/mvp/22 §3.7: a tender, RFQ or purchase order is demand only while it is current. Indexed tender pages go back
 * a decade (doc 21 §D5), so a direct buyer needs a date on the source within this window.
 */
export const DIRECT_BUY_WINDOW_MONTHS = 12;

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');
/** Does the sentence name this company: its core name (legal suffixes dropped) or its initials? */
export function namesCompany(quote: string, name: string): boolean {
  const core = companyKey(name), plain = quote.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (core.length >= 3 && plain.includes(core)) return true;
  // Generic legal/business tails may be omitted (McDermott International ->
  // McDermott), but a geographic subsidiary must not borrow the parent's quote
  // (Fluor Canada -> Fluor). Never use merely the first distinctive word.
  const words=name.toLowerCase().replace(/\([^)]*\)/g,' ').match(/[\p{L}\p{N}]+/gu)??[];
  const tails=new Set(['corporation','corp','company','co','limited','ltd','private','pvt','inc','llc','plc','international','engineering','construction','contracting','industrial','industries','group','global','services']);
  while(words.length>1&&tails.has(words.at(-1)!))words.pop();
  const short=words.join(' ');
  return Boolean(short.length>=3&&literalNamesCompany(quote,[short])) || (initialsOf(name).length >= 3 && new RegExp(`\\b${initialsOf(name)}\\b`, 'i').test(quote));
}

export function needPrompt(doc: { text: string; url: string; title: string | null; publishedAt: string | null }, brief: SearchBrief): { system: string; user: string } {
  return {
    system: 'Extract facts only from the page text. Never invent. Reply with JSON only.',
    user: `Uses we care about: ${brief.uses.map((u) => u.name).join('; ')}.
Item sold: ${brief.item}${brief.mustHave.length ? ` (must-have: ${brief.mustHave.join(', ')})` : ''}.${brief.synonyms?.length ? ` Also called: ${brief.synonyms.join('; ')}.` : ''} Not buyers: ${brief.notBuyers.join('; ') || 'none listed'}.${brief.makers?.length ? ` Makers and sellers of the item (competitors, never buyers): ${brief.makers.join('; ')}.` : ''}
Page (${doc.publishedAt?.slice(0, 10) ?? 'undated'}) ${doc.url}
Title: ${doc.title ?? ''}
Source paragraphs (original text; choose the paragraph index, do not stitch headings or rewrite punctuation):
${workAnalysisParagraphs(doc.text,brief).map((p,n)=>`[${n}] ${p}`).join('\n')}
Return {"project": project name or null, "country": country where the work is done or null, "date": "YYYY-MM" of the announcement or award if the text gives it, else null,
"use": the matching use name from the list, or null if the work is none of them,
"needsItem": judge as a procurement engineer from what the work IS; news never lists valves, pipes or gaskets, so do not require the text to name the item.
  "yes" if the work is one of the uses above (the item is standard in such work) or the text names the item;
  "no" if the work is none of the uses, or the text shows a different material doing that job (e.g. GRE or steel pipe instead of the item);
  "unclear" only if what the work is cannot be told from the text,
"needWhy": one line explaining that verdict,
  Treat this as a POTENTIAL engineering application, never a confirmed RFQ, exact grade, quantity or purchasing status unless a literal source quote explicitly establishes it. A plant using pipes does not establish ASTM A312 TP316L demand.
  A contract win is a stronger buying signal, NOT a requirement. Regular material-consuming work also qualifies. Do not reject a potential buyer for missing contract value, contact, email, exact specification or an unknown date; leave unknown facts null. Recency is ranked later.
"companies": [{"name": company, "role": one of owner|developer|epc|jv_partner|subcontractor|maintenance_contractor|direct_buyer|seller_of_item|other_supplier|consultant|investor|other, "package": what it does in this work, "quoteIndex": the integer index of the ONE paragraph proving this company's own work, "quote": optional exact sentence from that paragraph (no rewording, shortening or joining other headings), "since": "YYYY" or "YYYY-MM" when the text says when it got this work, else null,
  "buysItem": "yes" if this company's OWN package would buy the item sold (an EPC, process or piping, mechanical, tank or plant contractor usually does), "no" if its package would not (e.g. dredging, jetty or marine civil works, roads, buildings only, electrical only, drilling, engineering or design only)}]}
If an own-company report lists its work in bullets without repeating its name, also return "identityQuote": its literal company-name header. Keep the work quote and header separate; do not stitch them into an invented sentence.
Tenders and orders: direct_buyer = the organisation that issues a tender, RFQ, bid invitation or enquiry, or places a purchase order, to BUY the item sold for itself (its quote must name that organisation and the item; "date" is the tender or order date). A company that won a contract or order to SUPPLY, make or fabricate the item is seller_of_item (a competitor), also on a tender page. A tender only for services on the item (inspection, testing, repair, overhaul, AMC, O&M) or only for its spare parts is not a purchase of the item: buysItem "no", unless the item sold is that service or part.
On a page listing several tenders, add to the same "companies" list one direct_buyer (the agency or department) for each listed tender whose title names the item.
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
  // The AI's "since" counts only when the sentence itself names that year; otherwise the article's date does.
  if (since && /^\d{4}/.test(since) && quote.includes(since.slice(0, 4))) return since.length === 4 ? `${since}-06` : since.slice(0, 7);
  const years = [...quote.matchAll(/\b(19\d\d|20\d\d)\b/g)].map((m) => Number(m[1]));
  const article = articleDate ? Number(articleDate.slice(0, 4)) : new Date().getFullYear();
  return years.length && Math.max(...years) < article - 1 ? `${Math.max(...years)}-06` : articleDate?.slice(0, 10) ?? null;
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** The due or closing date printed on a tender listing ("Due Date : Oct 23, 2026", "Bid End Date: 23-10-2026"), as YYYY-MM-DD. */
export function tenderDueDate(text: string): string | null {
  const m = text.match(/\b(?:due|closing|last|end|submission|opening)\s+date\s*(?:&\s*time)?\s*:?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[-/ .][A-Za-z]{3,9}[-/ .]\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}-\d{2}-\d{2})/i)?.[1];
  if (!m) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (y: number, mo: number, d: number) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : null);
  let p: RegExpMatchArray | null;
  if ((p = m.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return iso(+p[1], +p[2], +p[3]);
  if ((p = m.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) return iso(+p[3], +p[2], +p[1]); // India and the Gulf write day first
  if ((p = m.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) return iso(+p[3], MONTHS.indexOf(p[1].slice(0, 3).toLowerCase()) + 1, +p[2]);
  if ((p = m.match(/^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .](\d{4})$/))) return iso(+p[3], MONTHS.indexOf(p[2].slice(0, 3).toLowerCase()) + 1, +p[1]);
  return null;
}
const monthsAgo = (date: string | null, now: Date) => (date ? (now.getTime() - Date.parse(date.length === 7 ? `${date}-15` : date)) / 2.63e9 : null);

/** Parse and judge the AI's answer for one page. */
export function judgeNeed(text: string, doc: { text: string; publishedAt: string | null; url?:string; title?:string|null; related?:CurrentWorkDocument[] }, brief: SearchBrief, markets: string[], now = new Date()): NeedResult | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(firstJsonObject(text) ?? 'null') as Record<string, unknown>; } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  // A list page answer sometimes groups companies per tender (live probe, 14 Oct): the same companies, flattened.
  if (!Array.isArray(raw.companies) && Array.isArray(raw.tenders)) {
    const groups = (raw.tenders as Record<string, unknown>[]).filter((t) => t && typeof t === 'object');
    raw = { ...(groups[0] ?? {}), companies: groups.flatMap((t) => (Array.isArray(t.companies) ? t.companies : []).map((c: Record<string, unknown>) => ({ date: t.date, ...c }))) };
  }
  const use = matchUse(brief, clip(raw.use, 120))?.name ?? null;
  let needsItem:'yes'|'no'|'unclear' = raw.needsItem === 'yes' || raw.needsItem === 'no' ? raw.needsItem : 'unclear';
  const project = clip(raw.project, 160) || null, country = clip(raw.country, 80) || null;
  const claimedMarket = workMarket(country, brief, markets);
  // An AI country is a claim, not evidence. Require the original to locate the
  // work there (including documented local place names), not just a search filter.
  const sourceMarket = workMarket(articleAnalysisText(doc.text),brief,markets);
  const market = claimedMarket ? (claimedMarket===sourceMarket?claimedMarket:null) : (project ? null : sourceMarket);
  // A tender listing often omits the country it is in: the page's own country stands when no other chosen country appears.
  const directMarket = market ?? (claimedMarket && !sourceMarket ? claimedMarket : null);
  // The headline places the work only abroad ("… contract from Nigerian group"): the AI's country does not outweigh it
  // unless the company's own sentence names a chosen country (claims audit, 14 Oct: EIL's Nigeria work saved for India).
  const headline = countriesInQuote(doc.title ?? '');
  const headlineAbroad = headline.length > 0 && !headline.some((m) => markets.includes(m));
  const needWhy = clip(raw.needWhy, 300);
  const progress=project&&namesProject(doc.text,project)?currentWorkProof(project,doc.related??[],now):null;
  const currentWork=progress&&workMarket(progress.quote,brief,markets)===market?progress:null;
  const companies: NeedCompany[] = (Array.isArray(raw.companies) ? raw.companies : []).slice(0, 25).flatMap((c: Record<string, unknown>): NeedCompany[] => {
    const name = clip(c?.name, 120);
    if (!name||junkCompanyReason(name)) return [];
    const role: NeedRole = ROLES.has(c?.role as NeedRole) ? (c.role as NeedRole) : 'other';
    const indexed=Number.isInteger(c?.quoteIndex)&&Number(c.quoteIndex)>=0?workAnalysisParagraphs(doc.text,brief)[Number(c.quoteIndex)]:null;
    const pkg = clip(c?.package, 200), quote = indexed&&indexed.length<=1600?indexed:clip(c?.quote, 600), since = clip(c?.since, 10) || null;
    // Literal source spans, tolerating typography/whitespace only. The sentence
    // must name the company; a fuzzy paraphrase is never verified evidence.
    const literal=originalQuote(doc.text,quote);
    const identityQuote=clip(c?.identityQuote,300)||undefined;
    const quoteVerified = Boolean(literal&&(namesCompany(literal,name)||ownDocumentIdentity(doc.text,name,doc.url,identityQuote)));
    const date = workDate(quote, since, doc.publishedAt), age = monthsAgo(date, now);
    const application=quoteVerified?(brief.productId==='ss-duplex-pipe'
      ?stainlessWorkApplication({company:name,quote:literal!,text:doc.text,package:pkg},brief)
      :sourceWorkApplication(name,literal!,brief)):null;
    // A null model use caused ONLY by missing pipe/specification wording can be
    // recovered from the reviewed, company-attributed original application.
    // It is not authority to override unrelated work or an own-package rejection.
    // A valid model verdict may still misname the application (e.g. LNG as a
    // petrochemical plant). Prefer this company's literal brief-matching work
    // for the description; this fallback never recovers a null/negative verdict.
    const sourceUse=application??(needsItem==='yes'&&use&&quoteVerified?sourceWorkApplication(name,literal!,brief):null);
    const companyUse=sourceUse&&(needsItem==='yes'||missingMaterialOnly(needWhy))?sourceUse:use;
    const reviewedNeed=Boolean(application&&companyUse&&DOES_WORK.has(role)&&c?.buysItem!=='no'&&missingMaterialOnly(needWhy)
      &&(brief.productId==='ss-duplex-pipe'||needsItem!=='no'));
    const needsOwnItem=needsItem==='yes'||reviewedNeed;
    const sells = role === 'seller_of_item' || SELLER.test(`${name} ${pkg}`) || Boolean(brief.productId&&materialOutputOnly(literal??quote,brief.productId));
    const completed = /\b(?:completed|delivered|commissioned|handed over)\b/i.test(quote)&&! /\b(?:ongoing|under construction|currently|maintenance|revamp|expansion)\b/i.test(quote);
    const owns = role === 'owner' || role === 'developer';
    // docs/mvp/22 §3.7: a tender or order for the item is demand in itself; the use list does not apply to it.
    if (role === 'direct_buyer') {
      const named = Boolean(brief.productId && literal && namesItem(literal, brief.productId, brief, true));
      // A listing's own due date shows the tender is current: an open tender (due ahead) is dated this month.
      const due = tenderDueDate(literal ?? quote), dueAge = monthsAgo(due, now);
      const tenderDate = due && dueAge !== null && dueAge > -12 ? (dueAge < 0 ? now.toISOString().slice(0, 7) : due.slice(0, 7))
        : date ?? workDate('', null, clip(c?.date, 10) || clip(raw.date, 10) || doc.publishedAt);
      const tenderAge = monthsAgo(tenderDate, now);
      const directWhy = [
        sells && 'sells the item (a competitor)',
        maskedIssuer(name) && 'the listing does not name the buying organisation',
        !named && 'the tender or order sentence does not name the item',
        (c?.buysItem === 'no' || partOrServiceTender(literal ?? quote, pkg, brief.item)) && 'buys services or spare parts, not the item',
        !directMarket && `outside the chosen countries (${country ?? 'unknown'})`,
        directMarket && headlineAbroad && !countriesInQuote(literal ?? quote).some((m) => markets.includes(m)) && `the headline places it outside the chosen countries (${headline.join(', ')})`,
        tenderAge === null && 'no date on the tender or order; cannot confirm it is current',
        tenderAge !== null && tenderAge > DIRECT_BUY_WINDOW_MONTHS && `tender or order older than ${DIRECT_BUY_WINDOW_MONTHS} months (${tenderDate})`,
        tenderAge !== null && tenderAge < -1 && 'future-dated tender; date not established',
        !quoteVerified && 'sentence not found in the source',
      ].filter((x): x is string => Boolean(x));
      return [{ name, role, package: pkg, quote: literal ?? quote, quoteVerified, since: tenderDate, verdict: directWhy.length ? 'rejected' as const : 'lead' as const, identityQuote,
        applicationUse: DIRECT_PURCHASE, reason: directWhy.join('; ') || (!tenderWording(literal ?? quote) ? 'buys the item directly (purchase order)'
          : due && dueAge !== null && dueAge > 0.04 ? `issued a tender for the item (closed ${due})` : `issues an open tender or RFQ for the item${due ? ` (due ${due})` : ''}`) }];
    }
    const why = [
      sells && 'sells the item (a competitor)',
      !DOES_WORK.has(role) && !owns && !sells && `role ${role}`,
      !companyUse && 'the work is not one of the uses',
      companyUse && !needsOwnItem && `need ${needsItem}${needWhy ? `: ${needWhy}` : ''}`,
      brief.productId==='ss-duplex-pipe'&&!application&&/\b(?:transmission|cross[- ]country) pipelines?\b/i.test(pkg)&&'transmission pipeline package; stainless process-pipe need not established',
      !market && `outside the chosen countries (${country ?? 'unknown'})`,
      market && headlineAbroad && !countriesInQuote(literal ?? quote).some((m) => markets.includes(m)) && `the headline places the work outside the chosen countries (${headline.join(', ')})`,
      age !== null && age > NEED_WINDOW_MONTHS && !currentWork && `older than ${NEED_WINDOW_MONTHS} months (${date})`,
      age !== null && age < 0 && 'future-dated work; no current buying window established',
      completed && 'completed work; no current buying window established',
      STAKE.test(quote) && !WORK.test(quote) && 'an investment, not work',
      (engineeringOnlySource(literal??quote,clause=>literalNamesCompany(clause,companyNames(name,literal??quote))) || ENGINEERING_ONLY.test(pkg) && !BUYS_MATERIAL.test(pkg)) && 'engineering only, buys no material',
      // Smoke test, 10 Oct: the work needed the item, but a jetty contractor's own package does not buy it.
      DOES_WORK.has(role) && c?.buysItem === 'no' && 'its own package does not buy the item',
      // docs/mvp/22 §3.12: for fabricated equipment, a fabrication subcontractor makes it (claims audit: AlNafie).
      role === 'subcontractor' && fabricatedItem(brief) && /\bfabricat\w*|\bworkshops?\b/i.test(literal ?? quote) && 'fabricates this kind of equipment itself (a competitor)',
      DOES_WORK.has(role) && c?.buysItem!=='no' && CIVIL_ONLY.test(pkg) && !/\b(?:process|piping|mechanical|EPC|procurement)\b/i.test(pkg) && 'civil or electrical-only package, not material-consuming work',
      !quoteVerified && 'sentence not found in the source',
    ].filter((x): x is string => Boolean(x));
    // Owners and developers (rule 4) on qualifying work are kept as owners: they buy through their contractors.
    const verdict: Verdict = why.length ? 'rejected' : owns ? 'owner' : 'lead';
    return [{ name, role, package: pkg, quote:literal??quote, quoteVerified, since: date, verdict, identityQuote, applicationUse:companyUse??undefined, reason: why.join('; ') || (owns ? 'owner of work that needs the item' : 'does work that needs the item') }];
  });
  // A reviewed application can recover a material-omission false negative, but
  // must not retroactively approve other companies in the same article.
  if(companies.some(c=>c.verdict==='lead')&&needsItem!=='yes')needsItem='yes';
  const acceptedUse=use??companies.find(c=>c.verdict==='lead')?.applicationUse??null;
  return { project, country, market, date: workDate('', null, clip(raw.date, 10) || doc.publishedAt), use:acceptedUse, needsItem,
    needWhy:companies.some(c=>c.verdict==='lead')?potentialNeedReason(acceptedUse):needWhy, companies, currentWork };
}

/**
 * Check one page: one AI call (or the saved answer when a job is replayed), judged, and stored in need_checks
 * (replacing earlier rows for the same page and run).
 */
export async function checkNeed(db: Queryable, runId: string, documentId: string, doc: { text: string; url: string; title: string | null; publishedAt: string | null },
  brief: SearchBrief, markets: string[], provider: LLMProvider, saved?: string | null): Promise<{ result: NeedResult | null; answer: string | null }> {
  let answer = saved ?? null;
  if (answer === null) {
    // A tender list page answers one company per listing (live probe, 14 Oct: eight listings outgrew 1500 tokens).
    const maxTokens = tenderListingBlocks(doc.text, brief).length > 2 ? 3000 : 1500;
    const res = await provider.complete({ ...needPrompt(doc, brief), json: true, maxTokens, temperature: 0, purpose: 'need_check', runId, singleAttempt: true });
    answer = res.text;
  }
  // Bounded by the run's already-read pages; never query the internet or another
  // run to assert current work. Progress and contractor identity keep their own
  // source documents and exact quotes.
  const related=(await db.query<{id:string;url:string;text:string;published_at:string|null}>(
    `select d.id,d.url,d.text,d.published_at from run_documents r join source_documents d on d.id=r.document_id
     where r.run_id=$1 and d.published_at is not null order by d.published_at desc limit 30`,[runId])).rows
      .map(d=>({...d,publishedAt:d.published_at}));
  const result = judgeNeed(answer, {...doc,publishedAt:pagePublishedAt(doc.text,doc.publishedAt),related}, brief, markets);
  await db.query('delete from need_checks where run_id=$1 and document_id=$2', [runId, documentId]);
  for (const c of result?.companies ?? [])
    await db.query(`insert into need_checks(run_id,document_id,company_name,role,package,quote,quote_verified,work_date,project,project_country,market,use_name,needs_item,need_why,verdict,reason)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [runId, documentId, c.name, c.role, c.package, c.quote, c.quoteVerified, c.since, result!.project, result!.country, result!.market, c.applicationUse??result!.use, result!.needsItem,
        c.verdict==='lead'?(c.role==='direct_buyer'?`${c.reason[0].toUpperCase()}${c.reason.slice(1)} on the source. Quantity, specification and closing date are on the tender itself; bids go through its tender portal before the closing date.`:potentialNeedReason(c.applicationUse??result!.use)):result!.needWhy, c.verdict, c.reason]);
  return { result, answer };
}

/** Arrival order must not decide whether an older, still-active contract is
 * lost. Rejudge previously stored answers when a new same-project progress page
 * arrives. This uses at most ten cached answers, zero new model calls. */
export async function recheckRelatedNeeds(db:Queryable,runId:string,currentText:string,brief:SearchBrief,markets:string[],provider:LLMProvider):Promise<{documentId:string;result:NeedResult|null}[]>{
  const rows=(await db.query<{id:string;text:string;url:string;title:string|null;published_at:string|null;project:string;answer:string}>(
    `select distinct d.id,d.text,d.url,d.title,d.published_at,n.project,j.result->>'needAnswer' as answer
     from need_checks n join source_documents d on d.id=n.document_id join research_jobs j on j.run_id=n.run_id and j.payload->>'documentId'=n.document_id::text
     where n.run_id=$1 and n.verdict='rejected' and n.reason like '%older than%' and n.quote_verified=true and n.project is not null and j.result->>'needAnswer' is not null limit 10`,[runId])).rows;
  const results=[];
  for(const r of rows){
    if(!namesProject(currentText,r.project))continue;
    const need=await checkNeed(db,runId,r.id,{text:r.text,url:r.url,title:r.title,publishedAt:r.published_at},brief,markets,provider,r.answer);
    results.push({documentId:r.id,result:need.result});
  }
  return results;
}

/** Follow-ups per project (docs/mvp/20 stage 6, rule 5): at most this many projects per country per search. */
export const FOLLOW_PROJECTS_PER_COUNTRY = 2;
/** Each followed project gets three searches (subcontracts, packages, suppliers' orders). */
export const FOLLOW_SEARCHES_PER_COUNTRY = FOLLOW_PROJECTS_PER_COUNTRY * 3;
/**
 * The follow-up searches for a project the need check accepted: its subcontracts and packages (tank builders,
 * piping and mechanical subcontractors) and suppliers' orders for the item (a competitor's order names the buyer).
 */
export function followUpQueries(project: string, item: string): string[] {
  const name = project.replace(/\s+/g, ' ').trim().slice(0, 90);
  return [`${name} subcontract awarded`, `${name} package contract awarded`, `${name} ${item} supply order`];
}
/** Which projects of a judged page to follow: needed work, in a chosen country, not yet followed (top 2 per country). */
export async function projectsToFollow(db: Queryable, runId: string, result: NeedResult): Promise<{ project: string; market: string }[]> {
  if (result.needsItem !== 'yes' || !result.project || !result.market || !result.companies.some((c) => c.verdict === 'lead' || c.verdict === 'owner')) return [];
  const followed = (await db.query<{ key: string }>(`select key from research_jobs where run_id=$1 and stage='collect' and key like 'follow:%'`, [runId])).rows.map((r) => r.key);
  const local=followed.filter(k=>k.startsWith(`follow:${result.market}:`));
  if (local.some(k=>projectFollowKey(k.split(':')[2])===projectFollowKey(result.project!))) return [];
  const projects = new Set(local.map(k=>projectFollowKey(k.split(':')[2])));
  return projects.size >= FOLLOW_PROJECTS_PER_COUNTRY ? [] : [{ project: result.project, market: result.market }];
}
export const followKey = (market: string, project: string, n: number) =>
  `follow:${market}:${projectFollowKey(project)}:${n}`;

/** Word-order changes must not buy another set of queries for the same named
 * project. Phase numbers remain distinctive; existing legacy keys also match. */
export function projectFollowKey(project:string):string {
  return [...new Set(project.toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').split(/[^\p{L}\p{N}]+/u)
    .filter(w=>w&&!['the','of','for','project','expansion','phase'].includes(w)))].sort().join('-').slice(0,60);
}

/** Ranking, not admission: date/contact/contract value may be missing. */
export function needPriorityScore(date:string|null,contract:boolean,ongoing:boolean,now=new Date()):number {
  const age=monthsAgo(date,now);
  if(ongoing)return 90;
  if(contract&&age!==null&&Number.isFinite(age)&&age>=0&&age<=18)return 85;
  if(contract&&age!==null&&Number.isFinite(age)&&age>=0&&age<=NEED_WINDOW_MONTHS)return 80;
  return contract?75:65;
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
