/** Public-source registry. Endpoint reachability is measured, never inferred from this catalogue. */
import type {RunInput} from '@/mvp/types';
import type {RawDoc} from '@/mvp/pipeline/contracts';
import {getText,robotsAllowed,politeWait} from '@/mvp/pipeline/read';
import {parseFeed} from '@/mvp/pipeline/sources/rss';
import {buyerPageCandidate} from '@/mvp/discovery/plan';
import {junkReason} from './junk';
import {getCatalogueItem} from '@/mvp/config/buyers-config';
import {hasTerm} from '@/mvp/pipeline/filter';

export interface RegistrySource {
  id:string;market:string;kind:'award_list'|'contractor_list'|'filings';url:string;
  reader:'html_table'|'html_list'|'rss';cadenceDays:number;note:string;
  maxPages:number;tier:'A'|'B';adapter?:'ted';reviewRequired?:boolean;
}
export const SOURCING_REGISTRY:readonly RegistrySource[]=[
  {id:'saudigulf-awards',market:'AE',kind:'award_list',url:'https://www.saudigulfprojects.com/',reader:'html_list',cadenceDays:1,maxPages:4,tier:'B',note:'Public award posts. Follow relevant dated articles; aggregate totals do not identify unnamed winners.'},
  {id:'dewa-contractor-list',market:'AE',kind:'contractor_list',url:'https://www.dewa.gov.ae/en/builder/useful-tools/consultant-and-contractor-listing',reader:'html_table',cadenceDays:30,maxPages:3,tier:'A',note:'Public contractor listing; HTTP 403 requires manual fetch, never bypass access controls.'},
  {id:'bse-orders',market:'IN',kind:'filings',url:'https://www.bseindia.com/data/xml/announcements.xml',reader:'rss',cadenceDays:1,maxPages:4,tier:'A',note:'Corporate order/contract/LoA announcements. RSS is discovery only; read original attachments.'},
  {id:'nse-orders',market:'IN',kind:'filings',url:'https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml',reader:'rss',cadenceDays:1,maxPages:4,tier:'A',note:'Corporate announcements; endpoint availability must be measured. No feed description as evidence.'},
  {id:'cppp-awards',market:'IN',kind:'award_list',url:'https://eprocure.gov.in/eprocure/app?page=FrontEndAOC&service=page',reader:'html_table',cadenceDays:1,maxPages:3,tier:'A',note:'Award-of-contract listings only. Do not solve captchas or turn an open invitation into a winning contractor.'},
  {id:'tadawul-announcements',market:'SA',kind:'filings',url:'https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/issuer-news/issuer-announcements',reader:'html_list',cadenceDays:1,maxPages:4,tier:'A',note:'Public issuer disclosures; JS/login-only content remains an explicit coverage gap.'},
  {id:'ted-awards',market:'EU',kind:'award_list',url:'https://api.ted.europa.eu/v3/notices/search',reader:'html_list',cadenceDays:1,maxPages:4,tier:'A',adapter:'ted',note:'EU/EEA, including Norway: use the existing structured TED adapter, not HTML scraping of this API.'},
  {id:'bursa-announcements',market:'MY',kind:'filings',url:'https://www.bursamalaysia.com/market_information/announcements/company_announcement',reader:'html_list',cadenceDays:1,maxPages:4,tier:'A',note:'Public issuer announcements. Dynamic pages or blocked attachments are coverage warnings.'},
  {id:'petronas-licensing',market:'MY',kind:'contractor_list',url:'https://www.petronas.com/partner-us/licensing-procurement-malaysia',reader:'html_list',cadenceDays:30,maxPages:1,tier:'A',reviewRequired:true,note:'Licensing information is not a verified public contractor directory. Disabled pending a lawful public listing; never automate a vendor login.'},
];
export function registryRaw(source:RegistrySource,url=source.url,title:string|null=null,publishedAt:string|null=null):RawDoc {
  return {sourceKey:`registry:${source.id}`,sourceName:`Public ${source.kind.replaceAll('_',' ')} · ${new URL(source.url).hostname}`,tier:source.tier,url,title,publishedAt,text:null,isSample:false,kind:'roundup',research:{lane:'directory',sourcingLane:'roundup',registryId:source.id}};
}
const action=/\b(?:awards?|awarded|orders?|contracts?|LoA|LoI|letter of (?:award|acceptance))\b|ترسية|عقد/i;
const relevant=(text:string,product:string)=>buyerPageCandidate(text,product)||(getCatalogueItem(product)?.keywords??[]).some(term=>hasTerm(text,term));
/** Feed titles/descriptions select URLs only. Original pages, not the feed, must prove every fact. */
export function registryFeedDocs(source:RegistrySource,xml:string,input:RunInput):RawDoc[]{
  return parseFeed(xml).filter(item=>action.test(item.title+'\n'+item.description)&&relevant(item.title+'\n'+item.description,input.productId??'')&&!junkReason(item.link,item.title,input.markets)).slice(0,source.maxPages)
    .map(item=>registryRaw(source,item.link,item.title,item.published));
}
export async function collectRegistry(source:RegistrySource,input:RunInput):Promise<RawDoc[]>{
  if(source.reviewRequired||source.adapter)throw new Error('Registry requires its approved adapter or permission review.');
  if(source.reader!=='rss')return [registryRaw(source)];
  const beforeHop=async(url:string)=>{if(!await robotsAllowed(url))throw new Error('Registry robots restriction.');await politeWait(new URL(url).hostname);};
  await beforeHop(source.url);
  const response=await getText(source.url,'application/rss+xml, application/xml, text/xml',15000,{beforeHop});
  if(!response.ok)throw new Error(`Registry HTTP ${response.status}`);
  if(!/<(?:rss|feed)\b/i.test(response.text))throw new Error('Registry returned no readable feed.');
  return registryFeedDocs(source,response.text,input);
}
/** Bounded HTML-list/table links. Never follow social, search, login/captcha or generic navigation. */
export function registryPageTargets(source:RegistrySource,links:{url:string;text:string}[],input:RunInput){
  const host=new URL(source.url).hostname.replace(/^www\./,'');
  return [...new Map(links.filter(link=>{
    try{const url=new URL(link.url);return /^https?:$/.test(url.protocol)&&(url.hostname===host||url.hostname.endsWith('.'+host))
      &&!junkReason(url.href,link.text,input.markets)&&!/(?:login|captcha|register|signup)/i.test(url.pathname)
      &&action.test(link.text)&&relevant(link.text,input.productId??'');}catch{return false;}
  }).map(link=>[link.url,link])).values()].slice(0,Math.max(0,source.maxPages-1));
}
export function registryReadWarning(id:string,reason:string,detail?:string){
  const status=detail?.match(/^HTTP (\d{3})$/)?.[1];
  return {coverageWarning:true,registryId:id,failureReason:reason,...(status?{httpStatus:Number(status)}:{}),requiresManualFetch:status==='403'};
}
