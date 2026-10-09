/**
 * Rules filter before any AI (05 §5). A document is:
 * - `relevant`  when it has a buying action, a scope term, a watched market and is fresh;
 * - `uncertain` when it has buying action and scope but the market or freshness is unclear
 *               (these go to P0 triage when a real model is available);
 * - `drop`      otherwise, including noise (market reports, price indices, job ads, court stories).
 * The reason is stored in source_documents.filter_reason for tuning.
 */
import { COUNTRIES } from "@/mvp/config/countries";
import type { ClientProfile, MarketCode } from "@/mvp/types";

export type FilterVerdict = "relevant" | "uncertain" | "drop";

export interface FilterResult {
  verdict: FilterVerdict;
  reason: string;
  /** Watched markets mentioned in the text (or the source's own market). */
  markets: string[];
}

export interface FilterInput {
  title: string | null;
  text: string;
  publishedAt: string | null;
  /** Markets of the run (e.g. ["IN","SA"]). */
  markets: string[];
  /** Words from the run query ("line pipe"). */
  queryTerms: string[];
  profile: ClientProfile;
  /** Market the source is specific to (fixtures, TED country), if any. */
  sourceMarket?: string | null;
  now?: Date;
}

/** Buying-action terms per language (05 §5). */
export const ACTION_TERMS = {
  en: [
    "tender", "tenders", "rfq", "rfp", "prequalification", "pre-qualification", "award", "awarded", "awards", "contract", "contracts",
    "order", "orders", "subcontract", "subcontracted", "eoi", "expression of interest", "bid", "bids", "bidding", "wins", "won",
    "secures", "secured", "bags", "invites", "invitation to tender", "procurement", "purchase order", "epc",
  ],
  ar: ["مناقصة", "مناقصات", "ترسية", "عقد", "عقود", "طرح"],
  ms: ["tender", "sebut harga", "anugerah", "dianugerahkan", "kontrak", "perolehan"],
} as const;

/**
 * Discipline and product synonyms (scope check). Product keywords from the client profile are added.
 * Only industrial scope words: generic words ("EPC", "contract", "tanks") are buying actions, not scope.
 */
export const SCOPE_TERMS = [
  "pipeline", "pipelines", "piping", "line pipe", "linepipe", "api 5l", "valve", "valves", "static equipment",
  "mechanical works", "mechanical and piping", "pressure vessel", "pressure vessels", "storage tank", "storage tanks", "tank farm",
  "heat exchanger", "heat exchangers", "pipe", "pipes", "pipelaying", "pipe laying", "pipe-laying", "flowline", "flowlines",
  "gas transmission", "water transmission", "cross-country pipeline", "spool fabrication",
  "rørledning", "rørledninger", "خط أنابيب", "أنابيب", "saluran paip", "paip",
];

/**
 * Words that say nothing about scope. They are dropped from the run query so that a query such as
 * "pipeline EPC contract" searches for pipelines, not for any contract.
 */
export const GENERIC_QUERY_TERMS = new Set([
  "contract", "contracts", "tender", "tenders", "epc", "award", "awarded", "awards", "project", "projects", "work", "works",
  "order", "orders", "supply", "supplies", "bid", "bids", "procurement", "services", "service", "company", "companies",
  "new", "lead", "leads", "opportunity", "opportunities", "subcontract", "subcontracts", "rfq", "rfp", "construction",
]);

/** Figurative uses of "pipeline" (deal/IPO/hotel pipelines) removed before the scope check. */
const FIGURATIVE_PIPELINE = [
  /\b(?:ipo|deal|deals|hotel|hotels|property|real estate|project|projects|order|sales|talent|drug|investment|investments|renewables?|re|ai|data cent(?:re|er)s?|order ?book|orderbook|defen[cs]e|ipo|listing|startup|venture|dealmaking|m&a|content|product|funding|launch|policy|development|tech|m&a|capacity|contract|contracts|housing|infrastructure|room|rooms|film|pharma|clinical|export|hiring|revenue|bid|tender|opportunity)\s+pipelines?\b/gi,
  /\bpipelines? of (?:projects|deals|orders|ipos|investments|talent|contracts|opportunities|hotels|rooms)\b/gi,
  /\bin the pipeline\b/gi,
];

/** Text with figurative "pipeline" phrases removed (for the scope check only). */
export function scopeText(text: string): string {
  return FIGURATIVE_PIPELINE.reduce((t, re) => t.replace(re, " "), text);
}

/**
 * Oil, gas and water-infrastructure words that make a "pipeline" physical (07 §2 news precision).
 * "Gas pipeline", "120 km pipeline", "water transmission pipeline" pass; "orderbook … pipeline builds",
 * "AI pipeline", "drone order pipeline" do not.
 */
