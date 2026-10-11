import {companyKey,sameCompanyName} from './company-names';
import {originalQuote} from '@/mvp/discovery/evidence';
/** Corporate reports often put the company name in a header and its work in
 * bullets. Two literal spans are allowed only on that company's own domain;
 * an unrelated publisher/header may not donate its name to another's work. */
export function ownDocumentIdentity(text:string,name:string,url:string|undefined,identityQuote:string|undefined):boolean {
  if(!url||!identityQuote||!originalQuote(text,identityQuote))return false;
  let host:string;try{host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return false;}
  const brand=host.split('.')[0],key=companyKey(name);
  if(!brand||key.length<3||!sameCompanyName(brand,name))return false;
  return identityQuote.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'').includes(key);
}
