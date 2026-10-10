/**
 * Shortlist rating (docs/mvp/18 §5, v2 in docs/mvp/19 Phase 2). A search names far more companies than
 * it can verify, so every named company is rated from the sentence that named it: how likely it is to
 * BUY the searched material, HOW it buys (end user, main contractor, subcontractor, owner, reseller), how
 * closely it matches the exact variant typed ("welded … 316L"), a plain role, a reason and other
 * catalogue products it would buy. Rules settle obvious non-buyers; one AI call rates up to 20 names.
 * The rating orders verification (best first) and lets the user see likely buyers before they are
 * verified. It is never shown as proof.
 */
import { z } from 'zod';
import type { Db, Queryable } from '@/mvp/db';
import type { LLMProvider } from '@/mvp/llm/types';
import type { RunInput } from '@/mvp/types';
import { getCatalogue, getCatalogueItem } from '@/mvp/config/buyers-config';
import { whoBuys } from '@/mvp/discovery/material-catalogue';
import { parseMaterialSpec, specBrief } from '@/mvp/discovery/spec';
import { genericServicePhrase, junkFoundName, looksLikeSupplier } from '@/mvp/sourcing/names';
import { nonCompanyDomain } from '@/mvp/sourcing/entities';
import { countriesInQuote } from '@/mvp/discovery/locations';
import { COUNTRIES } from '@/mvp/config/countries';
const countryNameOf = (code: string) => COUNTRIES.find((c) => c.code === code)?.name ?? code;

/** Small batches: with 40 names the model skipped some and let one page's context bleed into others. */
export const RATING_BATCH = 20;
/** Below this a company is not worth a website lookup before better-rated ones. */
export const LOOKUP_FLOOR = 25;
/** Resellers rank below end users and contractors who buy for their own work. */
export const RESELLER_CEILING = 65;

export const BUYER_TYPES = ['end_user', 'contractor', 'subcontractor', 'owner', 'reseller', 'competitor', 'not_buyer'] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];
export const MATCHES = ['named', 'product', 'work', 'none'] as const;
export type MatchStrength = (typeof MATCHES)[number];

export interface RatedCompany {
  id: string; rating: number; role: string; reason: string; also: string[]; source: 'ai' | 'rules';
  /** How it buys; null when not known. */
  buyerType: BuyerType | null;
  /** How closely it matches the exact material: names the variant / uses the product / its work needs it. */
  match: MatchStrength | null;
  /** The AI's own number, stored so guards apply on read. */
  raw?: number;
}
export interface RateRow { id: string; company: string; identity_quote: string | null; title: string | null }
/** What is being rated for: the product, the words typed (for the exact variant) and whether resellers count. */
export interface RateContext { productId: string; query?: string; resellers?: boolean; /** Searched country codes. */ markets?: string[] }
type Row = RateRow;

const clip = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const resellersOn = (ctx: { resellers?: boolean }) => ctx.resellers !== false;
const nameOf = (productId: string) => getCatalogueItem(productId)?.shortName || productId;

// Gulf place and company-form words: "JURF AJMAN UAE", "AL SAJJA SHARJAH UAE" are places, not companies.
const PLACE_OR_FORM = new Set(['uae', 'ksa', 'gcc', 'dubai', 'abu', 'dhabi', 'sharjah', 'ajman', 'ras', 'al', 'khaimah', 'rak', 'hamriyah', 'jurf', 'ghail', 'sajja', 'jebel', 'ali',
  'fujairah', 'umm', 'quwain', 'qatar', 'doha', 'oman', 'muscat', 'saudi', 'arabia', 'riyadh', 'jeddah', 'dammam', 'jubail', 'india', 'malaysia', 'norway',
  'fze', 'fzc', 'fzco', 'llc', 'ind', 'area', 'industrial', 'zone', 'free', 'city',
  // Saudi and Gulf plant sites, and a plant's phase number ("Ras Al-Khair", "Yanbu III", "Al-Khobar I", "Qassim 1").
  'rabigh', 'shuaibah', 'shoaiba', 'shoaibah', 'yanbu', 'qassim', 'khobar', 'jazan', 'jizan', 'hajr', 'khair', 'shuqaiq', 'taweelah', 'hassyan', 'mirfa',
  'ghubrah', 'tabuk', 'makkah', 'mecca', 'madinah', 'medina', 'neom', 'kuwait', 'bahrain', 'i', 'ii', 'iii', 'iv', 'v', 'vi']);
