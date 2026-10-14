/**
 * The search brief (docs/mvp/20 §4): what the typed item is, which kinds of work buy it in each chosen country,
 * the headline words of that work (English and the country's own language), the owners, the places, and who
 * only looks like a buyer. Searches are built from the work, never from the product name alone.
 *
 * Written once per wording and set of countries by the AI, grounded in recent news from those countries and
 * seeded with the catalogue's knowledge; checked here (the rules from the 10 Oct proof runs) and cached.
 * Without AI, the catalogue brief keeps today's behaviour.
 */
import type { Queryable } from '@/mvp/db';
import type { LLMProvider } from '@/mvp/llm';
import { firstJsonObject } from '@/mvp/llm/groq';
import { getCatalogueItem, getNeedsMap } from '@/mvp/config/buyers-config';
import { isSearchItemId } from '@/mvp/discovery/item';
import { COUNTRIES } from '@/mvp/config/countries';
import { countryLanguage } from '@/mvp/config/country-meta';
import { MATERIAL_ACTIVITIES } from '@/mvp/discovery/material';
import { whoBuys } from '@/mvp/discovery/material-catalogue';
import { parseMaterialSpec, specUses } from '@/mvp/discovery/spec';

export const BRIEF_VERSION = 3;
/** A brief is reused for this long; work in a market changes slowly, but not never. */
export const BRIEF_TTL_DAYS = 30;

export interface BriefUse {
  /** A kind of plant, project or service contract ("gas processing plant"), never a part or assembly. */
  name: string;
  /** English headline words of this work, never the item's own words. */
  newsWords: string[];
  /** One line: why this work needs the item (shown as the lead's "why they need it"). */
  why: string;
  /** Chosen countries where this work is significant (empty = all). */
  countries: string[];
  /** Headline words in each non-English country's own language. */
  localWords: Record<string, string[]>;
}
export type Buying = 'project' | 'steady' | 'both';
/** What kind of thing the item is (docs/mvp/22 §3.4): equipment is bought early and by package, materials in bulk. */
export type ItemKind = 'material' | 'static_equipment' | 'rotating_equipment' | 'electrical' | 'instrumentation' | 'consumable' | 'service' | 'other';
const ROTATING_ITEM = /\b(?:fans?|blowers?|pumps?|compressors?|turbines?|agitators?|mixers?|gearbox(?:es)?)\b/i;
const STATIC_ITEM = /\b(?:vessels?|separators?|exchangers?|tanks?|columns?|reactors?|drums?|scrubbers?|coolers?|condensers?|heaters?|boilers?|silos?|hoppers?|knock-?out pots?)\b/i;
/** The kind the item's own words show (fans are rotating, vessels are static), else null. */
export function kindFromWords(words: string): ItemKind | null {
  return ROTATING_ITEM.test(words) ? 'rotating_equipment' : STATIC_ITEM.test(words) ? 'static_equipment' : null;
}
const ITEM_KINDS = new Set<ItemKind>(['material', 'static_equipment', 'rotating_equipment', 'electrical', 'instrumentation', 'consumable', 'service', 'other']);
/** A kind of maker or seller ("fan manufacturers"), never a company name. */
const MAKER_KIND = /\b(?:manufactur\w*|makers?|fabricat\w*|suppliers?|stockists?|traders?|distribut\w*|vendors?|oems?|workshops?|mills?|producers?|dealers?|shops?|yards?|exporters?|importers?)\b/i;
/** A kind of organisation ("refinery operators", "water utilities"), never a company name. */
const BUYER_KIND = /\b(?:operators?|utilit\w*|authorit\w*|plants?|compan\w*|producers?|refiner\w*|municipal\w*|ministr\w*|developers?|contractors?|owners?|stations?|boards?|corporations?|agenc\w*|departments?|councils?|ports?|airports?|hospitals?|factor\w*|mills?|manufacturers?|industr\w*|governments?|bodies|institutions?|facilit\w*|packagers?|integrators?|builders?|firms?)\b/i;
export interface SearchBrief {
  version: number;
  item: string;
  /** Conditions implied by the item's own words (service temperature, pressure class, grade); never sizes. */
  mustHave: string[];
  buying: Buying;
  uses: BriefUse[];
  buyerRoles: string[];
  notBuyers: string[];
  owners: string[];
  /** Per country: its own-language name, then main industrial cities, ports and hubs. */
  places: Record<string, string[]>;
  source: 'ai' | 'catalogue';
  /** The catalogue item it was seeded from. */
  productId: string | null;
  /** docs/mvp/22 (brief v3; absent in older briefs). */
  kind?: ItemKind;
  /** Other names of exactly this item used in tenders and specifications. */
  synonyms?: string[];
  /** How tender titles phrase buying it ("supply of centrifugal fans"). */
  tenderWords?: string[];
  /** Kinds of organisations that buy it directly through their own tenders or orders. */
  directBuyers?: string[];
  /** Kinds of companies that make, fabricate or sell it: competitors, never buyers. */
  makers?: string[];
  /** The item's own name in each non-English market's language (tender searches). */
  localItem?: Record<string, string[]>;
}

