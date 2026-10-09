/**
 * Shortlist rating (docs/mvp/18 §5). A search names far more companies than it can verify (125 names,
 * 24 website lookups in the 9 Oct steel plates run), so every named company is rated from the sentence
 * that named it: how likely it is to BUY the searched material, in plain words, with other catalogue
 * products it would likely buy. One AI call rates up to 40 names; obvious non-buyers are rated by rules.
 * The rating orders verification (best first) and lets the user see likely buyers before they are
 * verified. It is never shown as proof.
 */
import { z } from 'zod';
import type { Db, Queryable } from '@/mvp/db';
import type { LLMProvider } from '@/mvp/llm/types';
import type { RunInput } from '@/mvp/types';
import { getCatalogue, getCatalogueItem } from '@/mvp/config/buyers-config';
import { whoBuys } from '@/mvp/discovery/material-catalogue';
import { junkFoundName, looksLikeSupplier } from '@/mvp/sourcing/names';

/** Small batches: with 40 names the model skipped some and let one page's context bleed into others. */
export const RATING_BATCH = 20;
/** Below this a company is not worth a website lookup before better-rated ones. */
export const LOOKUP_FLOOR = 25;

export interface RatedCompany { id: string; rating: number; role: string; reason: string; also: string[]; source: 'ai' | 'rules' }
interface Row { id: string; company: string; identity_quote: string | null; title: string | null }

const clip = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Gulf place and company-form words: "JURF AJMAN UAE", "AL SAJJA SHARJAH UAE" are places, not companies.
const PLACE_OR_FORM = new Set(['uae', 'ksa', 'gcc', 'dubai', 'abu', 'dhabi', 'sharjah', 'ajman', 'ras', 'al', 'khaimah', 'rak', 'hamriyah', 'jurf', 'ghail', 'sajja', 'jebel', 'ali',
  'fujairah', 'umm', 'quwain', 'qatar', 'doha', 'oman', 'muscat', 'saudi', 'arabia', 'riyadh', 'jeddah', 'dammam', 'jubail', 'india', 'malaysia', 'norway',
  'fze', 'fzc', 'fzco', 'llc', 'ind', 'area', 'industrial', 'zone', 'free', 'city']);
/** A name made only of place and company-form words. */
export function placeOnlyName(name: string): boolean {
  const words = name.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.length > 0 && words.every((w) => PLACE_OR_FORM.has(w));
}

/** Rules for names that need no AI: page furniture, places, certifiers and sellers of the material. */
export function ruleRating(name: string, quote: string | null, productName: string): Omit<RatedCompany, 'id'> | null {
  if (placeOnlyName(name)) return { rating: 0, role: 'Not a buyer', reason: 'A place name, not a company.', also: [], source: 'rules' };
  const junk = junkFoundName(name, quote);
  if (junk) return { rating: 0, role: 'Not a buyer', reason: `Not a company that buys materials (${junk}).`, also: [], source: 'rules' };
  if (looksLikeSupplier(quote)) return { rating: 3, role: `Seller of ${productName}`, reason: `Sells ${productName}: a competitor, not a buyer.`, also: [], source: 'rules' };
  return null;
}

const ROLE_RULES: [RegExp, string, number][] = [
  [/\b(?:pressure vessels?|heat exchangers?|storage tanks?|boilers?|columns?|reactors?)\b/i, 'Process equipment fabricator', 72],
  [/\b(?:fabricat\w*|steel structures?|structural steel|workshop)\b/i, 'Steel fabricator', 66],
  [/\b(?:pipeline|piping)\b.*\b(?:contractor|construction|laying|installation)\b|\b(?:contractor|construction)\b.*\b(?:pipeline|piping)\b/i, 'Pipeline contractor', 66],
  [/\bepc\b|\bengineering,? procurement\b/i, 'EPC contractor', 60],
  [/\b(?:sub-?contract\w*|mechanical contractor|erection)\b/i, 'Mechanical subcontractor', 58],
  [/\b(?:contractor|construction|contracting|projects|infrastructure)\b/i, 'Contractor', 50],
  [/\b(?:lubricants?|diesel|petroleum trading|fuel trading|grease)\b/i, 'Fuel or lubricant trader', 8],
];
/**
 * Plain heuristic used without an AI provider (demo mode) or when the AI call fails. It reads only the
 * company's own name and sentence: a page title describes the page (a fabricator's client list, a
 * standards guide), never the company named on it.
 */
export function heuristicRating(name: string, quote: string | null, _title: string | null, productName: string): Omit<RatedCompany, 'id'> {
  const fixed = ruleRating(name, quote, productName);
  if (fixed) return fixed;
  const text = `${name} ${quote ?? ''}`;
  for (const [re, role, rating] of ROLE_RULES) if (re.test(text))
    return { rating, role, reason: rating >= 45 ? `${role}: this kind of work uses ${productName}. Not verified yet.` : `${role}: unlikely to buy ${productName}.`, also: [], source: 'rules' };
  return { rating: 30, role: 'Not clear yet', reason: 'The source does not say what work it does.', also: [], source: 'rules' };
}