/** A project, field or facility named in the news ("Ichthys LNG Project", "Marjan Increment … Package 4"), not a company. */
export function projectName(name: string): boolean {
  // "Natural Gas Development Project Offshore Brunei": a project word and no company form anywhere.
  const companyForm = /\b(?:ltd|limited|llc|inc|corp(?:oration)?|company|co|group|plc|gmbh|ag|sa|sdn|bhd|pvt|fze|wll|holdings?)\b\.?/i.test(name);
  if (/\b(?:project|development project|field development)\b/i.test(name) && !companyForm) return true;
  // Power and water plants and other facilities: "Rabigh 4 IWP", "Jazan IGCC", "Hajr IPP", "… International Airport".
  if (/\b(?:IWP|IPP|IWPP|ISTP|IWTP|IGCC|CCGT|SWRO|airport|desalination plant|power plant|power station)\b/i.test(name) && !companyForm) return true;
  return /\b(?:projects?|development|facilit(?:y|ies)|fpu|fpso|oss|expansion|increment|package \d+|train \d+|field|fields|platform removal|decommissioning|wind farms?|terminal)\b\s*(?:\(|$|[-–—,])/i.test(name.trim());
}
/** A name made only of place and company-form words. */
export function placeOnlyName(name: string): boolean {
  const words = name.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.length > 0 && words.every((w) => PLACE_OR_FORM.has(w));
}

const notBuyer = (reason: string, role = 'Not a buyer'): Omit<RatedCompany, 'id'> => ({ rating: 0, role, reason, also: [], source: 'rules', buyerType: 'not_buyer', match: null });
/**
 * Rules for names that need no AI: page furniture, places, projects, and (when he does not sell to
 * resellers) sellers of the material. With resellers on, a seller is left to the AI to tell a stockist
 * that supplies contractors (a reseller buyer) from a mill (a competitor).
 */
export function ruleRating(name: string, quote: string | null, productName: string, opts: { resellers?: boolean } = {}): Omit<RatedCompany, 'id'> | null {
  if (placeOnlyName(name)) return notBuyer('A place name, not a company.');
  if (projectName(name)) return notBuyer('A project or facility named in the news; its owner or contractor is the buyer.', 'A project, not a company');
  const junk = junkFoundName(name, quote);
  if (junk) return notBuyer(`Not a company that buys materials (${junk}).`);
  if (!resellersOn(opts) && looksLikeSupplier(quote)) return { rating: 3, role: `Seller of ${productName}`, reason: `Sells ${productName}: a competitor, not a buyer.`, also: [], source: 'rules', buyerType: 'competitor', match: null };
  return null;
}

const ROLE_RULES: [RegExp, string, number, BuyerType][] = [
  [/\b(?:agency|marketing|software|web ?design|website|seo|magazine|news|media|consultan\w*|recruit\w*|training)\b/i, 'Service company', 8, 'not_buyer'],
  [/\b(?:lubricants?|diesel|petroleum trading|fuel trading|grease)\b/i, 'Fuel or lubricant trader', 8, 'not_buyer'],
  [/\b(?:pressure vessels?|heat exchangers?|storage tanks?|boilers?|columns?|reactors?)\b/i, 'Process equipment fabricator', 72, 'end_user'],
  [/\b(?:fabricat\w*|steel structures?|structural steel|workshop|spool)\b/i, 'Steel fabricator', 66, 'end_user'],
  [/\b(?:pipeline|piping)\b.*\b(?:contractor|construction|laying|installation)\b|\b(?:contractor|construction)\b.*\b(?:pipeline|piping)\b/i, 'Pipeline contractor', 66, 'contractor'],
  [/\bepc\b|\bengineering,? procurement\b/i, 'EPC contractor', 60, 'contractor'],
  [/\b(?:sub-?contract\w*|mechanical contractor|erection)\b/i, 'Mechanical subcontractor', 58, 'subcontractor'],
  [/\b(?:contractor|construction|contracting|projects|infrastructure)\b/i, 'Contractor', 50, 'contractor'],
];
const STOCKIST_RULE = /\b(?:stockists?|stockholders?|traders?|trading|distributors?|dealers?|suppliers?)\b/i;
/**
 * Plain heuristic used without an AI provider (demo mode) or when the AI call fails. It reads only the
 * company's own name and sentence: a page title describes the page (a fabricator's client list, a
 * standards guide), never the company named on it.
 */
export function heuristicRating(name: string, quote: string | null, _title: string | null, productName: string, opts: { resellers?: boolean } = {}): Omit<RatedCompany, 'id'> {
  const fixed = ruleRating(name, quote, productName, opts);
  if (fixed) return fixed;
  const text = `${name} ${quote ?? ''}`;
  for (const [re, role, rating, buyerType] of ROLE_RULES) if (re.test(text))
    return { rating, role, reason: rating >= 45 ? `${role}: this kind of work uses ${productName}. Not verified yet.` : `${role}: unlikely to buy ${productName}.`, also: [], source: 'rules', buyerType, match: rating >= 45 ? 'work' : null };
  if (resellersOn(opts) && STOCKIST_RULE.test(text)) return { rating: 40, role: 'Stockist or trader', reason: `May stock ${productName} for contractors. Not verified yet.`, also: [], source: 'rules', buyerType: 'reseller', match: null };
  return { rating: 30, role: 'Not clear yet', reason: 'The source does not say what work it does.', also: [], source: 'rules', buyerType: null, match: null };
}

const answer = z.object({ companies: z.array(z.object({
  id: z.string(), rating: z.coerce.number(), role: z.string().default(''), reason: z.string().default(''), also: z.array(z.string()).default([]),
  type: z.string().optional(), match: z.string().optional(),
})) });

/** The AI prompt: judge buying likelihood and buyer type only from the given words; never invent. */
export function ratingPrompt(productId: string, rows: Row[], ctx: Omit<RateContext, 'productId'> = {}): { system: string; user: string } {
  const name = nameOf(productId);
  const spec = parseMaterialSpec(ctx.query ?? '');
  const brief = specBrief(name, productId, spec);
  const buyers = whoBuys(productId);
  const others = getCatalogue().items.filter((i) => i.id !== productId).map((i) => ({ id: i.id, name: i.shortName || i.name }));
  const resellers = resellersOn(ctx);
  return {
    system: [
      `You help an industrial supplier's sales team. The supplier sells: ${brief}. Rate how likely each company is to BUY it.`,
      `Typical buyers of ${name}: ${buyers.join('; ') || 'contractors and fabricators that use it'}.`,
      'Buyer types ("type"):',
      '- end_user: uses it in its own work (fabricators, spool and workshop shops, plant builders, plant operators doing maintenance);',
      '- contractor: a main or EPC contractor that buys for its projects or passes the work to subcontractors;',
      '- subcontractor: a piping, mechanical, installation or fabrication subcontractor working under a main contractor;',
      '- owner: a company that owns and operates plants, pipelines or utilities and commissions projects from EPC contractors. Owners buy mostly through their contractors: rate 40-55 when their business uses it, never 0 just because they are a client of a contractor. A project company or plant (SPV) is not an owner of its own: not_buyer;',
      '- marine, dredging, offshore and energy groups that build projects for others (for example NMDC) are contractors, not owners;',
      resellers
        ? `- reseller: a stockist, trader or distributor that buys ${name} to supply contractors and projects (a buyer for this supplier; rate at most 65);`
        : `- reseller: stockists, traders and distributors of ${name} are competitors here (rate 0-5, type competitor);`,
      `- competitor: makers and mills of ${name};`,
      '- not_buyer: certifiers, inspectors, standards bodies, regulations, publishers, software or web agencies, social networks, banks, government departments, academic institutes, fuel/oil/lubricant traders, anything that is not a company;',
      '- also not_buyer: investors and investment or holding companies, offtakers and procurement/PPP agencies, engineering consultants, project-management firms and owner engineers, technology licensors, equipment makers (OEMs such as turbine, pump or membrane makers), recruiters, real-estate developers, and companies that no longer exist (bankrupt or merged);',
      `"match": "named" when its own words name this exact variant or standard, "product" when they name the product, "work" when only its work implies it, "none" otherwise.`,
      'Judge each company separately, from its own name and its own sentence ("said"). The page title ("page") only tells you which page or list the name was on:',
      '- a name in a list titled "X manufacturers" or "X contractors" is probably such a company (rate it 50-70 unless its own words or well-known facts say more or less);',
      "- names on one company's website (its clients, partners, projects, staff history) are that company's customers or contacts, not makers of what the page is about; judge them by who they are: a client that commissions projects (an oil, gas, water or power company) buys the material for them (type owner), while traders and service firms on such a list do not;",
      '- composite or aluminium cylinders and vessels do not use steel plate or steel pipe;',
      '- a company named only because it signed an MoU, cooperation or study with another company is a weak lead (at most 40);',
      '- a project, field, plant or facility name is not a company ("Rabigh 4 IWP", "Ras Al-Khair", an airport): rate 0, type not_buyer;',
      ...(ctx.markets?.length ? [`- the supplier sells in ${ctx.markets.map(countryNameOf).join(', ')}: a company that clearly works only in other countries is rated at most 30, and its reason says "Outside the searched countries";`] : []),
      'Rate above 75 only when the company\'s own sentence, or well-known facts about the company, show work that uses the material. Do not invent projects, sizes or facts.',
      'Ratings: 70-100 clearly uses this material; 45-69 plausible; 10-44 weak or unclear; 0-9 not a buyer.',
      `"role": a short plain description such as "Pressure vessel fabricator" or "Pipeline EPC contractor". "reason": one short sentence saying why they would buy ${name}, or why not. "also": ids from the catalogue list of other products they would likely buy (at most 4).`,
      'Answer JSON only: {"companies":[{"id","rating","type","match","role","reason","also"}]} with one entry per input company.',
    ].join('\n'),
    user: JSON.stringify({ product: brief, catalogue: others, companies: rows.map((r, i) => ({ id: `c${i + 1}`, name: clip(r.company, 120), said: clip(r.identity_quote, 240), page: clip(r.title, 110) })) }),
  };
}

// "not a line pipe buyer", "supplies umbilicals, not line pipe; rating low", "does not use plates".
const NOT_BUYER = /\bnot (?:an? )?(?:[\w/-]+ ){0,3}(?:buyer|consumer|user)\b|\brating low\b|\bdoes(?: not|n't) (?:buy|use|need)\b|\bcompetitor\b/i;
// "No indication of pipe usage", "only umbilicals mentioned": the AI's own doubt.
const WEAK = /\bno (?:clear |direct )?(?:indication|evidence|mention|sign)\b|\bno direct\b|\bonly [\w\s/-]{1,40} mentioned\b|\bunclear\b/i;
const MAKER = /\b(?:manufacturer|maker|mill|producer)\b/i;
const TRADER = /\b(?:supplier|stockist|stockholder|distributor|dealer|trader|seller|sells|exporter)\b/i;
const MATERIAL_WORD = /plate|pipe|tube|valve|fitting|flange|cable|steel|gasket|bolt/i;
// Fuel and lubricant trading names. "Oil" alone is not one: oil companies own pipelines and buy line pipe.
const FUEL_TRADE = /\b(?:lubricants?|lubechem|grease|diesel|trad(?:ing|g|ers?)|trdg)\b|\b(?:oil|petrol\w*|refin\w*)\b.*\b(?:fze|fzc|llc|l\.l\.c)\b/i;
// The page or the role names a different material ("Top 10 Composite Pressure Vessel Manufacturers").
const OTHER_MATERIAL = /\b(?:composite|alumin(?:i)?um|plastics?|grp|frp|hdpe|pvc|polyethylene|fib(?:re|er)glass|carbon fib(?:re|er))\b/i;
/** Reasons the AI copied from the page instead of the company's own work (see parseRatings). */
export const PAGE_CONTEXT = 'Page context only: ';
const WORK_WORD = /\b(?:fabricat\w*|engineering|kejuruteraan|ingenier\w*|ingenieur\w*|vessels?|tanks?|boilers?|steel|construct\w*|contract\w*|piping|pipeline|structur\w*|marine|shipyard|heavy industr\w*|epc|projects?)\b/i;
type Judged = Pick<RatedCompany, 'rating' | 'role' | 'reason'> & { buyerType?: BuyerType | null; also?: string[] };
type JudgedRow = Pick<Row, 'company' | 'identity_quote'> & { title?: string | null; url?: string | null; domain?: string | null };
/** The source page's host when the page is the company's own (its first name word leads the address). */
const ownPageHost = (row: JudgedRow): string | null => {
  const sourceHost = hostOf(row.url);
  const firstWord = (row.company.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])[0];
  return sourceHost && firstWord && sourceHost.startsWith(firstWord) ? sourceHost : null;
};
/** What the rules may know about the search: the stockist setting and the searched countries. */
export interface ConsistencyOptions { resellers?: boolean; markets?: string[] }
/**
 * Organisations that do not buy the material themselves (web audit, 10 Oct): investors, holding companies,
 * offtakers and procurement agencies, government and research bodies, consultants and project managers,
 * technology licensors, recruiters, real-estate developers.
 */
const NON_BUYER_ORG = /\b(?:investment|investors?|holding compan\w*|fund|banks?|off-?takers?|procurement agency|ppp agency|regulat\w*|ministry|government (?:agency|body)|research|institutes?|universit\w*|academ\w*|consult\w*|advis\w*|project management|programme management|owner'?s engineer|licensors?|technology (?:provider|licen\w*|company|package|developer)|recruit\w*|staffing|real[- ]estate|property developer)\b/i;
/** Well-known names that are not pipe buyers: consultants, equipment makers, defunct contractors. */
const KNOWN_NON_BUYER = /^(?:aecom|black\s*&\s*veatch|jacobs|wsp|atkins(?:realis)?|mott macdonald|fichtner|parsons|arcadis|dar al[- ]handasah|siemens(?: energy)?|alstom|general electric|ge vernova|abb|schneider electric|honeywell|emerson|mitsubishi power|abengoa)\b/i;
/** Its own line says it receives or invites bids, or awards a contract: the procuring owner or agency, not a contractor. */
const AWARDS_WORK = /\b(?:receives?|invites?|qualif(?:y|ies)|shortlists?)\s+(?:\w+\s+){0,2}(?:bids?|bidders|offers)\b|\bawards?\s+(?:\w+\s+){0,4}(?:contract|deal|package)\b/i;
/** Its own line is a technology or licence deal, not construction work. */
const TECH_DEAL = /\b(?:technology (?:package|licen\w*|contract|agreement)|licen[cs]e (?:agreement|deal)|process licen\w*)\b/i;
/** The web address or the page it was named on says it sells the material: a pipe mill or stockist. */
const SELLER_DOMAIN = /(?:pipe|tube|steel|fitting|flange|valve)s?(?:mill|factory|industr\w*|company|co)?$/i;
const hostOf = (url: string | null | undefined) => { if (!url) return null; try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; } };
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const productNoun = (productName: string) => (productName.toLowerCase().match(/[a-z]+/g) ?? []).pop()?.replace(/s$/, '') ?? '';
const sellsMaterial = (r: Judged, product: string) => MATERIAL_WORD.test(r.role) || r.role.toLowerCase().includes(product.split(' ').pop() ?? product);
/** The buyer type after the guards: a seller of the material is a reseller or a competitor depending on the setting. */
export function consistentType(r: Judged, row: JudgedRow, productName: string, opts: ConsistencyOptions = {}): BuyerType | null {
  const product = productName.toLowerCase().replace(/s$/, '');
  const noun = productNoun(productName);
  if (projectName(row.company) || placeOnlyName(row.company)) return 'not_buyer';
  // A service heading or a recruiter, job board or news site is not a buyer ("MEP Contracting", "Progressive").
  // The page it was named on counts only when that page is its own (its name leads the address, as with
  // "Progressive" on progressiverecruitment.com); a company named in a news article is not the publisher.
  const ownPage = ownPageHost(row);
  if (genericServicePhrase(row.company) || [row.domain, ownPage].some((d) => d && nonCompanyDomain(d))) return 'not_buyer';
  if (KNOWN_NON_BUYER.test(row.company.trim()) || NON_BUYER_ORG.test(r.role) || TECH_DEAL.test(row.identity_quote ?? '')) return 'not_buyer';
  // A maker whose web address names the material is a mill, even when it also fabricates ("Al Gharbia" on algharbiapipe.com).
  const label = (row.domain ?? hostOf(row.url) ?? '').toLowerCase().replace(/^www\./, '').split('.')[0];
  // Its own website calls it a maker of pipe or fittings ("Pipeline Manufacturers in UAE | Al Gharbia" on
  // algharbiapipe.com), whatever role the AI gave it.
  const ownSiteMaker = Boolean(row.domain) && hostOf(row.url) === row.domain!.replace(/^www\./, '') && /\b(?:manufacturers?|makers?|mills?|producers?)\b/i.test(row.title ?? '') && /pipe|tube|fitting|flange/i.test(row.title ?? '');
  if ((MAKER.test(r.role) || ownSiteMaker) && label && SELLER_DOMAIN.test(label.replace(/[^a-z]/g, ''))) return 'competitor';
  if (MAKER.test(r.role) && sellsMaterial(r, product) && !/fabricat/i.test(r.role)) return 'competitor';
  // It receives bids or awards the contract: the procuring owner or agency, never a contractor.
  if (AWARDS_WORK.test(row.identity_quote ?? '') && new RegExp(`^\\W*${escapeRe(row.company.split(/\s+/)[0] ?? '')}`, 'i').test(row.identity_quote ?? '')
    && (r.buyerType === 'contractor' || r.buyerType === 'subcontractor')) return 'owner';
  // Its own words say it manufactures the product ("biggest stainless steel pipe suppliers and manufacturers"),
  // or its name is the product ("East Pipes"): a maker, not a buyer.
  const own = row.identity_quote ?? '';
  if (noun && /\b(?:manufactur\w*|mills?|producers?)\b/i.test(own) && new RegExp(`\\b${noun}s?\\b`, 'i').test(own) && !/fabricat/i.test(`${r.role} ${own}`)) return 'competitor';
  if (noun && new RegExp(`\\b${noun}s?\\b`, 'i').test(row.company) && !/\b(?:fabricat\w*|construct\w*|contract\w*|install\w*|engineering|erect\w*)\b/i.test(row.company)) return 'competitor';
  if (r.buyerType === 'reseller' || (TRADER.test(r.role) && sellsMaterial(r, product))) return resellersOn(opts) ? 'reseller' : 'competitor';
  if (NOT_BUYER.test(r.reason) && r.buyerType !== 'competitor') return 'not_buyer';
  // Typed a competitor while its own reason says it uses the material and nothing says it makes or sells
  // it ("Saudi Water Authority … likely uses stainless/duplex pipe"): an owner or user, not a maker.
  if (r.buyerType === 'competitor' && USES.test(r.reason) && !MAKES.test(r.reason) && !MAKER.test(r.role) && !TRADER.test(r.role))
    return OWNER_NAME.test(`${row.company} ${r.role}`) ? 'owner' : 'end_user';
  return r.buyerType ?? null;
}
const USES = /\b(?:uses?|buys?|needs?|purchas\w*|procur\w*|consum\w*|commission\w*|requires?)\b/i;
const MAKES = /\b(?:manufactur\w*|produc\w*|makes?|mills?|sells?|suppl(?:y|ies|ier))\b/i;
const OWNER_NAME = /\b(?:authority|ministry|municipal\w*|utilit\w*|water|electricity|power|energy|oil|gas|petroleum|corporation)\b/i;
/** Owners (plant, pipeline, utility owners) buy mostly through their EPCs: listed as project owners, ranked below buyers. */
export const OWNER_CEILING = 55;
/** A list entry with no website found yet stays below the likely-lead line (45). */
export const UNSEEN_CEILING = 40;
/** A directory-style page title: "Top 24 Pipeline construction contractors based in…", "Pressure Vessel Manufacturers in Malaysia". */
const LIST_PAGE = /\b(?:top\s+\d+|\d+\s+(?:best|top|leading|largest)|list of|directory|(?:compan(?:y|ies)|contractors?|manufacturers?|fabricators?|suppliers?|firms?)\s+(?:in|based in)\b)/i;
/**
 * Works only outside the searched countries: the AI said so ("Outside UAE…"), or its own line names
 * countries and none of them is searched ("Located … in Israel" for a Saudi search).
 */
export function outsideMarkets(r: Pick<Judged, 'reason'>, row: Pick<JudgedRow, 'company' | 'identity_quote'>, markets?: string[]): boolean {
  if (!markets?.length) return false;
  if (/\boutside (?:the )?(?:searched|selected|target|chosen) countr|\bonly (?:works|operates|active) (?:in|outside)\b/i.test(r.reason)) return true;
  const named = countriesInQuote(row.identity_quote ?? '', [row.company]);
  return named.length > 0 && !named.some((c) => markets.includes(c));
}
/** True when the guards turned an AI "competitor" into a buyer: its own reason said it uses the material. */
const competitorOverruled = (r: Judged, type: BuyerType | null) => r.buyerType === 'competitor' && (type === 'owner' || type === 'end_user');
/**
 * The reason shown with a rating, consistent with the type after the guards: a maker or seller of the
 * product never shows the AI's "likely to buy" ("EPIC … likely to buy stainless/duplex pipe").
 */
export function consistentReason(r: Judged, row: JudgedRow, productName: string, opts: ConsistencyOptions = {}): string {
  const type = consistentType(r, row, productName, opts);
  if (type === 'competitor' && r.buyerType !== 'competitor') return `Makes or sells ${productName}: a competitor for it, not a buyer.`;
  return r.reason;
}
/**
 * Keep the number consistent with the words: a rating cannot say "Strong" while its own reason or role
 * says the company makes the material or is not a buyer; resellers stay below end users (or are
 * competitors when he does not sell to them); fuel traders and composite makers stay low; and a bare
 * name with no work in it cannot be rated above 50 (well-known names still reach "Good").
 */
export function consistentRating(r: Judged, row: JudgedRow, productName: string, opts: ConsistencyOptions = {}): number {
  const type = consistentType(r, row, productName, opts);
  if (type === 'not_buyer' && (projectName(row.company) || placeOnlyName(row.company))) return 0;
  if (type === 'competitor') return Math.min(r.rating, 5);
  // Works only outside the searched countries: its own line names other countries only, or the AI says so.
  if (outsideMarkets(r, row, opts.markets)) return Math.min(r.rating, 30);
  // Owners buy mostly through their EPC contractors: they rank below the contractors and fabricators who buy.
  if (type === 'owner') r = { ...r, rating: Math.min(r.rating, OWNER_CEILING) };
  // The AI rated it as a competitor, but its own reason says it uses the material: rate it as a likely buyer
  // (50, "Good"); the caps below still apply, and its website check decides.
  if (competitorOverruled(r, type)) r = { ...r, rating: Math.max(r.rating, 50) };
  // A source line that is only the name ("Desert Mechanical LLC.") says nothing about the work.
  const plain = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const own = (row.identity_quote ?? '').trim();
  const bare = !own || plain(own) === plain(row.company);
  // A reseller must say itself that it stocks or supplies; a name on a price list is not enough.
  const ownSaysTrade = /\b(?:stock\w*|suppl(?:y|ies|ier|iers|ying)|trad(?:er|ers|ing)|distribut\w*|dealers?|wholesal\w*)\b/i.test(own) && !bare;
  if (type === 'reseller') return Math.min(r.rating, RESELLER_CEILING, ownSaysTrade ? 100 : 40);
  if (NOT_BUYER.test(r.reason) || type === 'not_buyer') return Math.min(r.rating, 5);
  // Fuel, oil and lubricant traders (often a fabricator's client list) do not buy the material.
  if (FUEL_TRADE.test(row.company) && !WORK_WORD.test(row.company)) return Math.min(r.rating, 10);
  // A different material named by the page or the role (composite, aluminium, plastic) is not this one.
  if (OTHER_MATERIAL.test(`${r.role} ${r.reason} ${row.title ?? ''}`) && !OTHER_MATERIAL.test(productName)) return Math.min(r.rating, 30);
  // The AI repeated the page's subject for a bare name (see parseRatings), or doubts its own rating.
  if (r.reason.startsWith(PAGE_CONTEXT)) return Math.min(r.rating, 30);
  if (WEAK.test(r.reason)) return Math.min(r.rating, 30);
  if (/\b(?:software|licensor|licen[cs]es? (?:the )?(?:process|technology)|design verification|consultan\w*|commerciali[sz]\w*(?: \w+){0,2} technolog\w*)\b/i.test(`${r.role} ${r.reason}`)) return Math.min(r.rating, 20);
  if (bare && !WORK_WORD.test(row.company)) return Math.min(r.rating, 50);
  // A bare name on someone else's list, with no website found, may not exist (web audit, 10 Oct: none of
  // the three found any web presence). It waits below the lead line until a website lookup finds one.
  // Only where the website is known to be missing (null); an AI answer being parsed does not know it yet.
  if (bare && row.domain === null && LIST_PAGE.test(row.title ?? '') && !ownPageHost(row)) return Math.min(r.rating, UNSEEN_CEILING);
  return r.rating;
}

const isBareRow = (row: Pick<Row, 'company' | 'identity_quote'>) => {
  const plain = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  // "Kawan Engineering Sdn Bhd" on a list of pressure vessel makers names its work; "MAGIC OIL" does not.
  return (!row.identity_quote?.trim() || plain(row.identity_quote) === plain(row.company)) && !WORK_WORD.test(row.company);
};
/** Parse and bound the AI answer; unknown ids, types and catalogue ids are dropped. */
export function parseRatings(text: string, rows: Row[], productId: string, opts: { resellers?: boolean } = {}): RatedCompany[] {
  const parsed = answer.safeParse(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)));
  if (!parsed.success) throw new Error('Rating answer was not in the expected form.');
  const ids = new Set(getCatalogue().items.map((i) => i.id));
  const productName = nameOf(productId);
  const out: RatedCompany[] = [];
  for (const c of parsed.data.companies) {
    const index = Number(c.id.replace(/^c/, '')) - 1;
    const row = rows[index];
    if (!row || out.some((o) => o.id === row.id)) continue;
    const typed = (BUYER_TYPES as readonly string[]).includes(c.type ?? '') ? (c.type as BuyerType) : null;
    const plainReason = clip(c.reason, 220).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    // The same reason given to 3+ bare names of one batch is the page's subject, not their work
    // (a fabricator's customer list rated "Manufactures steel tanks and pressure vessels" seven times).
    const echoed = isBareRow(row) && parsed.data.companies.filter((o) => {
      const other = rows[Number(o.id.replace(/^c/, '')) - 1];
      return other && isBareRow(other) && clip(o.reason, 220).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === plainReason;
    }).length >= 3;
    const judged = { rating: Math.max(0, Math.min(100, Math.round(c.rating))), role: clip(c.role, 60) || 'Not clear yet', reason: `${echoed ? PAGE_CONTEXT : ''}${clip(c.reason, 220)}`, buyerType: typed };
    const raw = judged.rating;
    const rating = consistentRating(judged, row, productName, opts);
    const buyerType = consistentType(judged, row, productName, opts);
    out.push({ id: row.id, rating, role: judged.role, reason: judged.reason, buyerType,
      match: (MATCHES as readonly string[]).includes(c.match ?? '') && rating >= 10 ? (c.match as MatchStrength) : null,
      also: rating < 10 ? [] : [...new Set(c.also.filter((a) => ids.has(a) && a !== productId))].slice(0, 4), source: 'ai', raw });
  }
  return out;
}

