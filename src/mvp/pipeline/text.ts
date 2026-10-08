/**
 * Text helpers shared by the pipeline: normalisation (05 §4, 06 §5), hashing, company-name
 * normalisation (04 companies.normalized_name) and a small token-set ratio (RapidFuzz-style, 0–100).
 */
import { createHash } from "node:crypto";

/** NFC + collapse whitespace + trim. Used for stored document text (05 §4 step 3). */
export function cleanText(text: string): string {
  return text.normalize("NFC").replace(/[  -​  　]/g, " ").replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** sha256 hex of a string. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha1 hex of a string. */
export function sha1(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

/**
 * Comparison form for quote checks (06 §5): NFC, unify quotes/dashes, Arabic alef variants,
 * tatweel and diacritics removed, casefold, collapse whitespace.
 */
export function normaliseForMatch(text: string): string {
  return text
    .normalize("NFC")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/ـ/g, "") // tatweel
    .replace(/[آأإٱ]/g, "ا") // alef variants → bare alef
    .replace(/ى/g, "ي") // alef maksura → ya
    .replace(/ة/g, "ه") // ta marbuta → ha
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const LEGAL_SUFFIXES = [
  "ltd", "limited", "llc", "l.l.c", "co", "company", "inc", "incorporated", "corp", "corporation", "pjsc", "psc", "saog", "saoc",
  "bhd", "berhad", "sdn", "asa", "as", "pvt", "private", "plc", "gmbh", "ag", "sa", "spa", "bv", "nv", "wll", "fze", "fzco", "fzc", "jsc",
];
const SUFFIX_SET = new Set(LEGAL_SUFFIXES);

/** companies.normalized_name: lowercase, punctuation removed, trailing/inner legal suffixes stripped. */
export function normalizeCompanyName(name: string): string {
  const tokens = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept = tokens.filter((token) => !SUFFIX_SET.has(token));
  const result = (kept.length ? kept : tokens).join(" ").replace(/^the /, "");
  return result.trim();
}

const PROJECT_STOPWORDS = new Set(["the", "project", "projects", "scheme", "phase", "of", "for", "and", "a", "an"]);

/** projects.normalized_name: lowercase, punctuation/dashes removed, filler words ("the", "project") dropped. */
export function normalizeProjectName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token && !PROJECT_STOPWORDS.has(token))
    .join(" ");
}

/** Normalised person name for people.normalized_name. */
export function normalizePersonName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|eng|engr|sheikh)\.?\s+/g, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein-based similarity ratio 0–100 (like RapidFuzz `ratio`). */
export function ratio(a: string, b: string): number {
  if (a === b) return 100;
  if (!a.length || !b.length) return 0;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  const distance = prev[b.length];
  return Math.round((1 - distance / Math.max(a.length, b.length)) * 100);
}

/**
 * Token-set ratio (RapidFuzz `token_set_ratio`): compares the sorted intersection of tokens with each
 * side's remainder, so "example pipelines" vs "example pipelines india" scores high.
 */
export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter(Boolean));
  const tb = new Set(b.split(/\s+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).sort();
  const diffA = [...ta].filter((t) => !tb.has(t)).sort();
  const diffB = [...tb].filter((t) => !ta.has(t)).sort();
  const base = inter.join(" ");
  const combA = [base, ...diffA].filter(Boolean).join(" ");
  const combB = [base, ...diffB].filter(Boolean).join(" ");
  if (!base) return ratio(combA, combB);
  return Math.max(ratio(base, combA), ratio(base, combB), ratio(combA, combB));
}

/** Parse "12 August 2026", "August 12, 2026", "2026-08-12", "12/08/2026" (day first) → "YYYY-MM-DD". */
export function parseDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (y: number, m: number, d: number) =>
    y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;
  let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})/i);
  if (m) return valid(+m[3], months.indexOf(m[2].toLowerCase().slice(0, 3)) + 1, +m[1]);
  m = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (m) return valid(+m[3], months.indexOf(m[1].toLowerCase().slice(0, 3)) + 1, +m[2]);
  m = text.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i);
  if (m) return valid(+m[2], months.indexOf(m[1].toLowerCase().slice(0, 3)) + 1, 1);
  return null;
}

