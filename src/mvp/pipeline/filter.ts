/**
 * Rules filter before any AI (05 §5). A document is:
 * - `relevant`  when it has a buying action, a scope term, a watched market and is fresh;
 * - `uncertain` when it has buying action and scope but the market or freshness is unclear
 *               (these go to P0 triage when a real model is available);
 * - `drop`      otherwise, including noise (market reports, price indices, job ads, court stories).
 * The reason is stored in source_documents.filter_reason for tuning.
 */
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

/** Discipline and product synonyms (scope check). Product keywords from the client profile are added. */
export const SCOPE_TERMS = [
  "pipeline", "pipelines", "piping", "line pipe", "linepipe", "api 5l", "valve", "valves", "static equipment", "epc",
  "mechanical works", "mechanical and piping", "pressure vessel", "storage tank", "tanks", "pipe", "pipes", "gas transmission",
  "water transmission", "خط أنابيب", "أنابيب", "saluran paip", "paip",
];

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

/** Markets whose names appear in the text. */
export function detectMarkets(text: string): MarketCode[] {
  return (Object.keys(MARKET_TERMS) as MarketCode[]).filter((code) => MARKET_TERMS[code].some((term) => hasTerm(text, term)));
}

/** Split a free-text query into scope terms ("line pipe, valves" → ["line pipe","valves"]; long phrases also word-split). */
export function queryTerms(query: string): string[] {
  const parts = query
    .toLowerCase()
    .split(/[,;/|]+|\bor\b|\band\b/)
    .map((p) => p.replace(/["']/g, "").trim())
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

  const productTerms = input.profile.products.filter((p) => p.active).flatMap((p) => p.keywords.map((k) => k.toLowerCase()));
  const disciplineTerms = [...input.profile.disciplines, ...input.profile.adjacent_disciplines].map((d) => d.replace(/_/g, " "));
  const scope = firstTerm(text, [...input.queryTerms, ...productTerms, ...disciplineTerms, ...SCOPE_TERMS]);
  if (!scope) return { verdict: "drop", reason: `no scope term (action: ${action})`, markets: [] };

  const mentioned = detectMarkets(text);
  const watched = input.markets.map((m) => m.toUpperCase());
  let markets = mentioned.filter((m) => watched.includes(m));
  if (!markets.length && input.sourceMarket && watched.includes(input.sourceMarket.toUpperCase())) {
    markets = [input.sourceMarket.toUpperCase() as MarketCode];
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