const nameOf = (code: string) => COUNTRIES.find((c) => c.code === code)?.name ?? code;
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');
// A syntactically valid JSON answer can still contain serialized fragments as
// string values. Never send those fragments to a paid search provider.
const atom = (v: unknown, len: number) => {
  const s = clip(v, len);
  return /[{}\[\]"\\]|^(?:places|owners|countries|uses|localWords|:)$/i.test(s) ? '' : s;
};
const strings = (v: unknown, max: number, len = 60): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => atom(x, len)).filter(Boolean))].slice(0, max) : [];
const SIZE = /\b\d+(?:[./-]\d+)?\s?(?:"|inch(?:es)?|in\b|mm\b|nb\b|dn\b|nps\b)|\b(?:dn|nps)\s?\d+|\bsch(?:edule)?\s?\d+/i;
const GENERIC_WORK_WORDS=new Set(['plant','plants','gas','oil','water','process','project','projects','contract','contracts','construction','network','pipeline','facility','industrial','engineering','energy','maintenance']);
/** Cached briefs sometimes contain only "plant". Use the actual work phrase in
 * searches rather than spending requests on a generic industrial keyword. */
export function workQueryWords(use:BriefUse):string[] {
  const specific=use.newsWords.filter(w=>!GENERIC_WORK_WORDS.has(w.toLowerCase())&&atom(w,80));
  return specific.length?specific:[use.name];
}

/** The item's own words ("stud bolts and gaskets" → stud, bolt, gasket), which never count as work words (rule 6). */
export function itemWords(...texts: string[]): Set<string> {
  return new Set(texts.join(' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)
    .flatMap((w) => [w, w.replace(/(?:es|s)$/, '')]));
}
const isItemWord = (phrase: string, own: Set<string>) =>
  phrase.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).some((w) => own.has(w) || own.has(w.replace(/(?:es|s)$/, '')));

/** What the catalogue knows about who buys the nearest item, given to the AI as seed facts (rule 11). */
export function seedFacts(productId: string | null): string[] {
  if (!productId) return [];
  const activities = (MATERIAL_ACTIVITIES[productId] ?? []).map((a) => `work: ${a}`);
  const roles = getNeedsMap().rules.flatMap((rule) => rule.groups.flatMap((group) =>
    group.items.filter((item) => item.id === productId).map((item) => `${rule.label}: ${item.why ?? ''}`.trim())));
  return [...new Set([...activities, ...roles])].slice(0, 10);
}

/** Procurement applications, not company seeds or confirmed requirements. The
 * stainless catalogue previously knew only the word 'piping', so a malformed or
 * narrow brief could lose entire consuming industries. Keep these in its plan. */
function consumingUses(productId:string|null):BriefUse[] {
  if(productId!=='ss-duplex-pipe')return [];
  return [
    {name:'oil & gas processing plant',newsWords:['gas processing','LNG','NGL'],why:'Potential corrosion-resistant process piping; exact grade and purchase requirement must be checked.'},
    {name:'chemical process plant',newsWords:['chemical plant','petrochemical','process piping'],why:'Potential process-piping application; exact specification is not established by the project type.'},
    {name:'food and pharmaceutical process plant',newsWords:['brewery','fermentation','pharmaceutical'],why:'Potential hygienic process piping; the required grade and finish remain unconfirmed.'},
  ].map(u=>({...u,countries:[],localWords:{}}));
}

export function briefPrompt(material: string, markets: string[], ground: string[], seed: string[]): { system: string; user: string } {
  const foreign = markets.filter((m) => countryLanguage(m) !== 'en');
  return {
    system: 'You are a senior procurement and business-development expert for industrial products: materials, static and rotating equipment, electrical and instrumentation items, consumables. A supplier tells you what it sells; you explain how exactly that item is bought (respecting any service condition or standard in its words): its tender wording, who buys it directly, and which work consumes or installs it, so its open tenders and buyers can be found. Reply with JSON only.',
    user: `Item sold: "${material}". Markets: ${markets.map(nameOf).join(', ')}.
${ground.length ? `Recent news in these markets mentioning the item (rank the uses by what is actually being built or maintained there; ignore anything off-topic):\n${ground.slice(0, 12).join('\n')}\n` : ''}${seed.length ? `Facts from our catalogue about who buys the nearest product (use them; you may add uses, do not drop these):\n${seed.map((s) => `- ${s}`).join('\n')}\n` : ''}Return {"item": short name,
"kind": one of material|static_equipment|rotating_equipment|electrical|instrumentation|consumable|service|other,
"synonyms": [up to 6 other names of EXACTLY this item used in tenders, specifications and trade (e.g. "shell and tube heat exchanger" for an API 660 exchanger, "twin lobe blower" for a roots blower); never a broader, related or different item (an atmospheric storage tank is not a pressure vessel), never a single generic word],
"tenderWords": [up to 4 phrases that tender and RFQ titles use when buying it, e.g. "supply of centrifugal fans"],
"directBuyers": [up to 6 KINDS of organisations (never company names) that buy it directly through their own tenders or purchase orders, e.g. water utilities, refinery operators, power utilities, metro authorities],
"makers": [up to 6 KINDS of companies (never company names) that make, fabricate, stock or sell it, e.g. "pressure vessel fabricators", "fan manufacturers": competitors, never buyers],
"mustHave": [conditions implied by the item's own words, e.g. service temperature, pressure class, material grade or standard; never sizes, never generic standards of the wider product family],
"buying": "project" if bought per construction project, "steady" if bought continuously for maintenance or fabrication, "both" if both,
"uses": 3-6 kinds of WORK that need exactly this item, most spending first. A use is a kind of plant, project, facility or service contract that consumes or installs the item (e.g. "gas processing plant", "refinery revamp", "wastewater treatment plant", "metro tunnel ventilation", "cement plant", "plant maintenance contract"), never a part, assembly or component. Never list work where a different item is standard for that job. Equipment is bought early (at tender, FEED or right after the EPC award) by the EPC contractor, a packager or the operator; materials are bought during construction and maintenance.
  [{"name": "short name of the work", "newsWords": [2-4 short English words that appear in news headlines about such work, never the item's own words], "why": "one line: why this work needs this item",
    "countries": [codes of the markets where this work is significant: ${markets.join(', ')}]${foreign.length ? `,
    "localWords": {${foreign.map((m) => `"${m}": [2-4 words local news in ${nameOf(m)} uses in headlines about this work, in its own language]`).join(', ')}}` : ''}}],
  Rank the uses per market: what this item is really bought for in each country (they can differ a lot between countries).
"buyerRoles": [who procures it for that work, e.g. EPC contractors (equipment package), piping or mechanical subcontractors, skid packagers, MEP contractors, operators replacing it], "notBuyers": [work or companies that look related but do not need this exact item],
"owners": [up to 6 main project owners or plant operators in these markets whose work uses it],
"places": {${markets.map((m) => `"${m}": [the country's name in its own language, then up to 10 main industrial cities, ports and hubs of ${nameOf(m)}]`).join(', ')}}${foreign.length ? `,
"localItem": {${foreign.map((m) => `"${m}": [up to 3 names of this item as tenders in ${nameOf(m)} write it, in its own language]`).join(', ')}}` : ''}}`,
  };
}

/** Parse and check the AI's brief; null when it fails the checks (the catalogue brief is used instead). */
export function parseBrief(text: string, material: string, markets: string[], productId: string | null): SearchBrief | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(firstJsonObject(text) ?? 'null') as Record<string, unknown>; } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const own = itemWords(material, clip(raw.item, 80));
  const uses: BriefUse[] = (Array.isArray(raw.uses) ? raw.uses : []).slice(0, 6).flatMap((u: Record<string, unknown>) => {
    const name = atom(u?.name, 80);
    // Rule 6: a use's headline words are the work, never the item's own words.
    const newsWords = strings(u?.newsWords, 4, 40).filter((w) => !isItemWord(w, own));
    if (!name || !newsWords.length) return [];
    const local = (u?.localWords && typeof u.localWords === 'object' ? u.localWords : {}) as Record<string, unknown>;
    return [{ name, newsWords, why: clip(u?.why, 200), countries: strings(u?.countries, 30, 3).map((c) => c.toUpperCase()).filter((c) => markets.includes(c)),
      localWords: Object.fromEntries(markets.filter((m) => countryLanguage(m) !== 'en').map((m) => [m, strings(local[m], 4, 40).filter((w) => !isItemWord(w, own))]).filter(([, w]) => w.length)) }];
  });
  if (uses.length < 2) return null;
  const buying = raw.buying === 'project' || raw.buying === 'steady' ? raw.buying : 'both';
  const placesRaw = (raw.places && typeof raw.places === 'object' ? raw.places : {}) as Record<string, unknown>;
  const localRaw = (raw.localItem && typeof raw.localItem === 'object' ? raw.localItem : {}) as Record<string, unknown>;
  // Machines that move a fluid are rotating equipment whatever the AI said (live run, 14 Oct: "centrifugal fan
  // (static equipment)"); the kind decides whether fabricators are competitors (fabricatedItem).
  const aiKind = ITEM_KINDS.has(raw.kind as ItemKind) ? raw.kind as ItemKind : 'other';
  const kind: ItemKind = (kindFromWords(`${clip(raw.item, 80)} ${material}`) === 'rotating_equipment' ? 'rotating_equipment' : null) ?? aiKind;
  // Other names must still be this item: two words or a code, sharing a word with it ("ASME Section VIII vessel" for a
  // pressure vessel; never "API 650 tank", a different item), never a lone "fan" (live run, 14 Oct).
  const own2 = itemWords(material, clip(raw.item, 80));
  const synonyms = strings(raw.synonyms, 6, 80).filter((w) => (w.trim().split(/\s+/).length >= 2 || /\d/.test(w)) && isItemWord(w, own2));
  // Kinds, never names: a named EPC listed as a "maker" would reject a real buyer (live run, 14 Oct: Technip Energies).
  const makers = strings(raw.makers, 6, 80).filter((w) => MAKER_KIND.test(w));
  const directBuyers = strings(raw.directBuyers, 6, 80).filter((w) => BUYER_KIND.test(w));
  return {
    version: BRIEF_VERSION, item: atom(raw.item, 80) || material, source: 'ai', productId,
    kind, synonyms, tenderWords: strings(raw.tenderWords, 4, 80), directBuyers, makers,
    localItem: Object.fromEntries(markets.filter((m) => countryLanguage(m) !== 'en').map((m) => [m, strings(localRaw[m], 3, 60)]).filter(([, w]) => w.length)),
    // Check 4: conditions only, never sizes.
    mustHave: strings(raw.mustHave, 6, 80).filter((m) => !SIZE.test(m)),
    buying, uses: [...consumingUses(productId).filter(u=>!uses.some(v=>v.name.toLowerCase()===u.name.toLowerCase())),...uses].slice(0,9),
    buyerRoles: strings(raw.buyerRoles, 6, 80), notBuyers: strings(raw.notBuyers, 8, 100), owners: strings(raw.owners, 6, 80),
    places: Object.fromEntries(markets.map((m) => [m, strings(placesRaw[m], 11, 40)])),
  };
}