const PIPELINE_DOMAIN =
  /\b(?:gas|oil|crude|petroleum|products?|lpg|lng|cng|png|natural gas|hydrocarbons?|refiner(?:y|ies)|petrochemicals?|condensate|ethane|ammonia|hydrogen|co2|carbon capture|water|desalinat\w*|sewage|sewer(?:age)?|wastewater|effluent|slurry|irrigation|drinking|jet fuel|fuel|transmission|trunk|distribution|city gas|km|kms|kilomet(?:re|er)s?|inch(?:es)?|diameter|mm|laying|lay|pumping|compressor|subsea|offshore|onshore|cross-country|steel|welded|pipe|pipes|flowlines?|spur|interconnector|terminal|gail|ongc|iocl|indian oil|aramco|adnoc|petronas|swpc|swcc|dewa|taqa)\b/i;

const PIPELINE_WORD = /\bpipelines?\b/gi;

/**
 * Is at least one "pipeline" in the text a physical oil/gas/water pipeline? Looks for a domain word
 * within 70 characters of each (non-figurative) mention. Exported for tests.
 */
export function mentionsPhysicalPipeline(text: string): boolean {
  const t = scopeText(text);
  for (const m of t.matchAll(PIPELINE_WORD)) {
    const window = t.slice(Math.max(0, m.index! - 70), m.index! + m[0].length + 70).replace(m[0], " ");
    if (PIPELINE_DOMAIN.test(window)) return true;
  }
  return false;
}

/** Scope terms for a run: query terms (minus generic words), active product keywords, core disciplines, SCOPE_TERMS. */
export function scopeTermsFor(profile: ClientProfile, queryTermList: string[]): string[] {
  const productTerms = profile.products.filter((p) => p.active).flatMap((p) => p.keywords.map((k) => k.toLowerCase()));
  const disciplineTerms = profile.disciplines.map((d) => d.replace(/_/g, " "));
  return [...new Set([...queryTermList.filter((t) => !GENERIC_QUERY_TERMS.has(t)), ...productTerms, ...disciplineTerms, ...SCOPE_TERMS])];
}

/** First scope term in the text (figurative "pipeline" ignored), or null. */
export function findScope(text: string, terms: readonly string[]): string | null {
  const t = scopeText(text);
  let physical: boolean | null = null;
  for (const term of terms) {
    if (!hasTerm(t, term)) continue;
    // A bare "pipeline" only counts when it is an oil, gas or water pipeline (not a deal/AI/order pipeline).
    if (term === "pipeline" || term === "pipelines") {
      physical ??= mentionsPhysicalPipeline(text);
      if (!physical) continue;
    }
    return term;
  }
  return null;
}

/** Country, city and demonym names per market (market check). */
export const MARKET_TERMS: Record<MarketCode, string[]> = {
  IN: ["india", "indian", "gujarat", "maharashtra", "mumbai", "delhi", "kandla", "mundra", "jamnagar", "rajasthan", "odisha", "andhra pradesh", "tamil nadu", "chennai", "kolkata", "assam", "ongc", "gail"],
  SA: ["saudi", "ksa", "riyadh", "jeddah", "jubail", "dammam", "yanbu", "ras tanura", "neom", "aramco", "السعودية", "الرياض"],
  AE: ["uae", "united arab emirates", "emirati", "abu dhabi", "dubai", "sharjah", "ruwais", "fujairah", "jebel ali", "adnoc", "الإمارات", "أبوظبي", "دبي"],
  QA: ["qatar", "qatari", "doha", "ras laffan", "mesaieed", "قطر"],
  OM: ["oman", "omani", "muscat", "duqm", "sohar", "salalah", "عمان"],
  KW: ["kuwait", "kuwaiti", "الكويت"],
  BH: ["bahrain", "bahraini", "manama", "sitra", "البحرين"],
  NO: ["norway", "norwegian", "norge", "stavanger", "bergen", "oslo", "trondheim", "hammerfest", "equinor", "kongsberg"],
  MY: ["malaysia", "malaysian", "kuala lumpur", "johor", "sarawak", "sabah", "port klang", "bintulu", "kerteh", "petronas", "pengerang"],
};

/** Noise patterns carried over from the prototype filters (05 §5 "Not noise"). */
export const NOISE_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\bmarket (?:report|size|share|research|outlook|forecast|analysis)\b|\bcagr\b|\bforecast period\b|\bmarket is (?:expected|projected|anticipated) to\b/i, reason: "noise: market report" },
  { re: /\bprice index\b|\bprices? (?:rose|fell|climbed|dropped) \d/i, reason: "noise: price index" },
  { re: /\b(?:we are hiring|job opening|apply now|vacancy|vacancies|walk-in interview)\b/i, reason: "noise: job ad" },
  { re: /\b(?:arrested|court (?:ruled|orders?)|charge ?sheet|bail|convicted|police said)\b/i, reason: "noise: court or crime story" },
  { re: /\b(?:standard operating procedure|procedure manual|user manual)\b/i, reason: "noise: procedure manual" },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does `text` contain `term` as a whole word/phrase (Latin) or substring (Arabic)? */
