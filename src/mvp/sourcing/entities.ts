import { COUNTRIES } from '@/mvp/config/countries';
/** Entity hints are not proof of work, purchase intent or contact validity. */
export function junkCompanyReason(name:string):string|null {
  const n=name.trim();
  if(n.length<3||n.length>180)return 'invalid company name';
  if(COUNTRIES.some(c=>c.name.toLowerCase()===n.toLowerCase())||/^(?:UAE|USA|India|Dubai|Abu Dhabi|Saudi Arabia|Key Players(?: & More)?|Others|Table of Contents|Oil [&and ]+ Gas Pipelines|Contact Us|Our Services|Company Name)$/i.test(n))return 'country or generic heading';
  if(/\b(?:association|council|chamber|institute|market report|market intelligence|insights|consult\w*|Norconsult|VALDEL EC)\b/i.test(n))return 'association, consultant or publisher';
  if(/\b(?:awards?|awarded|wins?|secured|bags|essential services|how to|top \d+|market size|market outlook)\b/i.test(n))return 'article or list title';
  return null;
}
const NEWS_PUBLISHERS=['saudigulfprojects.com','reuters.com','thehindubusinessline.com','business-standard.com','constructionweekonline.com','gulfnews.com','offshore-energy.biz','economictimes.indiatimes.com',
  'hindustantimes.com','livemint.com','indiatimes.com','thenationalnews.com','zawya.com','meed.com','arabnews.com','khaleejtimes.com'];
export function newsPublisher(domain:string):boolean {
  const host=domain.toLowerCase();return NEWS_PUBLISHERS.some(d=>host===d||host.endsWith('.'+d));
}
const PUBLISHERS=[...NEWS_PUBLISHERS,'revenuebase.ai','indiamart.com'];
export function nonCompanyDomain(domain:string):boolean {
  return [...PUBLISHERS,'weebly.com','wordpress.com','blogspot.com','medium.com','github.io','linkedin.com','facebook.com','world-nuclear.org','mordorintelligence.com','sphericalinsights.com','wikipedia.org'].some(d=>domain===d||domain.endsWith('.'+d));
}
/** Identity admission, not a buying/verification label. Domain must already be corroborated. */
export function companyIdentityReason(name:string,basis:{confirmedDomain?:string|null;registryRow?:boolean}={}):string|null {
  const junk=junkCompanyReason(name);if(junk)return junk;
  if(basis.confirmedDomain&&nonCompanyDomain(basis.confirmedDomain))return 'publisher or personal/free-host domain';
  const suffix=/\b(?:llc|l\.?l\.?c\.?|ltd\.?|limited|inc\.?|plc|corp\.?|corporation|company|co\.?|engineering|contracting|construction|infrastructure|international|industries|works|group|llp|gmbh|nv|sa|as|s\.p\.a\.)\s*(?:\([^)]*\))?$/i.test(name);
  return suffix||basis.confirmedDomain||basis.registryRow?null:'No company suffix, corroborated company domain or registry row.';
}
