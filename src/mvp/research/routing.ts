import type { RawDoc } from '@/mvp/pipeline/contracts';
import type { RunInput } from '@/mvp/types';
import { buyerResearchPriority, materialEvidenceKind } from '@/mvp/discovery/plan';

const SOCIAL=/(?:^|\.)(?:facebook\.com|instagram\.com|youtube\.com|tiktok\.com|pinterest\.com|linkedin\.com)$/i;
/** Ordering/admission hints only. Never treat search previews as verified facts. */
export function discoveryReadPriority(raw:RawDoc,input:RunInput):number {
  const url=new URL(raw.url),hint=(raw.title??'')+' '+(raw.research?.searchPreview??'');
  let score=buyerResearchPriority(raw,'',input);
  if(SOCIAL.test(url.hostname))score-=80;
  if(/(?:^|\.)(?:jobeka\.com|foundit\.in|indeed\.com|glassdoor\.com|naukri\.com)$/i.test(url.hostname)||/\/(?:jobs?|careers)(?:[/-]|$)/i.test(url.pathname))score-=80;
  if(/\b(?:design consultancy|engineering consultancy|inspection services|testing laboratory|third.party inspection)\b/i.test(hint))score-=30;
  if(/\b(?:invitation to bid|request for quotation|open tender|market report|market size|job vacancy)\b/i.test(hint))score-=60;
  if(/\b(?:epc|contractors?|contracting|installation|construction|fabrication|cable laying)\b/i.test(hint))score+=12;
  if(materialEvidenceKind(hint,input.productId??'')!=='none')score+=15;
  if(/\b(?:current projects|ongoing projects|awarded|secured|wins)\b/i.test(hint))score+=8;
  return score;
}
/** One best URL per domain first. A company's remaining pages are follow-up work. */
export function prioritiseDiscoveryDocs(docs:RawDoc[],input:RunInput):RawDoc[] {
  const ranked=[...new Map(docs.map(d=>[d.url,d])).values()].sort((a,b)=>discoveryReadPriority(b,input)-discoveryReadPriority(a,input));
  const domains=new Set<string>(),first:RawDoc[]=[],rest:RawDoc[]=[];
  for(const d of ranked){const domain=new URL(d.url).hostname.toLowerCase().replace(/^www\./,'');if(domains.has(domain))rest.push(d);else{domains.add(domain);first.push(d);}}
  return [...first,...rest];
}