const MULTIPLIERS: Record<string, number> = {
  thousand: 1e3, k: 1e3, lakh: 1e5, lakhs: 1e5, million: 1e6, mn: 1e6, m: 1e6, mln: 1e6, crore: 1e7, crores: 1e7, cr: 1e7,
  billion: 1e9, bn: 1e9, b: 1e9,
};

/** Rough USD rates per 1 unit of currency (slice only; replace with a rates feed later). */
export const USD_PER_UNIT: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, INR: 1 / 83, SAR: 1 / 3.75, AED: 1 / 3.6725, QAR: 1 / 3.64, OMR: 2.6, KWD: 3.25, BHD: 2.65,
  NOK: 1 / 10.5, MYR: 1 / 4.7, SEK: 1 / 10.6, DKK: 1 / 6.9,
};

const CURRENCY_ALIASES: Record<string, string> = {
  "$": "USD", "US$": "USD", USD: "USD", "€": "EUR", EUR: "EUR", "£": "GBP", GBP: "GBP", INR: "INR", RS: "INR", "RS.": "INR", "₹": "INR",
  SAR: "SAR", SR: "SAR", AED: "AED", DH: "AED", QAR: "QAR", OMR: "OMR", KWD: "KWD", BHD: "BHD", NOK: "NOK", KR: "NOK", MYR: "MYR",
  RM: "MYR", SEK: "SEK", DKK: "DKK",
};

/** Money pattern used by the rules extractor and by `parseMoney`. */
export const MONEY_RE =
  /(?:(US\$|USD|\$|€|EUR|£|GBP|INR|Rs\.?|₹|SAR|SR|AED|QAR|OMR|KWD|BHD|NOK|MYR|RM|SEK|DKK)\s?(\d[\d,]*(?:\.\d+)?)\+?(?:\s?(billion|million|crores?|lakhs?|thousand|bn|mn|mln|cr)\b)?|(\d[\d,]*(?:\.\d+)?)\+?\s?(billion|million|crores?|lakhs?|bn|mn)?\s?(USD|EUR|INR|SAR|AED|QAR|OMR|KWD|BHD|NOK|MYR|SEK|DKK)\b)/i;

/** Parse "USD 450 million", "Rs 1,250 crore", "35000000 NOK" → amount, currency and USD value. */
export function parseMoney(text: string | null | undefined): { amount: number; currency: string; usd: number | null } | null {
  if (!text) return null;
  const m = text.match(MONEY_RE);
  if (!m) return null;
  const cur = (m[1] ?? m[6] ?? "").toUpperCase();
  const num = Number((m[2] ?? m[4] ?? "").replace(/,/g, ""));
  const mult = MULTIPLIERS[(m[3] ?? m[5] ?? "").toLowerCase()] ?? 1;
  const currency = CURRENCY_ALIASES[cur] ?? cur;
  if (!Number.isFinite(num) || !currency) return null;
  const amount = num * mult;
  const rate = USD_PER_UNIT[currency];
  return { amount, currency, usd: rate ? Math.round(amount * rate) : null };
}

/** Parse a number with optional thousands separators. */
export function parseNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Host without "www." for a URL, or null. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** publisher_key: registrable-ish domain group ("energy.economictimes.indiatimes.com" → "indiatimes.com"). */
export function publisherKeyFor(url: string): string {
  const host = hostOf(url);
  if (!host) return "unknown";
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const secondLevel = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
  const tail = parts.slice(-2);
  if (secondLevel.has(tail[0]) && parts.length >= 3) return parts.slice(-3).join(".");
  return tail.join(".");
}