/**
 * Rate rows with no database: rules first, then the AI in batches of 20 (one retry for names an answer
 * skipped), then the plain heuristic. `providerFor` gives one provider per batch (budgeted in searches).
 */
export async function rateRows(rows: RateRow[], ctx: RateContext, providerFor: ((batchKey: string) => LLMProvider) | null, runId?: string): Promise<RatedCompany[] & { aiCalls?: number; warning?: string }> {
  const productName = nameOf(ctx.productId);
  const rated: RatedCompany[] & { aiCalls?: number; warning?: string } = [];
  const open: Row[] = [];
  for (const r of rows) {
    const fixed = ruleRating(r.company, r.identity_quote, productName, ctx);
    if (fixed) rated.push({ id: r.id, ...fixed }); else open.push(r);
  }
  let aiCalls = 0, warning: string | undefined;
  const queue: Row[][] = [];
  for (let i = 0; i < open.length; i += RATING_BATCH) queue.push(open.slice(i, i + RATING_BATCH));
  while (queue.length) {
    const batch = queue.shift()!;
    let answers: RatedCompany[] = [];
    // Rows handed to smaller batches (a model refused the request as too large for its per-minute cap).
    const resplit = new Set<string>();
    for (const [attempt, part] of [[0, batch], [1, null]] as const) {
      const todo = part ?? batch.filter((r) => !answers.some((a) => a.id === r.id));
      if (!todo.length || (attempt === 1 && !answers.length)) break;
      const provider = providerFor?.(`rating:${todo[0].id}:${attempt}`) ?? null;
      if (!provider || provider.name === 'mock') break;
      try {
        const prompt = ratingPrompt(ctx.productId, todo, ctx);
        const res = await provider.complete({ ...prompt, json: true, maxTokens: 700 + todo.length * 160, temperature: 0, purpose: 'shortlist_rating', runId, singleAttempt: true });
        aiCalls++;
        answers = [...answers, ...parseRatings(res.text, todo, ctx.productId, ctx)];
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/request too large/i.test(message) && todo.length > 4) {
          const half = Math.ceil(todo.length / 2);
          queue.unshift(todo.slice(0, half), todo.slice(half));
          for (const r of todo) resplit.add(r.id);
          break;
        }
        warning = `AI rating unavailable (${message.slice(0, 120) || 'error'}); plain rules rated the rest.`;
        break;
      }
    }
    for (const r of batch) if (!resplit.has(r.id)) rated.push(answers.find((a) => a.id === r.id) ?? { id: r.id, ...heuristicRating(r.company, r.identity_quote, r.title, productName, ctx) });
  }
  rated.aiCalls = aiCalls;
  rated.warning = warning;
  return rated;
}

