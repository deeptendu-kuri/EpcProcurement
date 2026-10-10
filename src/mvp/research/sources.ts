/** One original source request per durable job; no multi-country/feed collector loop. */
import type {RawDoc,SourceContext} from '@/mvp/pipeline/contracts';
import {ACTION_TERMS,findScope,hasTerm,scopeTermsFor} from '@/mvp/pipeline/filter';
import {getText,politeWait} from '@/mvp/pipeline/read';
import {hostOf,publisherKeyFor} from '@/mvp/pipeline/text';
import {BING_MKT,BING_NEWS_URL,parseBingRss} from '@/mvp/pipeline/sources/bing-news';
import {parseFeed,RSS_MAX_PER_FEED} from '@/mvp/pipeline/sources/rss';
import {GDELT_URL,parseSeenDate} from '@/mvp/pipeline/sources/gdelt';
import {bingMarket,countryLanguage,gdeltCountry} from '@/mvp/config/country-meta';
import {localNewsQuery,localTerms} from '@/mvp/sourcing/local-terms';
import {getLLM} from '@/mvp/llm';
import {PIPING_PRODUCTS} from '@/mvp/sourcing/plan';
/**
 * Projects that consume piping materials. Award news names the project ("EPC contract for a gas plant"),
 * rarely the pipe or fitting, so for piping materials these count as scope too (web audit, 10 Oct).
 */
export const PIPING_PROJECT_SCOPE=['refinery','refineries','petrochemical','petrochemicals','gas processing','gas plant','lng','gas field','oil field','oilfield',
  'desalination','water treatment','sewage treatment','wastewater treatment','power plant','power station','combined cycle','iwp','ipp','fertilizer plant','ammonia plant',
  'offshore','onshore','tank farm','مصفاة','تحلية','محطة','بتروكيماويات','معالجة'];
const scopeFor=(ctx:SourceContext)=>[...scopeTermsFor(ctx.profile,ctx.terms),...(PIPING_PRODUCTS.has(ctx.input.productId??'')?PIPING_PROJECT_SCOPE:[])];
export const buying=(blurb:string,ctx:SourceContext)=>[...ACTION_TERMS.en,...ACTION_TERMS.ar,...ACTION_TERMS.ms].some(t=>hasTerm(blurb,t))&&Boolean(findScope(blurb,scopeFor(ctx)));
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

/**
 * Local news for one country (docs/mvp/19 Phase 3): Bing News in the country's market and language, with
 * the material and award words translated once per language (term_cache). English countries use their
 * English market with the country name in the query. Results carry the searched country.
 */
export async function collectLocalNews(ctx:SourceContext,payload:{market:string;query:string;material:string;work:string}):Promise<RawDoc[]> {
  const lang=countryLanguage(payload.market);
  const provider=ctx.db?getLLM('triage',ctx.db):null;
  const terms=ctx.db&&lang!=='en'?await localTerms(ctx.db,lang,payload.material,payload.work,provider,ctx.runId):null;
  const query=terms?localNewsQuery(terms):payload.query;
  const mkt=bingMarket(payload.market,terms?'local':'en');
  await politeWait('www.bing.com',2000);
  const res=await getText(`${BING_NEWS_URL}?${new URLSearchParams({q:query,format:'rss',mkt})}`,'application/rss+xml, application/xml, text/xml',15000);
  if(!res.ok)throw new Error(`Local news HTTP ${res.status}`);
  const local=terms?[terms.material,terms.awarded,terms.tender,terms.work].flatMap(t=>t.toLowerCase().split(/\s+/)).filter(w=>w.length>=3):[];
  const relevant=(blurb:string)=>buying(blurb,ctx)||local.some(w=>blurb.toLowerCase().includes(w));
  await ctx.log(`${payload.market}: local news (${mkt}${terms?`, ${lang}`:''}) "${query}".`);
  return parseBingRss(res.text).filter(item=>relevant(`${item.title}\n${item.description}`)).slice(0,8).map(item=>({sourceKey:`bing:${hostOf(item.url)??'news'}`,sourceName:`Local news · ${item.source??hostOf(item.url)??'Bing'}`,tier:'B',
    publisherKey:publisherKeyFor(item.url),url:item.url,title:decodeRefs(item.title),publishedAt:item.published,text:null,market:payload.market,language:terms?lang:'en',isSample:false}));
}

/** Feeds sometimes double-escape characters ("&#228;" for "ä"). */
export const decodeRefs=(text:string|null)=>text?text.replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&quot;/g,'"').replace(/&amp;/g,'&'):text;

/** GDELT asks for at most one request per 5 seconds; this keeps a 6-second gap across all searches. */
export const GDELT_GAP_MS=6000;
/**
 * News published IN one country, in any of 65 languages, searched with English words (GDELT DOC 2.0,
 * `sourcecountry:<FIPS>`). Free; often slow or throttled, so one attempt and failures are not fatal.
 */
export async function collectGdeltCountry(ctx:SourceContext,payload:{market:string;words:string[]}):Promise<RawDoc[]> {
  const fips=gdeltCountry(payload.market);if(!fips)return [];
  const words=payload.words.filter(w=>w.length>=3).slice(0,4).map(w=>/\s/.test(w)?`"${w.replace(/"/g,'')}"`:w);
  const query=`(${words.join(' OR ')}) (contract OR awarded OR tender OR order) sourcecountry:${fips}`;
  await politeWait('api.gdeltproject.org',GDELT_GAP_MS);
  const res=await getText(`${GDELT_URL}?${new URLSearchParams({query,mode:'artlist',format:'json',maxrecords:'30',timespan:'3months',sort:'datedesc'})}`,'application/json',25000);
  if(res.status===429||/limit requests to one every 5 seconds/i.test(res.text)){await ctx.log(`${payload.market}: country news (GDELT) is busy; skipped this time.`);return [];}
  if(!res.ok)throw new Error(`GDELT HTTP ${res.status}`);
  let articles:{url?:string;title?:string;seendate?:string;language?:string}[]=[];
  try{articles=(JSON.parse(res.text||'{}') as {articles?:typeof articles}).articles??[];}catch{throw new Error('GDELT answered without JSON.');}
  await ctx.log(`${payload.market}: country news (GDELT, local outlets in any language) — ${articles.length} articles.`);
  return articles.filter(a=>a.url&&/^https?:\/\//.test(a.url)).slice(0,10).map(a=>({sourceKey:`gdelt:${hostOf(a.url!)??'news'}`,sourceName:`Country news · ${hostOf(a.url!)??'GDELT'}`,tier:'B',
    publisherKey:publisherKeyFor(a.url!),url:a.url!,title:a.title??null,publishedAt:parseSeenDate(a.seendate),text:null,market:payload.market,language:a.language??null,isSample:false}));
}