/** Canonical URL for dedupe: lowercase host, no fragment, no tracking params, no trailing slash. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|from$)/i.test(key)) u.searchParams.delete(key);
    }
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim();
  }
}

// ───────────────────────── company names: hygiene and aliases ─────────────────────────

/** Places that extractors sometimes return as a company ("UAE awards contract …"): not a buyer. */
const PLACE_NAMES = new Set([
  "uae", "u.a.e", "united arab emirates", "india", "saudi arabia", "saudi", "ksa", "kingdom of saudi arabia", "malaysia",
  "qatar", "oman", "kuwait", "bahrain", "norway", "dubai", "abu dhabi", "sharjah", "riyadh", "jeddah", "dammam", "gujarat",
  "maharashtra", "rajasthan", "mumbai", "delhi", "new delhi", "gurugram", "gurgaon", "kuala lumpur", "sabah", "sarawak", "johor",
  "oslo", "us", "usa", "u.s", "united states", "uk", "china", "egypt", "iraq",
]);
const PLACE_ALT = [...PLACE_NAMES].map((p) => p.replace(/[.]/g, "\\.")).sort((a, b) => b.length - a.length).join("|");
/** "UAE's Emarat", "Dubai-based X", "Saudi Arabia’s Y": the place prefix is not part of the company name. */
const PLACE_PREFIX = new RegExp(String.raw`^(?:the\s+)?(?:${PLACE_ALT})(?:['’]s\s+|\s*-\s*based\s+)`, "i");
const WEEKDAY_DATELINE = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*[.:,–-]\s*/i;

/**
 * Company-name hygiene for any extracted buyer / awardee / owner name: strips a run-together dateline
 * ("Wednesday.GMDA" → "GMDA") and a place prefix ("UAE's Emarat" → "Emarat"), and returns null for a
 * bare place name ("UAE", "Saudi Arabia"). The result is always a substring of the input, so a
 * verified quote still contains it.
 */
export function tidyCompanyName(value: string): string | null {
  let name = value.trim();
  for (let i = 0; i < 2; i++) name = name.replace(WEEKDAY_DATELINE, "").replace(PLACE_PREFIX, "").trim();
  name = name.replace(/[,;:]+$/, "").trim();
  if (name.length < 2 || PLACE_NAMES.has(name.toLowerCase().replace(/^the\s+/, "").replace(/\.$/, ""))) return null;
  return name;
}

/**
 * The main name and the aliases written into one company name:
 * "Saudi Arabian Oil Co. (Saudi Aramco)" → main "Saudi Arabian Oil Co.", aliases ["Saudi Aramco"];
 * "East Pipes Integrated Company for Industry, or EPIC" → main "East Pipes …", aliases ["EPIC"].
 */
export function companyNameParts(name: string): { main: string; aliases: string[] } {
  let main = name.replace(/\s+/g, " ").trim();
  const aliases: string[] = [];
  const paren = main.match(/^(.+?)\s*\(\s*["“']?([^()"”']{2,60})["”']?\s*\)\s*$/);
  if (paren) {
    main = paren[1].trim();
    aliases.push(paren[2].trim());
  }
  const or = main.match(/^(.+?),\s*(?:or|also known as|aka)\s+["“']?([^,"”']{2,60})["”']?$/i);
  if (or) {
    main = or[1].trim();
    aliases.push(or[2].trim());
  }
  return { main: main.replace(/[,;]+$/, "").trim(), aliases };
}

/** Display form: "Main (Alias)" (", or EPIC" becomes "(EPIC)"). */
export function displayCompanyName(name: string): string {
  const { main, aliases } = companyNameParts(name);
  return aliases.length ? `${main} (${aliases.join(", ")})` : main;
}

