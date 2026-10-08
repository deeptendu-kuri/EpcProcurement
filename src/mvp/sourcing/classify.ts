import { junkReason } from './junk';
import {newsPublisher} from './entities';
export type PageKind='article'|'tender_notice'|'filing'|'company_site'|'directory'|'roundup'|'junk';
export interface ClassifyPage {url:string;title:string|null;text:string;registryId?:string;ogType?:string;tables?:string[][][];markets?:string[]}
export const EXTRACTOR_PRIORITY:Record<PageKind,number>={tender_notice:1900,filing:1900,article:1800,roundup:950,company_site:600,directory:500,junk:0};
/** Routing only. Names and numbers here are hints, never evidence or saved entities. */
export function classifyPage(page:ClassifyPage):PageKind {
  if(junkReason(page.url,page.title,page.markets))return 'junk';
  const url=new URL(page.url),title=page.title??'';
  // A news archive is neither a company capability page nor original award proof.
  if(newsPublisher(url.hostname)&&/^\/(?:topic|tags?|category|archive)(?:\/|$)/i.test(url.pathname))return 'junk';
  if(page.registryId)return 'roundup';
  if(/ted\.europa\.eu$/.test(url.hostname)||/\b(?:contract award notice|contract notice|tender notice)\b/i.test(title)||/\/notice\/-\/detail\//.test(url.pathname))return 'tender_notice';
  if(/(?:bseindia|nseindia|tadawul|bursamalaysia)\./i.test(url.hostname)||/\/(?:filings|disclosures|announcements)(?:\/|$)/i.test(url.pathname))return 'filing';
  const names=new Set((page.text.match(/\b[A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){1,6}\b/g)??[])
    .filter(name=>/\b(?:Limited|Ltd|LLC|Corp|Company|Contracting|Engineering|International|AS)\b/.test(name)));
  const awards=/\b(?:awards?|awarded|wins?|won|secured|orders?)\b/i.test(title+'\n'+page.text);
  if(awards&&(names.size>=6||/\b(?:awards?\s+\d{1,3}\s+contracts?|\d{1,3}\s+(?:contracts?|awardees))\b/i.test(title)))return 'roundup';
  if(/\b(?:top\s+\d+|list of|leading\s+\d+)\b/i.test(title)||/\/top-\d+-/.test(url.pathname))return 'roundup';
  const lines=page.text.split('\n');
  const rows=lines.filter(l=>l.split('|').length>=3).length;
  if((page.tables?.reduce((n,t)=>n+t.length,0)??0)>=6||rows>=6||/\/(?:directory|impcat|companies|contractors-list)(?:\/|$)/i.test(url.pathname)&&names.size>=6)return 'directory';
  if(newsPublisher(url.hostname)||page.ogType==='article'||/\/(?:news|articles?|press-releases?)\b|\/20\d{2}\//i.test(url.pathname)||awards&&/\/companies\/|\.ece$/.test(url.pathname))return 'article';
  return 'company_site';
}
