import {COUNTRIES} from '@/mvp/config/countries';
import {hasTerm,MARKET_TERMS} from '@/mvp/pipeline/filter';
/** Real place words only. Client brands and the country in a company name are not location proof. */
export function countriesInQuote(quote:string,names:readonly string[]=[]):string[] {
  let text=quote.toLowerCase();for(const name of names)text=text.replaceAll(name.toLowerCase(),' ');
  return COUNTRIES.filter(country=>[country.name,...(MARKET_TERMS[country.code as keyof typeof MARKET_TERMS]??[])]
    .filter(alias=>alias&&!/^(?:ongc|gail|aramco|adnoc|petronas|equinor|kongsberg)$/i.test(alias))
    .some(alias=>hasTerm(text,alias))).map(c=>c.code);
}
/** A sourced activity label, never a default inferred from unrelated menus. */
export function capabilityLabel(productId:string,quote:string):string|null {
  if(productId==='line-pipe'&&/\b(?:pipelines?|CGD)\b/i.test(quote)&&/\b(?:oil|gas|cross.country|transmission|EPC|CGD)\b/i.test(quote))return 'Pipeline contractor';
  if(productId==='cables'&&/\b(?:HV|EHV|HVDC|(?:11|33|132|220|400)\s*kV)\b/i.test(quote)&&/\b(?:install\w*|laying|cabl\w*)\b/i.test(quote))return 'HV cable installer';
  if(productId==='cables'&&/\b(?:electrical|power|cable)\b/i.test(quote))return 'Electrical contractor';
  return null;
}
