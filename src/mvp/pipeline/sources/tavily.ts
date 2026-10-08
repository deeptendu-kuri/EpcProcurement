import { createHash } from "node:crypto";
import { z } from "zod";
import type { RawDoc, Source, SourceContext } from "../contracts";
import type { Db } from "@/mvp/db";
import { buyerQueries, queryBudget, type PlannedBuyerQuery } from "@/mvp/discovery/plan";
import { researchBudget } from '@/mvp/discovery/plan';
import { sourcePlan,tavilyTask } from '@/mvp/sourcing/plan';

const responseSchema=z.object({results:z.array(z.object({url:z.url(),title:z.string(),content:z.string().nullable().optional().transform(v=>v?.slice(0,1200)),published_date:z.string().nullable().optional()})).max(100),usage:z.object({credits:z.number().nonnegative()}).optional()});
// Supported provider country boosts, not proof of the company's location. Other
// countries still work through the query; never send an unsupported enum.
const COUNTRY_BOOSTS:Record<string,string>={AE:'united arab emirates',IN:'india',SA:'saudi arabia',US:'united states',GB:'united kingdom',MY:'malaysia',NO:'norway',QA:'qatar',OM:'oman',KW:'kuwait',BH:'bahrain',SG:'singapore',AU:'australia',CA:'canada',DE:'germany',FR:'france',ZA:'south africa'};
const EXCLUDED_DOMAINS=['facebook.com','instagram.com','youtube.com','tiktok.com','pinterest.com','researchgate.net','indeed.com','glassdoor.com'];
function requestBody(query:PlannedBuyerQuery) {
  return {query:query.query,search_depth:'basic',max_results:20,topic:query.topic??'general',include_answer:false,include_raw_content:false,
    auto_parameters:false,include_published_date:true,include_usage:true,exclude_domains:EXCLUDED_DOMAINS,
    ...(query.topic!=='news'&&COUNTRY_BOOSTS[query.market]?{country:COUNTRY_BOOSTS[query.market]}:{}),
    ...(query.timeRange?{time_range:query.timeRange}:{}),...(query.topic==='news'?{days:query.days??365}:{}),...(query.includeDomains?.length?{include_domains:query.includeDomains}:{})};
}
type QueryContext=SourceContext & {db?:Db};
function cacheKey(query:PlannedBuyerQuery) {
  const body=requestBody(query);
  return `hybrid-query-v1:${createHash("sha256").update(JSON.stringify({...body,query:body.query.toLowerCase().trim().replace(/\s+/g,' ')})).digest("hex")}`;
}
function documents(data:z.infer<typeof responseSchema>,query:PlannedBuyerQuery):RawDoc[] {
  const docs=new Map<string,RawDoc>();
  for(const result of data.results){
    const url=new URL(result.url);
    if(url.protocol!=="https:"||docs.has(result.url))continue;
    docs.set(result.url,{sourceKey:"tavily",sourceName:url.hostname,tier:"C",url:result.url,title:result.title,
      publishedAt:result.published_date??null,text:null,fallbackText:null,isSample:false,research:{lane:query.lane,sourcingLane:query.sourcingLane,...(result.content?{searchPreview:result.content}:{})}});
  }
  return [...docs.values()];
}
/** The durable dispatcher can check this BEFORE reserving a chargeable search. */
export async function cachedTavilyQuery(ctx:QueryContext,query:PlannedBuyerQuery):Promise<RawDoc[]|null> {
  if(!ctx.db||!ctx.runId)return null;
  const row=(await ctx.db.query<{result:unknown;run_id:string;completed_at:string}>(`select result,run_id,completed_at from research_query_cache where query_key=$2 and
    (run_id=$1 or completed_at>now()-interval '7 days' and result ? 'results') order by (run_id=$1) desc,completed_at desc limit 1`,[ctx.runId,cacheKey(query)])).rows[0];
  if(!row)return null;
  const parsed=responseSchema.safeParse(row.result);
  if(!parsed.success)throw new Error("Saved targeted query results could not be read; review before repeating a chargeable search.");
  if(row.run_id!==ctx.runId)await ctx.db.query('insert into research_query_cache(run_id,query_key,result,completed_at) values($1,$2,$3::jsonb,$4) on conflict do nothing',[ctx.runId,cacheKey(query),JSON.stringify(parsed.data),row.completed_at]);
  return documents(parsed.data,query);
}
/** Exactly one provider request per task; no hidden retries or invented snippet evidence. */
export async function collectTavilyQuery(ctx:QueryContext,query:PlannedBuyerQuery):Promise<RawDoc[]> {
  const cached=await cachedTavilyQuery(ctx,query);
  if(cached!==null){await ctx.log(`${query.market}: ${query.lane} search reused ${cached.length} saved URLs; no new search credit.`);return cached;}
  const key=process.env.TAVILY_API_KEY?.trim();if(!key)throw new Error("Targeted web search is not configured.");
  let response:Response;
  try {
    response=await fetch("https://api.tavily.com/search",{method:"POST",redirect:"error",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},
      body:JSON.stringify(requestBody(query)),signal:AbortSignal.timeout(20_000)});
  }catch{throw new Error("Targeted web search could not connect; no automatic paid retry.");}
  if(!response.ok)throw new Error(`Targeted web search unavailable (HTTP ${response.status}). Check quota/access; no automatic paid retry.`);
  const parsed=responseSchema.safeParse(await response.json().catch(()=>null));
  if(!parsed.success){
    // An accepted HTTP 200 may have consumed credit even when parsing failed.
    // Persist a fail-closed marker, without arbitrary provider bodies/secrets.
    if(ctx.db&&ctx.runId)await ctx.db.query("insert into research_query_cache(run_id,query_key,result) values($1,$2,$3::jsonb) on conflict do nothing",[ctx.runId,cacheKey(query),JSON.stringify({unreadable:true})]);
    throw new Error("Targeted web search returned an unreadable response; review before repeating a chargeable search.");
  }
  if(ctx.db&&ctx.runId)await ctx.db.query("insert into research_query_cache(run_id,query_key,result) values($1,$2,$3::jsonb) on conflict do nothing",[ctx.runId,cacheKey(query),JSON.stringify(parsed.data)]);
  const docs=documents(parsed.data,query);
  await ctx.log(`${query.market}: ${query.lane==='company'?'company buying activities':query.lane==='project'?'awarded / ongoing projects':'material-consuming work'} — ${docs.length} pages found. Search location is not verified company location.`);
  return docs;
}