async function save(db: Queryable, r: RatedCompany) {
  await db.query(`update research_candidates set rating=$2,rating_role=$3,rating_reason=$4,rating_also=$5::text[],rating_source=$6,rating_buyer_type=$7,rating_match=$8,rated_at=now() where id=$1`,
    [r.id, r.raw ?? r.rating, r.role, r.reason, r.also, r.source, r.buyerType, r.match]);
}

/**
 * Verification order follows the rating: queued website lookups and reads of a rated company move up
 * (700 + rating) or, below LOOKUP_FLOOR, to the back (5), so the lookup allowance goes to likely buyers.
 */
export async function prioritiseRated(db: Queryable, runId: string, rated: (Pick<RatedCompany, 'id' | 'rating'> & { buyerType?: BuyerType | null })[]) {
  for (const r of rated) {
    const priority = verifyPriority(r.rating, r.buyerType);
    await db.query(`update research_jobs set priority=$3 where run_id=$1 and state='queued'
      and (key='official:'||$2 or key='bundle:'||$2 or (stage='read' and payload->'raw'->'research'->>'candidateId'=$2))`, [runId, r.id, priority]);
  }
}
/** Rated likely buyers are verified first. */
export const VERIFY_FIRST = 45;
/**
 * Priority of checking one company (find its website, read it, judge it). Likely buyers go ahead of further
 * list searches (1000) and list reading (950), so a search verifies leads as it goes instead of spending
 * its AI on more names first; below award triggers (2000).
 */
