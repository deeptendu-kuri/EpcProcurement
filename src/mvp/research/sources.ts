/** One original source request per durable job; no multi-country/feed collector loop. */
import type {RawDoc,SourceContext} from '@/mvp/pipeline/contracts';
import {ACTION_TERMS,findScope,hasTerm,scopeTermsFor} from '@/mvp/pipeline/filter';
import {getText,politeWait} from '@/mvp/pipeline/read';
import {hostOf,publisherKeyFor} from '@/mvp/pipeline/text';
import {BING_MKT,BING_NEWS_URL,parseBingRss} from '@/mvp/pipeline/sources/bing-news';
import {parseFeed,RSS_MAX_PER_FEED} from '@/mvp/pipeline/sources/rss';
const buying=(blurb:string,ctx:SourceContext)=>[...ACTION_TERMS.en,...ACTION_TERMS.ar,...ACTION_TERMS.ms].some(t=>hasTerm(blurb,t))&&Boolean(findScope(blurb,scopeTermsFor(ctx.profile,ctx.terms)));
export async function collectBingQuery(ctx:SourceContext,market:string,query:string):Promise<RawDoc[]> {
  await politeWait('www.bing.com',2000);
  const url=`${BING_NEWS_URL}?${new URLSearchParams({q:query,format:'rss',mkt:BING_MKT[market]??'en-US'})}`;
  const res=await getText(url,'application/rss+xml, application/xml, text/xml',15000);
  if(!res.ok)throw new Error(`News source HTTP ${res.status}`);
  return parseBingRss(res.text).filter(item=>buying(`${item.title}\n${item.description}`,ctx)).slice(0,8).map(item=>({sourceKey:`bing:${hostOf(item.url)??'news'}`,sourceName:`News · ${item.source??hostOf(item.url)??'Bing'}`,tier:'B',publisherKey:publisherKeyFor(item.url),url:item.url,title:item.title,publishedAt:item.published,text:null,market:null,isSample:false}));
}
export async function collectRssFeed(ctx:SourceContext,url:string):Promise<RawDoc[]> {
  const host=hostOf(url)??'rss';await politeWait(host);
  const res=await getText(url,'application/rss+xml, application/atom+xml, application/xml, text/xml',15000);
  if(!res.ok)throw new Error(`RSS source HTTP ${res.status}`);
  return parseFeed(res.text).filter(item=>buying(`${item.title}\n${item.description}`,ctx)).slice(0,RSS_MAX_PER_FEED).map(item=>({sourceKey:`rss:${hostOf(item.link)??host}`,sourceName:`RSS · ${host}`,tier:'B',publisherKey:publisherKeyFor(item.link),url:item.link,title:item.title,publishedAt:item.published,text:null,isSample:false}));
}