/** Today's knowledge as a brief: the catalogue item's activities and buyers (used when the AI is unavailable). */
export function catalogueBrief(material: string, markets: string[], productId: string | null): SearchBrief {
  const item = productId ? getCatalogueItem(productId) : undefined;
  const activities = productId ? [...(MATERIAL_ACTIVITIES[productId] ?? []), ...specUses(productId,parseMaterialSpec(material))] : [];
  const own = itemWords(material, item?.shortName ?? '');
  const uses = activities.map((a) => ({ name: a, newsWords: a.split(/\s+/).filter((w) => w.length >= 3 && !isItemWord(w, own)).slice(0, 3),
    why: `${a} uses ${item?.shortName ?? material}.`, countries: [], localWords: {} })).filter((u) => u.newsWords.length);
  const name = item?.shortName ?? material;
  return { version: BRIEF_VERSION, item: name, mustHave: [], buying: 'both', uses:[...consumingUses(productId),...uses], buyerRoles: productId ? whoBuys(productId) : [],
    notBuyers: [], owners: [], places: Object.fromEntries(markets.map((m) => [m, []])), source: 'catalogue', productId,
    kind: productId && isSearchItemId(productId) ? kindFromWords(material) ?? 'other' : 'other', synonyms: (item?.keywords ?? []).filter((k) => k.includes(' ')).slice(0, 6), tenderWords: [`supply of ${name}`], directBuyers: [], makers: [], localItem: {} };
}

