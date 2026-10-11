import { junkReason } from './junk';
import {newsPublisher} from './entities';
export type PageKind='article'|'tender_notice'|'filing'|'company_site'|'directory'|'roundup'|'junk';
export interface ClassifyPage {url:string;title:string|null;text:string;registryId?:string;ogType?:string;tables?:string[][][];markets?:string[]}
// Concrete company checks and contractor lists must not wait behind every news
// article. Structured notices/filings still have the strongest trigger priority.
export const EXTRACTOR_PRIORITY:Record<PageKind,number>={tender_notice:1300,filing:1300,article:900,roundup:1100,company_site:1200,directory:1100,junk:0};
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
  // Investor-release navigation can name dozens of organisations. It is not a
  // roundup merely because the release contains one EPC announcement.
  if(awards&&(names.size>=6&&/\b(?:multiple|several|contractors|awardees|winners|contracts)\b/i.test(title)||/\b(?:awards?\s+\d{1,3}\s+contracts?|\d{1,3}\s+(?:contracts?|awardees))\b/i.test(title)))return 'roundup';
  if(/\b(?:top\s+\d+|list of|leading\s+\d+)\b/i.test(title)||/\/top-\d+-/.test(url.pathname))return 'roundup';
  const lines=page.text.split('\n');
  const rows=lines.filter(l=>l.split('|').length>=3).length;
  // Pipe dimensions, grades and financial statements are tables too, not lists
  // of buyers. Require an actual company-list signal before the fan-out pass.
  const companyTable=page.tables?.some(t=>t.length>=6&&t[0].some(c=>/\b(?:company|contractor|member|business)\s*(?:name|details)?\b/i.test(c)));
  const namedRows=rows>=6&&/\b(?:company name|contractor name|member directory)\b/i.test(page.text);
  if(companyTable||namedRows||/\/(?:directory|impcat|companies|contractors-list)(?:\/|$)/i.test(url.pathname)&&names.size>=6)return 'directory';
  if(newsPublisher(url.hostname)||page.ogType==='article'||/\/(?:news|articles?|press-releases?)\b|\/20\d{2}\//i.test(url.pathname)||awards&&/\/companies\/|\.ece$/.test(url.pathname))return 'article';
  return 'company_site';
}
