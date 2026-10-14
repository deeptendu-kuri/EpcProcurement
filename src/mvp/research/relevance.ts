import type { SearchBrief } from '@/mvp/discovery/brief';
import { namesWork } from '@/mvp/discovery/brief';
import { buyerPageCandidate, namesItem } from '@/mvp/discovery/plan';
import { tenderWording } from '@/mvp/sourcing/tender-sources';
import { NEED_WINDOW_MONTHS } from './need';

/** Locate the first actual business paragraph past short menus. This is an
 * excerpt of the stored original, never a generated summary or search snippet. */
export function articleAnalysisText(text:string):string {
  let offset=0;
  for(const line of text.split('\n')){
    if(line.length>=100&&line.split(/\s+/).length>=15&&/\b(?:contracts?|awarded|EPC|construct\w*|procurement|install\w*|maintenance|expan\w*|revamp\w*)\b/i.test(line)){
      const start=Math.max(0,offset-200);
      // The stored headline can name the contractor/contract, and the rules
      // extractor uses it too. Keep that original line when skipping navigation.
      return (start>0?`${text.split('\n')[0]}\n`:'')+text.slice(start,start+6500);
    }
    offset+=line.length+1;
  }
  return text.slice(0,6500);
}

/** Focus a work check on literal business paragraphs, including their immediate
 * source context. Full-page mode preserves useful identities/contacts, but its
 * navigation can otherwise consume the entire model excerpt. No summaries or
 * search snippets are introduced; quotes still validate against the full saved
 * original. Prefer actual contract/installation scope to industry navigation. */
export function workAnalysisText(text:string,brief:SearchBrief,limit=4500):string {
  // docs/mvp/22: a tender list shows each tender as its own lines (title, agency, due date): those blocks, not the
  // page's menus, are what the check reads (live probe, 14 Oct: tender18 listings sat after 100 lines of navigation).
  const tenders=tenderListingBlocks(text,brief);
  if(tenders.length)return [text.slice(0,200),...tenders].join('\n').slice(0,limit);
  const paragraphs=text.split(/\n+/);
  const score=(p:string)=>/\b(?:awarded|won|wins|secured|signed|received.{0,25}contract)\b/i.test(p)?30:
    /\b(?:EPC|procurement|fabrication|installation|maintenance contract)\b/i.test(p)?20:
    /\b(?:construct\w*|install\w*|fabricat\w*|maintain\w*|brewery|fermentation)\b/i.test(p)?10:0;
  const ranked=paragraphs.map((p,n)=>({n,score:score(p)})).filter(({n,score})=>score&&paragraphs[n].length>=40&&
    namesWork(paragraphs.slice(Math.max(0,n-1),n+2).join('\n'),brief)).sort((a,b)=>b.score-a.score||a.n-b.n);
  if(!ranked.length)return articleAnalysisText(text).slice(0,limit);
  const selected=new Set<number>(),spans:string[]=[text.slice(0,200)];
  let used=spans[0].length;
  for(const {n} of ranked)for(const index of [n,n-1,n+1]){
    if(index<0||index>=paragraphs.length||selected.has(index))continue;
    const p=paragraphs[index];
    if(p.length<10||used+p.length+1>limit)continue;
    selected.add(index);spans.push(p);used+=p.length+1;
  }
  return spans.join('\n');
}
/**
 * One block per tender on a tender list page: the lines around a title naming the item (reference, location, title,
 * buying agency, due date), joined by spaces so the quote still matches the original's whitespace. Only blocks that
 * carry a buyer or date label ("Agency / Dept", "Due Date"…), so marketing text about the item is never a tender.
 */
export function tenderListingBlocks(text:string,brief:SearchBrief,max=8):string[] {
  if(!brief.productId||!tenderWording(text))return [];
  const lines=text.split('\n'),blocks:string[]=[];
  let last=-1;
  for(let i=0;i<lines.length&&blocks.length<max;i++){
    const line=lines[i];
    if(i<=last||line.length>600||!namesItem(line,brief.productId,brief,true))continue;
    const from=Math.max(0,i-4,last+1),to=Math.min(lines.length,i+7);
    const block=lines.slice(from,to).map(l=>l.trim()).filter(Boolean).join(' ');
    if(block.length>=40&&block.length<=900&&/\b(?:agency|dept|department|organi[sz]ation|buyer|purchaser|due date|closing date|bid end|last date|opening date)\b/i.test(block)){blocks.push(block);last=to-1;}
  }
  return blocks;
}
/** Paragraph references let a provider select literal source text rather than
 * regenerate it. The returned paragraph is still verified against storage. */
export function workAnalysisParagraphs(text:string,brief:SearchBrief):string[]{
  return workAnalysisText(text,brief).split(/\n+/).filter(p=>p.trim().length>=10);
}

/** Cheap article triage BEFORE any P1/P2/need-check calls. Stored originals are
 * retained, but article navigation/snippets and industry keywords aren't proof. */
export function articleResearchReason(doc:{text:string;title?:string|null;publishedAt?:string|null},
  productId:string,brief?:SearchBrief,now=new Date()):string|null {
  const title=doc.title??'';
  if(/\b(?:interest rates?|stock price|stock market|share prices?|labor strike|labour strike|workers.{0,12}strike|opinion|editorial|obituary)\b/i.test(title))
    return 'Non-procurement article; no buyer analysis requested.';
  const date=doc.publishedAt?Date.parse(doc.publishedAt):NaN;
  if(Number.isFinite(date)&&now.getTime()-date>NEED_WINDOW_MONTHS*2.63e9)
    return 'Historical article outside the current-work window.';
  // Same bounded beginning the live extractor reads; a footer's related article
  // cannot qualify a page whose actual story is unrelated.
  const main=[title,articleAnalysisText(doc.text)].join('\n');
  const related=buyerPageCandidate(main,productId)||brief?.source==='ai'&&namesWork(main,brief);
  if(!related)return 'No relevant consuming work in the article body.';
  if(!/\b(?:EPC|contracts?|awarded|wins?|won|secured|procurement|construct\w*|install\w*|fabricat\w*|commission\w*|expan\w*|maintenance|retrofit\w*|revamp\w*|project|capacity)\b/i.test(main))
    return 'No business-work signal in the article body.';
  return null;
}
