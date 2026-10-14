/** Paid tender searches per country (portal-restricted + general), on their own allowance (docs/mvp/22 §3.5). */
export const TENDER_SEARCHES_PER_COUNTRY = 2;
/**
 * AI checks of tender pages per country, on top of the search's own AI allowance (live run, 14 Oct: Quick searches
 * spent their 20 AI pages on news before the tender pages were checked, so no tender issuer became a lead).
 */
export const TENDER_AI_PAGES_PER_COUNTRY = 3;
export const TENDER_AI_TOKENS_PER_COUNTRY = 12_000;
/** Read before any other page of the search: a tender naming the item is the strongest demand. */
export const TENDER_READ_PRIORITY = 1340;
/** Pages read from each tender search (its own share, not the discovery share). */
export const TENDER_READS_PER_SEARCH = 6;

/**
 * Where open tenders for an item are published, per country (docs/mvp/21 §A–B). Used by the tender lane of the
 * search plan as Tavily `include_domains`: public, indexed tender pages that show the issuing organisation, the
 * item and the dates without a login. Never a portal that needs a login or captcha to read a notice.
 */
const GLOBAL_TENDER_SITES = ['tendersinfo.com', 'globaltenders.com', 'biddetail.com'];
export const TENDER_DOMAINS: Record<string, string[]> = {
  // India (doc 21 §A1): mirrors that keep the named issuer, item, quantity and dates of CPPP, NIC state and GeM tenders.
  IN: ['tender18.com', 'publicservicesmap.in', 'tenders.infralens.in', 'tender247.com', 'tenderdetail.com', 'bidplus.gem.gov.in', 'tendersinfo.com'],
  // Saudi Arabia: Etimad shows a captcha to readers; bidsfactory mirrors its notices (agency, title, dates).
  SA: ['bidsfactory.com', 'tenders.etimad.sa', 'monafasat.etimad.sa', ...GLOBAL_TENDER_SITES],
  // UAE: Dubai eSupply is closed to readers; DEWA publishes RFQ PDFs; mirrors carry Dubai Municipality and eSupply items.
  AE: ['bidsfactory.com', 'dewa.gov.ae', ...GLOBAL_TENDER_SITES],
  QA: ['monaqasat.mof.gov.qa', 'qafco.qa', ...GLOBAL_TENDER_SITES],
  OM: ['bidsfactory.com', ...GLOBAL_TENDER_SITES],
  // Kuwait: KNPC RFQs reach readers through biddetail's global pages (named buyer, closing date).
  KW: ['biddetail.com', 'tendersinfo.com', 'globaltenders.com'],
  BH: GLOBAL_TENDER_SITES,
};
/** Any other country: the global aggregators' country pages (EU countries also get TED notices). */
export function tenderDomains(country: string): string[] {
  return TENDER_DOMAINS[country.toUpperCase()] ?? GLOBAL_TENDER_SITES;
}

/** Tender wording in a country's own language, added to the item's local name for local-news searches. */
export const LOCAL_TENDER_WORDS: Record<string, string> = {
  ar: 'مناقصة',
  fr: "appel d'offres",
  es: 'licitación',
  pt: 'licitação',
  de: 'Ausschreibung',
  it: 'gara d\'appalto',
  nl: 'aanbesteding',
  tr: 'ihale',
  id: 'tender',
  ms: 'tender',
};

/**
 * Is this page an open tender, RFQ, bid invitation or purchase notice? (English, Arabic and the common tender words
 * of French, Spanish, Portuguese, German, Italian, Dutch, Turkish, Indonesian/Malay, Polish, Russian, Chinese,
 * Korean and Japanese.) A tender is demand only when it also names the item; the caller checks that separately.
 */
export const TENDER_WORDING = /\b(?:tenders?|e-?tender(?:s|ing)?|rfq|rfp|request for (?:quotations?|proposals?)|invitation (?:to|for) (?:bids?|tenders?)|bids? (?:are )?invited|bid (?:no|number|due date|submission|opening)|notice inviting tenders?|nit no|expression of interest|procurement notice|tender notice|tender no|closing date|bid closing|gem bid|reverse auction|appels? d'offres?|avis d'appel|ausschreibung(?:en)?|vergabeverfahren|gara d'appalto|bando di gara|aanbesteding(?:en)?|ihale(?:si)?|pengadaan|lelang|przetarg)\b|\b(?:licitaci[oó]n|licita[cç][aã]o|licita[cç][oõ]es|concurso p[uú]blico|preg[aã]o)|مناقصة|مناقصات|منافسة|İhale|тендер|закупк|招标|采购|입찰|入札/i;
/** The title of a tender listing ("tender for complete pressure vessel tag no: 217-v-001"), else null. */
export function tenderTitle(text: string): string | null {
  const title = text.replace(/\s+/g, ' ').match(/\btender\s+for\s+(.{5,220}?)(?=\s+(?:Agency\b|Due Date\b|Closing Date\b|Tender Value\b|Location\b)|$)/i)?.[1];
  return title ? title.replace(/[\s,.;:–-]+$/, '').slice(0, 160) : null;
}
export function tenderWording(text: string): boolean {
  return TENDER_WORDING.test(text.slice(0, 6000));
}

/**
 * Tender list pages read directly, with no search credit: one page per item that lists current tenders naming it,
 * each with the buying agency and due date. India: tender18 keyword pages (robots.txt allows all crawlers; an
 * unknown keyword shows general tenders, which the listing check ignores). Live probe, 14 Oct: the searches found
 * aggregator pages that hide the buyer, while this page named UCIL, BHEL, NPCIL and the Indian Army.
 */
export function tenderListPages(item: string, country: string): { url: string; name: string }[] {
  if (country !== 'IN') return [];
  const words = item.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length || words.length > 6) return [];
  const last = words[words.length - 1];
  // Singular, as the site names its keyword pages ("centrifugal fans" → centrifugal-fan).
  words[words.length - 1] = /(?:ss|us|is)$/.test(last) ? last : /(?:sh|ch|x)es$/.test(last) ? last.slice(0, -2) : last.replace(/s$/, '');
  return [{ url: `https://tender18.com/all-india-tenders/keyword-tenders/${words.join('-')}-tenders`, name: 'tender18 (open tenders, India)' }];
}