/** Search the consuming work, not an ASTM catalogue. This is planning knowledge,
 * never a list of seeded companies or evidence of any specific purchase. */
export function groundingQuery(material: string, productId: string | null, market: string): string {
  if (isSearchItemId(productId)) return `${material} tender supply project ${nameOf(market)}`;
  const spec = productId ? specUses(productId, parseMaterialSpec(material)) : [];
  const activities = productId ? MATERIAL_ACTIVITIES[productId] ?? [] : [];
  const work = spec[0] ?? activities[0] ?? material;
  return `${work} EPC construction ongoing projects ${nameOf(market)}`;
}

/** Same wording and countries → same brief ("Cryogenic  Valves" = "cryogenic valves"; country order ignored). */
export function briefKey(material: string, markets: string[]): string {
  return `v${BRIEF_VERSION}:${material.toLowerCase().replace(/\s+/g, ' ').trim()}:${[...new Set(markets.map((m) => m.toUpperCase()))].sort().join(',')}`;
}

/** Recent news mentioning the item in one country, as "date title: snippet" lines (grounding, rule from round 2). */
export type GroundFn = (query: string, market: string) => Promise<{ title: string; snippet: string; date: string | null }[]>;

/**
 * The brief for this wording and these countries: cached if written in the last BRIEF_TTL_DAYS, otherwise
 * grounded, written by the AI, checked, and cached. Any failure → the catalogue brief (not cached, so the next
 * search tries the AI again).
 */