/** Well-known companies written several ways in the press; each group counts as one company. */
const KNOWN_ALIAS_GROUPS: { key: string; short: string; country: string | null; names: string[] }[] = [
  // Full name and acronym are explicitly paired in the stored September 2026 filing reports.
  { key:'kpil',short:'KPIL',country:'IN',names:['KPIL','Kalpataru Projects International','Kalpataru Projects International Limited'] },
  { key: "aramco", short: "Aramco", country: "SA", names: ["saudi aramco", "aramco", "saudi arabian oil", "saudi arabian oil company"] },
  { key: "adnoc", short: "ADNOC", country: "AE", names: ["adnoc", "abu dhabi national oil", "abu dhabi national oil company"] },
  { key: "petronas", short: "PETRONAS", country: "MY", names: ["petronas", "petroliam nasional", "petroliam nasional berhad"] },
  { key: "qatarenergy", short: "QatarEnergy", country: null, names: ["qatarenergy", "qatar energy", "qatar petroleum"] },
  { key: "ongc", short: "ONGC", country: "IN", names: ["ongc", "oil and natural gas corporation", "oil and natural gas"] },
  { key: "iocl", short: "IndianOil", country: "IN", names: ["iocl", "indian oil", "indian oil corporation"] },
  { key: "equinor", short: "Equinor", country: "NO", names: ["equinor", "statoil"] },
];
const KNOWN_BY_NAME = new Map(KNOWN_ALIAS_GROUPS.flatMap((g) => g.names.map((n) => [normalizeCompanyName(n), g] as const)));

/** The well-known company group for a name (any of its parts), or null. */
export function knownCompany(name: string): { key: string; country: string | null } | null {
  const { main, aliases } = companyNameParts(name);
  for (const part of [main, ...aliases]) {
    const group = KNOWN_BY_NAME.get(normalizeCompanyName(part));
    if (group) return { key: group.key, country: group.country };
  }
  return null;
}

/** Words that mark a part of a company rather than another company ("Welspun Corp Associate"). */
const VARIANT_WORDS = new Set(["associate", "associates", "unit", "units", "division", "subsidiary", "arm"]);

/**
 * Variant key of a company name (14 §11): the normalised name without trailing "associate / unit /
 * division / subsidiary" words — "Welspun Corp Associate" and "Welspun Corp Unit" → "welspun".
 * null when nothing was stripped (the normalised name is already the key).
 */
export function companyVariantKey(name: string): string | null {
  const tokens = normalizeCompanyName(name).split(" ").filter(Boolean);
  let end = tokens.length;
  while (end > 1 && VARIANT_WORDS.has(tokens[end - 1])) end--;
  if (end === tokens.length) return null;
  const key = tokens.slice(0, end).join(" ");
  return key.length >= 2 ? key : null;
}

/**
 * Matching keys of a company name: the normalised main name, each normalised alias, and the
 * well-known group ("known:aramco"). Two names that share a key are the same company.
 */
export function companyKeys(name: string): { keys: string[]; hasAlias: boolean } {
  const { main, aliases } = companyNameParts(name);
  const keys = new Set<string>();
  for (const part of [main, ...aliases]) {
    const key = normalizeCompanyName(part);
    if (key.length >= 2) keys.add(key);
    // Name variants (14 §11): "Welspun Corp Associate" / "Welspun Corp Unit" share the key "welspun".
    const variant = companyVariantKey(part);
    if (variant) keys.add(variant);
  }
  const known = knownCompany(name);
  if (known) keys.add(`known:${known.key}`);
  return { keys: [...keys], hasAlias: aliases.length > 0 || known !== null };
}

/**
 * Short name for labels ("Saudi Arabian Oil Co. (Saudi Aramco)" → "Aramco", "East Pipes Integrated
 * Company for Industry (EPIC)" → "EPIC"): a well-known group's short name, else a short alias, else the
 * main name without a trailing legal suffix.
 */
