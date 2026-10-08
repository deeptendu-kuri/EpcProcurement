import { COUNTRIES } from '@/mvp/config/countries';
/** Entity hints are not proof of work, purchase intent or contact validity. */
export function junkCompanyReason(name:string):string|null {
  const n=name.trim();
  if(n.length<3||n.length>180)return 'invalid company name';
  if(COUNTRIES.some(c=>c.name.toLowerCase()===n.toLowerCase())||/^(?:UAE|USA|India|Dubai|Abu Dhabi|Saudi Arabia|Key Players(?: & More)?|Others|Table of Contents|Oil [&and ]+ Gas Pipelines|Contact Us|Our Services|Company Name)$/i.test(n))return 'country or generic heading';
  if(/\b(?:association|council|chamber|institute|market report|market intelligence|insights|consultancy)\b/i.test(n))return 'association, consultant or publisher';
  if(/\b(?:awards?|awarded|wins?|secured|bags|essential services|how to|top \d+|market size|market outlook)\b/i.test(n))return 'article or list title';
  return null;
}