export async function getSearchBrief(db: Queryable, input: { material: string; markets: string[]; productId: string | null },
  provider: LLMProvider | null, ground: GroundFn | null, runId?: string): Promise<SearchBrief> {
  const markets = [...new Set(input.markets.map((m) => m.toUpperCase()))];
  const key = briefKey(input.material, markets);
  const cached = (await db.query<{ brief: SearchBrief }>(
    `select brief from search_briefs where key=$1 and created_at > now() - ($2 || ' days')::interval`, [key, String(BRIEF_TTL_DAYS)])).rows[0];
  if (cached) return cached.brief;
  const fallback = catalogueBrief(input.material, markets, input.productId);
  if (!provider || provider.name === 'mock') return fallback;
  const lines: string[] = [];
  if (ground) for (const market of markets) {
    const found = await ground(groundingQuery(input.material,input.productId,market), market).catch(() => []);
    for (const f of found.slice(0, 6)) lines.push(`- ${f.date ?? ''} ${clip(f.title, 140)}: ${clip(f.snippet, 220)}`);
  }
  try {
    const prompt = briefPrompt(input.material, markets, lines, seedFacts(input.productId));
    const res = await provider.complete({ ...prompt, json: true, maxTokens: 2200, temperature: 0, purpose: 'search_brief', runId, singleAttempt: true });
    const brief = parseBrief(res.text, input.material, markets, input.productId);
    if (!brief) return fallback;
    await db.query(`insert into search_briefs(key,material,markets,brief,source) values($1,$2,$3,$4::jsonb,'ai')
      on conflict(key) do update set brief=excluded.brief, source=excluded.source, created_at=now()`, [key, input.material, markets, JSON.stringify(brief)]);
    return brief;
  } catch {
    return fallback;
  }
}