export function shortCompanyName(name: string): string {
  const { main, aliases } = companyNameParts(name);
  for (const part of [main, ...aliases]) {
    const group = KNOWN_BY_NAME.get(normalizeCompanyName(part));
    if (group) return group.short;
  }
  const alias = aliases.find((a) => a.length <= 16);
  if (alias) return alias;
  return main.replace(/,?\s+(?:Co\.?|Company|Ltd\.?|Limited|LLC|Inc\.?|Corp\.?|Corporation|PJSC|Pvt\.? Ltd\.?|Bhd\.?|ASA|Sdn\.? Bhd\.?)$/i, "").trim() || main;
}

/** "Sep 2026" for an ISO date (or null). */
export function monthYear(iso: string | null | undefined): string | null {
  const m = iso?.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : null;
}

/** Words that end with a dot but do not end a sentence ("Co.", "Ltd.", "Rs."). */
const NON_TERMINAL = new Set([
  "co", "ltd", "inc", "corp", "rs", "no", "mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "approx", "dept", "govt", "pvt", "bhd", "plc",
  "sdn", "u.s", "u.k", "e.g", "i.e", "etc", "mn", "bn", "cr", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

function isSentenceEnd(text: string, dotIndex: number): boolean {
  const ch = text[dotIndex];
  if (ch === "!" || ch === "?") return true;
  if (ch !== ".") return false;
  const next = text[dotIndex + 1];
  if (next !== undefined && !/\s/.test(next)) return false; // "5.5", "a.m."
  const word = text.slice(Math.max(0, dotIndex - 8), dotIndex).match(/([\p{L}.]+)$/u)?.[1]?.toLowerCase().replace(/^\./, "");
  if (word && NON_TERMINAL.has(word)) return false;
  if (word && word.length === 1) return false; // initials ("A. Khan")
  return true;
}

/**
 * The full sentence of `text` around [start, end) (a verified quote), trimmed; at most `max` chars
 * (longer sentences are cut at word boundaries around the quote). Never shorter than the quote.
 */
export function sentenceAround(text: string, start: number, end: number, max = 420): { sentence: string; start: number; end: number } {
  let from = start;
  while (from > 0) {
    const ch = text[from - 1];
    if (ch === "\n") break;
    if (from >= 2 && /\s/.test(ch) && isSentenceEnd(text, from - 2)) break;
    from--;
  }
  let to = end;
  while (to < text.length) {
    const ch = text[to];
    if (ch === "\n") break;
    if (isSentenceEnd(text, to)) {
      to++;
      break;
    }
    to++;
  }
  // Skip leading spaces, closing quotes of the previous sentence.
  while (from < start && /[\s"'”’)]/.test(text[from])) from++;
  while (to > end && /\s/.test(text[to - 1])) to--;
  if (to - from > max) {
    const room = Math.max(0, max - (end - start));
    let a = Math.max(from, start - Math.floor(room / 2));
    let b = Math.min(to, end + Math.ceil(room / 2));
    if (a > from) a = Math.min(start, text.indexOf(" ", a) + 1 || a);
    if (b < to) b = Math.max(end, text.lastIndexOf(" ", b) > end ? text.lastIndexOf(" ", b) : b);
    from = a;
    to = b;
  }
  return { sentence: text.slice(from, to).trim(), start: from, end: to };
}

/** Word count of a quote. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** True when `sentence` names the company (its main name, an alias or its first distinctive words). */
export function mentionsCompany(sentence: string, name: string): boolean {
  const hay = normaliseForMatch(sentence);
  const { main, aliases } = companyNameParts(name);
  const parts = [main, ...aliases].map((p) => normaliseForMatch(p)).filter((p) => p.length >= 2);
  if (parts.some((p) => hay.includes(p))) return true;
  const firstWords = normaliseForMatch(main).split(" ").filter((w) => w.length >= 3 && !SUFFIX_SET.has(w)).slice(0, 2).join(" ");
  if (firstWords.length >= 4 && hay.includes(firstWords)) return true;
  const known = knownCompany(name);
  if (known) {
    const group = KNOWN_ALIAS_GROUPS.find((g) => g.key === known.key);
    if (group?.names.some((n) => hay.includes(n))) return true;
  }
  return false;
}