const answer = z.object({ companies: z.array(z.object({
  id: z.string(), rating: z.coerce.number(), role: z.string().default(''), reason: z.string().default(''), also: z.array(z.string()).default([]),
})) });

/** The AI prompt: judge buying likelihood only from the given words; never invent. */
export function ratingPrompt(productId: string, rows: Row[]): { system: string; user: string } {
  const product = getCatalogueItem(productId);
  const name = product?.shortName || product?.name || productId;
  const buyers = whoBuys(productId);
  const others = getCatalogue().items.filter((i) => i.id !== productId).map((i) => ({ id: i.id, name: i.shortName || i.name }));
  return {
    system: [
      `You help an industrial supplier's sales team. Rate how likely each company is to BUY ${name} for its own work (to consume it, not to resell it).`,
      `Typical buyers of ${name}: ${buyers.join('; ') || 'contractors and fabricators that use it'}.`,
      `Not buyers (rate 0-5): makers, mills, stockists, traders and distributors of ${name} (they are competitors); certifiers, inspectors, standards bodies, regulations, publishers, software or web agencies, social networks, banks, government departments, academic institutes; fuel, oil or lubricant traders; anything that is not a company.`,
      'Judge each company separately, from its own name and its own sentence ("said"). The page title ("page") only tells you which page or list the name was on:',
      '- a name in a list titled "X manufacturers" or "X contractors" is probably such a company (rate it 50-70 unless its own words or well-known facts say more or less);',
      "- names on one company's website (its clients, partners, projects, staff history) are that company's customers or contacts, not makers of what the page is about; judge them by their own names;",
      '- composite or aluminium cylinders and vessels do not use steel plate or steel pipe.',
      'Rate above 75 only when the company\'s own sentence, or well-known facts about the company, show work that uses the material. Do not invent projects, sizes or facts.',
      'Ratings: 70-100 clearly uses this material; 45-69 plausible; 10-44 weak or unclear; 0-9 not a buyer.',
      `"role": a short plain description such as "Pressure vessel fabricator" or "Pipeline EPC contractor". "reason": one short sentence saying why they would buy ${name}, or why not. "also": ids from the catalogue list of other products they would likely buy (at most 4).`,
      'Answer JSON only: {"companies":[{"id","rating","role","reason","also"}]} with one entry per input company.',
    ].join('\n'),
    user: JSON.stringify({ product: name, catalogue: others, companies: rows.map((r, i) => ({ id: `c${i + 1}`, name: clip(r.company, 120), said: clip(r.identity_quote, 240), page: clip(r.title, 110) })) }),
  };
}

const NOT_BUYER = /\b(?:not an? (?:buyer|consumer)|does not (?:buy|use)|competitor)\b/i;
const SELLER = /\b(?:manufacturer|maker|mill|producer|supplier|stockist|distributor|dealer|trader|seller|sells|exporter)\b/i;
const FUEL_TRADE = /\b(?:lubricants?|lubechem|grease|diesel|petrol\w*|oil|refinery|refinary|trad(?:ing|g|ers?)|trdg)\b/i;
const WORK_WORD = /\b(?:fabricat\w*|engineering|vessels?|tanks?|boilers?|steel|construct\w*|contract\w*|piping|pipeline|structur\w*|marine|shipyard|heavy industr\w*|epc|projects?)\b/i;
/**
 * Keep the number consistent with the words: a rating cannot say "Strong" while its own reason or role
 * says the company sells the material or is not a buyer, fuel traders and composite makers stay low,
 * and a bare name with no work in it cannot be rated above 50 (well-known names still reach "Good").
 */
export function consistentRating(r: Omit<RatedCompany, 'id' | 'source'>, row: Pick<Row, 'company' | 'identity_quote'>, productName: string): number {
  const product = productName.toLowerCase().replace(/s$/, '');
  const sellsIt = SELLER.test(r.role) && (r.role.toLowerCase().includes(product.split(' ').pop() ?? product) || /plate|pipe|valve|fitting|flange|cable|steel/i.test(r.role));
  if (NOT_BUYER.test(r.reason) || sellsIt) return Math.min(r.rating, 5);
  // Fuel, oil and lubricant traders (often a fabricator's client list) do not buy the material.
  if (FUEL_TRADE.test(row.company) && !WORK_WORD.test(row.company)) return Math.min(r.rating, 10);
  // Composite and aluminium cylinders are not made from steel products; software and process licensors buy none.
  if (/\bcomposite|alumin/i.test(`${r.role} ${r.reason}`)) return Math.min(r.rating, 30);
  if (/\b(?:software|licensor|licen[cs]es? (?:the )?(?:process|technology)|design verification|consultan\w*)\b/i.test(`${r.role} ${r.reason}`)) return Math.min(r.rating, 20);
  const own = (row.identity_quote ?? '').trim();
  const bare = !own || own.toLowerCase() === row.company.trim().toLowerCase();
  if (bare && !WORK_WORD.test(row.company)) return Math.min(r.rating, 50);
  return r.rating;
}

