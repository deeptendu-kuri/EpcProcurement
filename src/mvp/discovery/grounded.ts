import type {RunInput} from '@/mvp/types';
import {buyerEvidence,type DiscoveredBuyer} from '.';
import {materialEvidenceKind} from './plan';
import {originalQuote,namesCompany} from './evidence';
import {bundleScope,type CompanyBundle} from './bundle';
import {countriesInQuote} from './locations';
import {companyIdentityReason} from '@/mvp/sourcing/entities';

/** Literal official-site statements only. No previews, guessed projects or contacts.
 * Deterministic capability extraction is sufficient for a POTENTIAL buyer; AI is
 * still needed for ambiguous sources, qualification, conversations and scheduling.
 */
export function groundedCompanyBuyer(bundle:CompanyBundle,input:RunInput):DiscoveredBuyer|null {
  const name=bundle.candidate.company;
  if(companyIdentityReason(name,{confirmedDomain:bundle.candidate.domain_hint}))return null;
  if(/^(?:cable laying in|electrical installation|pipeline construction|top \d+|best \d+|list of)|\b(?:essential services|reliable power infrastructure)\b/i.test(name))return null;
  const identity=bundle.documents.map(d=>originalQuote(d.text,name)).find(Boolean);
  if(!identity||!input.productId)return null;
  const locationCandidates:{country:string;quote:string}[]=[];
  for(const d of bundle.documents)for(const line of d.text.split('\n')){
    if(line.length>1000||! /\b(?:headquartered|headquarters|based in|registered in)\b/i.test(line)||/\b(?:subsidiar\w*|partner\w*|client\w*|customer\w*)\b/i.test(line))continue;
    if(!bundleScope(bundle,line,[name]))continue;
    const countries=countriesInQuote(line,[name]);
    if(countries.length===1)locationCandidates.push({country:countries[0],quote:line});
  }
  const uniqueCountries=[...new Set(locationCandidates.map(c=>c.country))];
  const location=uniqueCountries.length===1?locationCandidates[0]:locationCandidates.find(c=>input.markets.includes(c.country));
  const spans:{line:string;url:string}[]=[];
  for(const d of bundle.documents)for(const line of d.text.split(/\n+/)){
    // A company's blog/listicle may describe OTHER firms' services. It is not
    // first-party capability evidence simply because the publisher has a brand.
    if(/\/(?:blogs?|news|articles?|category|tags?|jobs?|careers)(?:[/-]|$)|\/20\d{2}\/|companies-in-|industry-reports|directory/i.test(new URL(d.url).pathname))continue;
    // A branded SEO title or generic educational paragraph is not the company's
    // own service claim. Service-list entries are allowed on actual service pages.
    if(line===d.text.split('\n').find(Boolean)&&/\s[-–|]\s/.test(line))continue;
    const selfClaim=/\b(?:we|our)\b/i.test(line)||namesCompany(line,[name]);
    const serviceList=/\/(?:our-)?services(?:\/|$)/i.test(new URL(d.url).pathname)&&/\b(?:services|works|scope|activities)\b/i.test(line);
    if(!selfClaim&&!serviceList)continue;
    if(line.length<25||line.length>1200||! /\b(?:epc|install\w*|construct\w*|laying|erect\w*|maintenan\w*|drill\w*|weld\w*|paint\w*|coat\w*|blast\w*|fabricat\w*)\b/i.test(line))continue;
    // Capability descriptions, not bare product/navigation headings or third-party listings.
    if(! /\b(?:we|our|undertake\w*|provid\w*|speciali[sz]\w*|services|works|scope|activities|projects?|in charge of)\b/i.test(line))continue;
    if(/\b(?:they|their|job|vacancy|recruit\w*|tender|invitation to bid|request for quotation|subsidiar\w*)\b/i.test(line))continue;
    if(/\b(?:our|the)\s+(?:client|customer|partner)\b/i.test(line)&&! /\b(?:we|our team)\s+(?:install|construct|perform|undertake|execute)/i.test(line))continue;
    const kind=materialEvidenceKind(line,input.productId);if(kind==='none')continue;
    // Fabricating the searched material as OUTPUT is not proof of buying it.
    if(kind==='explicit'&&/\bfabricat\w*\b/i.test(line)&&! /\b(?:using|uses?|purchas\w*|procur\w*|raw material|install\w*|construct\w*|erect\w*)\b/i.test(line))continue;
    if(!bundleScope(bundle,line,[name]))continue;
    spans.push({line,url:d.url});
  }
  const operatingCountries=spans.flatMap(({line})=>countriesInQuote(line,[name]).map(country=>({country,quote:line})));
  // Known HQ elsewhere is fine when this company's work proves a selected market.
  if(!operatingCountries.some(c=>input.markets.includes(c.country))&&uniqueCountries.length===1&&!input.markets.includes(uniqueCountries[0]))return null;
  for(const {line} of spans){
    const buyer:DiscoveredBuyer={company:name,companyQuote:identity,country:location?.country??null,countryQuote:location?.quote??null,operatingCountries,
      role:/\bfabricat\w*\b/i.test(line)?'fabricator':/\bepc\b/i.test(line)?'epc_contractor':'subcontractor',
      productQuote:line,confidence:0,project:null,projectQuote:null,activityDate:null,activityQuote:null};
    const checked=buyerEvidence(buyer,bundle.text,input,bundle);
    if(checked.buyer)return checked.buyer;
  }
  return null;
}