export const verifyPriority = (rating: number | null | undefined, type?: BuyerType | string | null) =>
  // Stockists, competitors and non-buyers are never leads: their checks go last.
  type === 'reseller' || type === 'competitor' || type === 'not_buyer' || type === 'owner' ? 5
  : rating == null ? 30 : rating >= VERIFY_FIRST ? 1100 + rating : rating >= LOOKUP_FLOOR ? 700 + rating : 5;

/** The rating context of a search from its stored input. */
type SearchInput = Partial<Pick<RunInput, 'productId' | 'query' | 'includeResellers' | 'markets'>>;
export const rateContext = (input: SearchInput): RateContext =>
  ({ productId: input.productId!, query: input.query, resellers: input.includeResellers !== false, markets: input.markets });

/**
 * Rate up to `limit` unrated companies of a search and save the ratings. With an AI provider, plain-rule
 * guesses are rated again; definite rule decisions are kept.
 */
export async function rateCandidates(db: Db, runId: string, input: SearchInput, providerFor: ((batchKey: string) => LLMProvider) | null, limit = 120): Promise<{ rated: RatedCompany[]; aiCalls: number; warning?: string }> {
  const ctx = rateContext(input);
  const productName = nameOf(ctx.productId);
  const ai = Boolean(providerFor);
  const rows = (await db.query<Row & { rating_source: string | null }>(`select c.id,c.company,c.identity_quote,d.title,c.rating_source from research_candidates c left join source_documents d on d.id=c.identity_document_id
    where c.run_id=$1 and (c.rating is null or ($3 and c.rating_source='rules')) order by c.rating is not null, c.created_at limit $2`, [runId, limit, ai])).rows
    .filter((r) => r.rating_source === null || !ruleRating(r.company, r.identity_quote, productName, ctx));
  const rated = await rateRows(rows, ctx, providerFor, runId);
  for (const r of rated) await save(db, r);
  await prioritiseRated(db, runId, rated);
  return { rated: [...rated], aiCalls: rated.aiCalls ?? 0, warning: rated.warning };
}
