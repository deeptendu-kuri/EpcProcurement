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
import { COUNTRIES } from '@/mvp/config/countries';
import { countryLanguage } from '@/mvp/config/country-meta';
import { MATERIAL_ACTIVITIES } from '@/mvp/discovery/material';
import { whoBuys } from '@/mvp/discovery/material-catalogue';

export const BRIEF_VERSION = 1;
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
}

const nameOf = (code: string) => COUNTRIES.find((c) => c.code === code)?.name ?? code;
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const strings = (v: unknown, max: number, len = 60): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => clip(x, len)).filter(Boolean))].slice(0, max) : [];
const SIZE = /\b\d+(?:[./-]\d+)?\s?(?:"|inch(?:es)?|in\b|mm\b|nb\b|dn\b|nps\b)|\b(?:dn|nps)\s?\d+|\bsch(?:edule)?\s?\d+/i;

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

export function briefPrompt(material: string, markets: string[], ground: string[], seed: string[]): { system: string; user: string } {
  const foreign = markets.filter((m) => countryLanguage(m) !== 'en');
  return {
    system: 'You are a senior procurement and business-development expert for industrial materials. A supplier tells you what it sells; you explain which work consumes exactly that item (respecting any service condition or standard in its words) so its buyers can be found in project news. Reply with JSON only.',
    user: `Item sold: "${material}". Markets: ${markets.map(nameOf).join(', ')}.
${ground.length ? `Recent news in these markets mentioning the item (rank the uses by what is actually being built or maintained there; ignore anything off-topic):\n${ground.slice(0, 12).join('\n')}\n` : ''}${seed.length ? `Facts from our catalogue about who buys the nearest product (use them; you may add uses, do not drop these):\n${seed.map((s) => `- ${s}`).join('\n')}\n` : ''}Return {"item": short name,
"mustHave": [conditions implied by the item's own words, e.g. service temperature, pressure class, material grade or standard; never sizes, never generic standards of the wider product family],
"buying": "project" if bought per construction project, "steady" if bought continuously for maintenance or fabrication, "both" if both,
"uses": 3-6 kinds of WORK that need exactly this item, most spending first. A use is a kind of plant, project or service contract (e.g. "gas processing plant", "refinery revamp", "desalination plant", "offshore platform", "water and sewer network", "plant maintenance contract"), never a part, assembly or component. Never list work where a different material is standard for that job.
  [{"name": "short name of the work", "newsWords": [2-4 short English words that appear in news headlines about such work, never the item's own words], "why": "one line: why this work needs this item",
    "countries": [codes of the markets where this work is significant: ${markets.join(', ')}]${foreign.length ? `,
    "localWords": {${foreign.map((m) => `"${m}": [2-4 words local news in ${nameOf(m)} uses in headlines about this work, in its own language]`).join(', ')}}` : ''}}],
  Rank the uses per market: what this item is really bought for in each country (they can differ a lot between countries).
"buyerRoles": [who procures it for that work], "notBuyers": [work or companies that look related but do not need this exact item],
"owners": [up to 6 main project owners or plant operators in these markets whose work uses it],
"places": {${markets.map((m) => `"${m}": [the country's name in its own language, then up to 10 main industrial cities, ports and hubs of ${nameOf(m)}]`).join(', ')}}}`,
  };
}

/** Parse and check the AI's brief; null when it fails the checks (the catalogue brief is used instead). */
export function parseBrief(text: string, material: string, markets: string[], productId: string | null): SearchBrief | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(firstJsonObject(text) ?? 'null') as Record<string, unknown>; } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const own = itemWords(material, clip(raw.item, 80));
  const uses: BriefUse[] = (Array.isArray(raw.uses) ? raw.uses : []).slice(0, 6).flatMap((u: Record<string, unknown>) => {
    const name = clip(u?.name, 80);
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
  return {
    version: BRIEF_VERSION, item: clip(raw.item, 80) || material, source: 'ai', productId,
    // Check 4: conditions only, never sizes.
    mustHave: strings(raw.mustHave, 6, 80).filter((m) => !SIZE.test(m)),
    buying, uses,
    buyerRoles: strings(raw.buyerRoles, 6, 80), notBuyers: strings(raw.notBuyers, 8, 100), owners: strings(raw.owners, 6, 80),
    places: Object.fromEntries(markets.map((m) => [m, strings(placesRaw[m], 11, 40)])),
  };
}

/** Today's knowledge as a brief: the catalogue item's activities and buyers (used when the AI is unavailable). */
export function catalogueBrief(material: string, markets: string[], productId: string | null): SearchBrief {
  const item = productId ? getCatalogueItem(productId) : undefined;
  const activities = productId ? [...(MATERIAL_ACTIVITIES[productId] ?? [])] : [];
  const own = itemWords(material, item?.shortName ?? '');
  const uses = activities.slice(0, 4).map((a) => ({ name: a, newsWords: a.split(/\s+/).filter((w) => w.length >= 3 && !isItemWord(w, own)).slice(0, 3),
    why: `${a} uses ${item?.shortName ?? material}.`, countries: [], localWords: {} })).filter((u) => u.newsWords.length);
  return { version: BRIEF_VERSION, item: item?.shortName ?? material, mustHave: [], buying: 'both', uses, buyerRoles: productId ? whoBuys(productId) : [],
    notBuyers: [], owners: [], places: Object.fromEntries(markets.map((m) => [m, []])), source: 'catalogue', productId };
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
    const found = await ground(`${input.material} project ${nameOf(market)}`, market).catch(() => []);
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
  const words = brief.uses.flatMap((u) => [...u.newsWords, ...Object.values(u.localWords).flat()]).filter((w) => w.length >= 2);
  return words.some((w) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text))
    && !/\b(?:market report|market size|cagr|job vacancy)\b/i.test(text);
}

/** This country's uses first (they differ between countries), at most `n`. */
export function usesFor(brief: SearchBrief, market: string, n = 4): BriefUse[] {
  const local = brief.uses.filter((u) => !u.countries.length || u.countries.includes(market));
  return (local.length ? local : brief.uses).slice(0, n);
}