export function hasTerm(text: string, term: string): boolean {
  if (/[؀-ۿ]/.test(term)) return text.includes(term);
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(term)}(?:$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

function firstTerm(text: string, terms: readonly string[]): string | null {
  for (const term of terms) if (hasTerm(text, term)) return term;
  return null;
}

/**
 * Markets whose names appear in the text: the default markets by their aliases, plus any searched
 * country (`watched`) by its full name, so a Kenya search recognises "Kenya" in an article.
 */
export function detectMarkets(text: string, watched: readonly string[] = []): string[] {
  const known: string[] = (Object.keys(MARKET_TERMS) as MarketCode[]).filter((code) => MARKET_TERMS[code].some((term) => hasTerm(text, term)));
  const named = watched
    .map((code) => code.toUpperCase())
    .filter((code) => {
      const name = COUNTRIES.find((c) => c.code === code)?.name;
      return !known.includes(code) && name !== undefined && hasTerm(text, name);
    });
  return [...new Set([...known, ...named])];
}

/** Any country named in a location value ("Mombasa, Kenya" → KE), default-market aliases first. */
export function detectCountry(text: string): string | null {
  return detectMarkets(text)[0] ?? COUNTRIES.find((c) => hasTerm(text, c.name))?.code ?? null;
}

/** Split a free-text query into scope terms ("line pipe, valves" → ["line pipe","valves"]; long phrases also word-split). */
export function queryTerms(query: string): string[] {
  const parts = query
    .toLowerCase()
    .split(/[,;/|]+|\bor\b|\band\b/)
    // Drop generic words ("pipeline EPC contract" → "pipeline"; "EPC contract" → nothing).
    .map((p) => p.replace(/["']/g, " ").split(/\s+/).filter((w) => w && !GENERIC_QUERY_TERMS.has(w)).join(" "))
    .filter((p) => p.length >= 3);
  const words = parts.flatMap((p) => (p.split(/\s+/).length > 2 ? p.split(/\s+/).filter((w) => w.length >= 4) : []));
  return [...new Set([...parts, ...words])];
}

/** Any future date ("closing 15 October 2026", "by 2027") mentioned? */
function mentionsFutureDate(text: string, now: Date): boolean {
  const year = now.getUTCFullYear();
  const years = [...text.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1]));
  return years.some((y) => y > year);
}

export function filterDocument(input: FilterInput): FilterResult {
  const now = input.now ?? new Date();
  const text = `${input.title ?? ""}\n${input.text}`;

  for (const noise of NOISE_PATTERNS) {
    if (noise.re.test(text)) return { verdict: "drop", reason: noise.reason, markets: [] };
  }

  const action = firstTerm(text, [...ACTION_TERMS.en, ...ACTION_TERMS.ar, ...ACTION_TERMS.ms]);
  if (!action) return { verdict: "drop", reason: "no buying action term", markets: [] };

  const scope = findScope(text, scopeTermsFor(input.profile, input.queryTerms));
  if (!scope) return { verdict: "drop", reason: `no scope term (action: ${action})`, markets: [] };

  const watched = input.markets.map((m) => m.toUpperCase());
  const mentioned = detectMarkets(text, watched);
  let markets = mentioned.filter((m) => watched.includes(m));
  if (!markets.length && input.sourceMarket && watched.includes(input.sourceMarket.toUpperCase())) {
    markets = [input.sourceMarket.toUpperCase()];
  }

  let fresh: boolean | null = null;
  if (input.publishedAt) {
    const ageDays = (now.getTime() - new Date(input.publishedAt).getTime()) / 86_400_000;
    fresh = ageDays <= 548 || mentionsFutureDate(text, now);
  } else if (mentionsFutureDate(text, now)) {
    fresh = true;
  }

  if (fresh === false) return { verdict: "drop", reason: "stale: published more than 18 months ago", markets };
  if (!markets.length) {
    if (mentioned.length) return { verdict: "drop", reason: `out of market (mentions ${mentioned.join(", ")})`, markets: [] };
    return { verdict: "uncertain", reason: `market unclear (action: ${action}; scope: ${scope})`, markets: [] };
  }
  if (fresh === null) return { verdict: "uncertain", reason: `date unclear (action: ${action}; scope: ${scope})`, markets };
  return { verdict: "relevant", reason: `action: ${action}; scope: ${scope}; market: ${markets.join(", ")}`, markets };
}
