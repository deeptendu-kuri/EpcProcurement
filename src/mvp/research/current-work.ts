import {originalQuote} from '@/mvp/discovery/evidence';

export interface CurrentWorkDocument {id:string;url:string;text:string;publishedAt:string|null}
export interface CurrentWorkProof {documentId:string;url:string;quote:string;date:string}
const GENERIC=new Set(['project','plant','train','phase','facility','gas','lng','ngl','pipeline','construction','expansion','the','and']);
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Match a distinctive project, never a shared industry word. This is NOT a
 * fuzzy company/domain join. Same project in separate stored originals only. */
export function namesProject(text:string,project:string):boolean {
  const words=project.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(w=>w.length>=3&&!GENERIC.has(w))??[];
  if(!words.length)return false;
  return words.every(w=>new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(w)}(?:$|[^\\p{L}\\p{N}])`,'iu').test(text));
}
/** A recent original project-progress paragraph can keep an older EPC contract
 * useful. Preserve BOTH documents: never turn the progress date into an award
 * date. A publication timestamp alone, related-story footer, or completed/paused
 * project does not establish current work. No new fetch or AI call here. */
export function currentWorkProof(project:string|null,documents:CurrentWorkDocument[],now=new Date()):CurrentWorkProof|null {
  if(!project)return null;
  const sorted=documents.filter(d=>d.publishedAt&&Number.isFinite(Date.parse(d.publishedAt)))
    .sort((a,b)=>Date.parse(b.publishedAt!)-Date.parse(a.publishedAt!));
  for(const d of sorted){
    const date=d.publishedAt!,age=now.getTime()-Date.parse(date);
    if(age<0||age>30*2.63e9)continue;
    const paragraphs=d.text.split(/\n+/);
    for(let n=0;n<paragraphs.length;n++){
      const line=paragraphs[n];
      if(namesProject(line,project)&&/\b(?:paused|suspended|cancelled|canceled|on hold|100\s*%\s+complete|fully completed|construction completed)\b/i.test(line))return null;
      // Do not promote module deliveries, financial completion, or a different
      // project in the same owner report. Need the named project and active work.
      const active=/\b(?:under construction|construction continues|construction is ongoing|construction is progressing|construction (?:progress|activities)|[1-9]?\d\s*%\s+complete)\b/i;
      if(line.length<80||!namesProject(line,project)||!active.test(line))continue;
      const nearby=paragraphs.slice(Math.max(0,n-1),n+2).join('\n');
      if(/\b(?:paused|suspended|cancelled|canceled|on hold|100\s*%\s+complete|fully completed|construction completed)\b/i.test(nearby))return null;
      const quote=originalQuote(d.text,line);
      if(quote)return {documentId:d.id,url:d.url,quote,date};
    }
  }
  return null;
}