/** Compatibility collector for bounded local runs. Durable jobs call collectTavilyQuery directly. */
export const tavilySource:Source={key:"tavily",name:"Targeted web research",async collect(ctx){
  if(!process.env.TAVILY_API_KEY?.trim())return [];
  const planned=ctx.input.productId?sourcePlan({productId:ctx.input.productId,keyword:ctx.input.query,markets:ctx.input.markets,mode:researchBudget(ctx.input).mode,lanes:ctx.input.lanes})
    .filter(task=>task.source==='tavily').map(tavilyTask):buyerQueries(ctx.input);
  const queries=planned.slice(0,queryBudget(ctx.input));
  if(!queries.length)return [];
  const docs=new Map<string,RawDoc>();let succeeded=0;
  for(const query of queries){
    try{for(const doc of await collectTavilyQuery(ctx,query))if(!docs.has(doc.url))docs.set(doc.url,doc);succeeded++;}
    catch(error){
      const safe=error instanceof Error?error.message:"Targeted query failed; no automatic paid retry.";
      await ctx.log(`${query.market} ${query.lane}: ${safe}`);
      if(/HTTP (?:401|403|429)/.test(safe)){if(!succeeded)throw new Error(safe);break;}
    }
  }
  if(!succeeded)throw new Error("Targeted web searches failed. No fictional results substituted.");
  await ctx.log(`${succeeded}/${planned.length} targeted queries completed within a ${queryBudget(ctx.input)}-request budget. Unsearched countries/routes remain pending. Original pages, not snippets, provide evidence.`);
  return [...docs.values()];
}};