/** Parse and bound the AI answer; unknown ids and catalogue ids are dropped. */
export function parseRatings(text: string, rows: Row[], productId: string): RatedCompany[] {
  const parsed = answer.safeParse(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)));
  if (!parsed.success) throw new Error('Rating answer was not in the expected form.');
  const ids = new Set(getCatalogue().items.map((i) => i.id));
  const out: RatedCompany[] = [];
  for (const c of parsed.data.companies) {
    const index = Number(c.id.replace(/^c/, '')) - 1;
    const row = rows[index];
    if (!row || out.some((o) => o.id === row.id)) continue;
    const productName = getCatalogueItem(productId)?.shortName || productId;
    const rated = { rating: Math.max(0, Math.min(100, Math.round(c.rating))), role: clip(c.role, 60) || 'Not clear yet', reason: clip(c.reason, 220),
      also: [...new Set(c.also.filter((a) => ids.has(a) && a !== productId))].slice(0, 4) };
    rated.rating = consistentRating(rated, row, productName);
    if (rated.rating < 10) rated.also = [];
    out.push({ id: row.id, ...rated, source: 'ai' });
  }
  return out;
}

async function save(db: Queryable, r: RatedCompany) {
  await db.query(`update research_candidates set rating=$2,rating_role=$3,rating_reason=$4,rating_also=$5::text[],rating_source=$6,rated_at=now() where id=$1`,
    [r.id, r.rating, r.role, r.reason, r.also, r.source]);
}

/**
 * Verification order follows the rating: queued website lookups and reads of a rated company move up
 * (700 + rating) or, below LOOKUP_FLOOR, to the back (5), so the lookup allowance goes to likely buyers.
 */
export async function prioritiseRated(db: Queryable, runId: string, rated: Pick<RatedCompany, 'id' | 'rating'>[]) {
  for (const r of rated) {
    const priority = r.rating >= LOOKUP_FLOOR ? 700 + r.rating : 5;
    await db.query(`update research_jobs set priority=$3 where run_id=$1 and state='queued'
      and (key='official:'||$2 or (stage='read' and payload->'raw'->'research'->>'candidateId'=$2))`, [runId, r.id, priority]);
  }
}

/**
 * Rate up to `limit` unrated companies of a search (rules first, then AI in batches of 40). Returns the
 * ratings saved. `providerFor` gives one budgeted provider per batch (keyed by its first company). With
 * a mock provider, or when the AI call fails, the plain heuristic rates instead.
 */
export async function rateCandidates(db: Db, runId: string, input: Pick<RunInput, 'productId'>, providerFor: ((batchKey: string) => LLMProvider) | null, limit = 120): Promise<{ rated: RatedCompany[]; aiCalls: number; warning?: string }> {
  const productId = input.productId!;
  const productName = getCatalogueItem(productId)?.shortName || productId;
  const rows = (await db.query<Row>(`select c.id,c.company,c.identity_quote,d.title from research_candidates c left join source_documents d on d.id=c.identity_document_id
    where c.run_id=$1 and c.rating is null order by c.created_at limit $2`, [runId, limit])).rows;
  const rated: RatedCompany[] = [];
  const open: Row[] = [];
  for (const r of rows) {
    const fixed = ruleRating(r.company, r.identity_quote, productName);
    if (fixed) rated.push({ id: r.id, ...fixed }); else open.push(r);
  }
  let aiCalls = 0, warning: string | undefined;
  for (let i = 0; i < open.length; i += RATING_BATCH) {
    const batch = open.slice(i, i + RATING_BATCH);
    let answers: RatedCompany[] = [];
    // One call for the batch, and one more for any names the answer skipped, before the plain rules.
    for (const [attempt, part] of [[0, batch], [1, null]] as const) {
      const todo = part ?? batch.filter((r) => !answers.some((a) => a.id === r.id));
      if (!todo.length || (attempt === 1 && !answers.length)) break;
      const provider = providerFor?.(`rating:${todo[0].id}:${attempt}`) ?? null;
      if (!provider || provider.name === 'mock') break;
      try {
        const prompt = ratingPrompt(productId, todo);
        const res = await provider.complete({ ...prompt, json: true, maxTokens: 700 + todo.length * 140, temperature: 0, purpose: 'shortlist_rating', runId, singleAttempt: true });
        aiCalls++;
        answers = [...answers, ...parseRatings(res.text, todo, productId)];
      } catch (error) {
        warning = `AI rating unavailable (${error instanceof Error ? error.message.slice(0, 120) : 'error'}); plain rules rated the rest.`;
        break;
      }
    }
    for (const r of batch) rated.push(answers.find((a) => a.id === r.id) ?? { id: r.id, ...heuristicRating(r.company, r.identity_quote, r.title, productName) });
  }
  for (const r of rated) await save(db, r);
  await prioritiseRated(db, runId, rated);
  return { rated, aiCalls, warning };
}