/**
 * Does the page name one of the brief's kinds of work (English or a country's own words)? Award news names the
 * project, almost never the valve or the pipe, so in a work-based search this, not the product name, lets an
 * article through to the need check, which then decides who (if anyone) buys.
 */
export function namesWork(text: string, brief: SearchBrief): boolean {
  if(/\b(?:market report|market size|cagr|job vacancy)\b/i.test(text))return false;
  const generic=GENERIC_WORK_WORDS;
  const has=(phrase:string,span:string)=>new RegExp(`(?:^|[^\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(span);
  // "Plant" or "gas" alone matched strike/finance stories and navigation. Match a
  // distinctive work phrase, or two related words in the SAME short source span.
  return brief.uses.some(u=>{
    const words=[u.name,...u.newsWords,...Object.values(u.localWords).flat()].filter(w=>w.length>=2);
    return text.split(/\n+|(?<=[.!?])\s+/).some(span=>{
      const bounded=span.slice(0,1600);
      const canonical=bounded.toLowerCase().replace(/\bprocessing\b/g,'process');
      const useWords=u.name.toLowerCase().replace(/\bprocessing\b/g,'process').match(/[\p{L}\p{N}]+/gu)??[];
      const core=useWords.filter(w=>!['and','or','oil','plant','plants','project','facility','industrial','engineering'].includes(w));
      return words.some(w=>!generic.has(w.toLowerCase())&&has(w,bounded))
        || core.length>=2&&core.every(w=>has(w,canonical))
        || [...new Set(u.newsWords.map(w=>w.toLowerCase()))].filter(w=>has(w,bounded)).length>=2;
    });
  });
}

/**
 * The brief's use an AI answer means, matched loosely: the same name in any case, one name inside the other
 * ("LNG export terminal (Ruwais)"), or one of the use's headline words. The 10 Oct smoke test lost every lead
 * to an exact-name comparison.
 */
export function matchUse(brief: SearchBrief, answer: string | null | undefined): BriefUse | null {
  const a = (answer ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!a || a === 'null' || a === 'none') return null;
  return brief.uses.find((u) => u.name.toLowerCase() === a)
    ?? brief.uses.find((u) => a.includes(u.name.toLowerCase()) || u.name.toLowerCase().includes(a))
    ?? brief.uses.find((u) => u.newsWords.some((w) => w.length >= 3 && a.includes(w.toLowerCase())))
    ?? null;
}

/** This country's uses first (they differ between countries), at most `n`. */
export function usesFor(brief: SearchBrief, market: string, n = 4): BriefUse[] {
  const local = brief.uses.filter((u) => !u.countries.length || u.countries.includes(market));
  return (local.length ? local : brief.uses).slice(0, n);
}

/**
 * A typed item that is fabricated (pressure vessels, separators, heat exchangers, tanks): steel and equipment
 * fabricators make it, so they are its competitors, not its buyers (live run, 14 Oct: a Saudi metal fabricator
 * was saved as a pressure-vessel buyer). For a material (plate, pipe) a fabricator is still a buyer.
 */
export function fabricatedItem(brief?: Pick<SearchBrief, 'productId' | 'kind'> | null): boolean {
  return Boolean(brief?.productId && isSearchItemId(brief.productId) && brief.kind === 'static_equipment');
}
