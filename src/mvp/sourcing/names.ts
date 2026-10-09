/**
 * Is a listed name a company that could buy, or page furniture? Shared by list seeding (so junk never
 * costs a website lookup) and the found-companies view (so junk is folded away).
 */
import { junkCompanyReason, nonCompanyDomain } from './entities';

// Headline wording inside a "name": verbs, amounts and list words ("… Secures A $300M Vessel Contract").
const HEADLINE = /(?:\$|€|₹)\s?\d|\b\d+(?:\.\d+)?\s?(?:m|bn|mn|million|billion|crore)\b|\b(?:secures?|signs?|drives?|wins?|bags|awards?|launch\w*|announces?|overview|activity|record|list|top|best|guide|how|why|what|across|amid)\b/i;
// Publishers, trackers and industry bodies.
const MEDIA_OR_BODY = /\b(?:monitor|tracker|observatory|excellence|magazine|journal|digest|times|herald|guardian|gazette|weekly|daily|news|media|wiki\w*|blog)\b/i;
// Platforms named in marketing or footer text ("Google Ads", "ChatGPT").
const PLATFORMS = /^(?:google|meta|facebook|instagram|tiktok|linkedin|youtube|whatsapp|twitter|x|chatgpt|openai|gemini|perplexity|bing|microsoft|apple|amazon|wordpress|shopify|wix)(?:\s+(?:ads|business|maps|search))?$/i;
// Inspection, certification and standards bodies named on product pages.
const BODIES = /^(?:dnv(?:\s?gl)?|lloyd'?s(?:\s+register)?|t[üu]v(?:\s+\w+)?|sgs|abs|bv|bureau veritas|intertek|iso|asme|api|astm|cen|ukas(?:\s+\w+)*|bsi|ibr|cidb|dosh|mykkp|osha|iec|european committee for standardization)$/i;
// Site credits and footers: "Website designed by …", "Copyrights © 2026 …".
const CREDIT = /\b(?:designed by|developed by|managed by|powered by|copyrights?|all rights reserved|log ?in|sign in)\b|©/i;
// Slogans used as page titles: "We give you a clear solution".
const SLOGAN = /^(?:we|our|your|you|i|the)\b/i;
// Words showing the company is named for project, construction or material work.
const WORK = /\b(?:pipes?|pipelines?|tub(?:e|ular)s?|construct\w*|contract\w*|EPC|engineer\w*|infrastructure|projects?|refin\w*|petroleum|oil|gas|steel|fabricat\w*|mechanical|civil|build\w*|develop\w*|energy|power|water|utilit\w*|plants?|terminal|onshore|offshore|cables?|vessels?|tanks?|boilers?|ship\w*|dock\w*|marine|manufactur\w*|industr\w*)\b/i;
// Market-news furniture: share prices, results and advice boxes beside an article.
const NOT_WORK = /\b(?:share price|stock price|investment advice|dividend|earnings|results? today|q[1-4] results?|according to [A-Z][a-z]+ data|subscribe|newsletter|insurance|marketing agency|digital marketing|web design|seo|software|standardi[sz]ation|accreditation body|certification body)\b/i;
// Institutions rather than companies that buy material.
const INSTITUTION = /\b(?:institut\w*|university|college|committee|accreditation)\b/i;
// Words that describe a service or product line, never a company's own name on their own.
const SERVICE_WORDS = new Set(['pressure', 'vessel', 'vessels', 'fabrication', 'fabricator', 'fabricators', 'manufacturing', 'manufacturer', 'manufacturers', 'services', 'service',
  'solutions', 'engineering', 'construction', 'steel', 'plate', 'plates', 'tank', 'tanks', 'storage', 'industrial', 'products', 'product', 'equipment', 'pipe', 'pipes', 'pipeline',
  'pipelines', 'process', 'heavy', 'oil', 'gas', 'marine', 'offshore', 'onshore', 'mechanical', 'electrical', 'civil', 'installation', 'works', 'contractor', 'contractors',
  'and', 'for', 'of', 'the', 'in', 'with', 'boiler', 'boilers', 'structural', 'metal', 'sheet', 'sheets', 'welding', 'repair', 'maintenance', 'supply', 'suppliers']);
// Places that often end a page title ("Pressure Vessel Manufacturer UAE").
const PLACE_WORDS = new Set(['uae', 'ksa', 'gcc', 'dubai', 'abu', 'dhabi', 'sharjah', 'ajman', 'india', 'indian', 'malaysia', 'saudi', 'arabia', 'qatar', 'oman',
  'kuwait', 'bahrain', 'norway', 'middle', 'east', 'emirates', 'mumbai', 'delhi', 'chennai', 'kuala', 'lumpur', 'riyadh', 'jeddah', 'dammam', 'doha', 'muscat', 'gujarat']);
/** A title made only of service and place words ("Pressure Vessel Manufacturer UAE") is a page topic, not a company. */
export function genericServicePhrase(name: string): boolean {
  const words = name.toLowerCase().replace(/&/g, ' and ').match(/[a-z0-9]+/g) ?? [];
  return words.length > 0 && words.every((w) => SERVICE_WORDS.has(w) || PLACE_WORDS.has(w)) && words.some((w) => SERVICE_WORDS.has(w));
}

/** Why a listed name is not a possible buyer company, or null. */
export function junkFoundName(name: string, quote: string | null): string | null {
  const n = name.trim();
  if (!/[a-z]/i.test(n)) return 'not a name';
  if (PLATFORMS.test(n)) return 'platform';
  if (BODIES.test(n.replace(/\s*\([^)]*\)\s*/g, ' ').trim())) return 'certifier or standards body';
  if (HEADLINE.test(n)) return 'headline';
  if (MEDIA_OR_BODY.test(n)) return 'publisher or tracker';
  if (SLOGAN.test(n)) return 'slogan';
  if (INSTITUTION.test(n)) return 'institution';
  if (genericServicePhrase(n)) return 'service phrase, not a name';
  if (quote && quote.length < 140 && CREDIT.test(quote)) return 'site credit';
  return junkCompanyReason(n);
}

/**
 * A listed name counts as a work-related company when its source line, or the list it appears in
 * ("Top 10 EPC Contractors in UAE" naming just "Petrofac"), is about work and not page furniture.
 */
export function relevantFound(name: string, quote: string | null, website: string | null, saved: boolean, sourceTitle: string | null = null): boolean {
  if (saved) return true;
  if (junkFoundName(name, quote) || (website && nonCompanyDomain(website))) return false;
  return WORK.test(`${name} ${quote ?? ''} ${sourceTitle ?? ''}`) && !NOT_WORK.test(quote ?? '');
}

/** A seller of the searched material, not a buyer: "we supply … steel plates", "stockist of …". */
export function looksLikeSupplier(quote: string | null): boolean {
  return /\b(?:we|they)\s+(?:supply|stock|export|distribute|trade)\b|\b(?:suppliers?|stockists?|exporters?|distributors?|dealers?|traders?)\s+(?:of|for|in)\b/i.test(quote ?? '');
}
