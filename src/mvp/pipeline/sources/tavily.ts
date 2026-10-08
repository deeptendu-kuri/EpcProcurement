import { createHash } from "node:crypto";
import { z } from "zod";
import type { RawDoc, Source, SourceContext } from "../contracts";
import type { Db } from "@/mvp/db";
import { buyerQueries, queryBudget, type PlannedBuyerQuery } from "@/mvp/discovery/plan";

const responseSchema=z.object({results:z.array(z.object({url:z.url(),title:z.string(),content:z.string().nullable().optional().transform(v=>v?.slice(0,1200)),published_date:z.string().nullable().optional()})).max(100)});
// Supported provider country boosts, not proof of the company's location. Other
// countries still work through the query; never send an unsupported enum.
const COUNTRY_BOOSTS:Record<string,string>={AE:'united arab emirates',IN:'india',SA:'saudi arabia',US:'united states',GB:'united kingdom',MY:'malaysia',NO:'norway',QA:'qatar',OM:'oman',KW:'kuwait',BH:'bahrain',SG:'singapore',AU:'australia',CA:'canada',DE:'germany',FR:'france',ZA:'south africa'};
const EXCLUDED_DOMAINS=['facebook.com','instagram.com','youtube.com','tiktok.com','pinterest.com','researchgate.net','indeed.com','glassdoor.com'];
function requestBody(query:PlannedBuyerQuery) {
  return {query:query.query,search_depth:'basic',max_results:20,topic:'general',include_answer:false,include_raw_content:false,
    auto_parameters:false,include_published_date:true,include_usage:true,exclude_domains:EXCLUDED_DOMAINS,
    ...(COUNTRY_BOOSTS[query.market]?{country:COUNTRY_BOOSTS[query.market]}:{}),
    ...(query.timeRange?{time_range:query.timeRange}:{}),...(query.includeDomains?.length?{include_domains:query.includeDomains}:{})};
}
type QueryContext=SourceContext & {db?:Db};
function cacheKey(query:PlannedBuyerQuery) {
  return `${query.key}:${createHash("sha256").update(JSON.stringify(requestBody(query))).digest("hex")}`;
}
function documents(data:z.infer<typeof responseSchema>,query:PlannedBuyerQuery):RawDoc[] {
  const docs=new Map<string,RawDoc>();
  for(const result of data.results){
    const url=new URL(result.url);
    if(url.protocol!=="https:"||docs.has(result.url))continue;
    docs.set(result.url,{sourceKey:"tavily",sourceName:url.hostname,tier:"C",url:result.url,title:result.title,
      publishedAt:result.published_date??null,text:null,fallbackText:null,isSample:false,research:{lane:query.lane,...(result.content?{searchPreview:result.content}:{})}});
  }
  return [...docs.values()];
}
/** The durable dispatcher can check this BEFORE reserving a chargeable search. */
export async function cachedTavilyQuery(ctx:QueryContext,query:PlannedBuyerQuery):Promise<RawDoc[]|null> {
  if(!ctx.db||!ctx.runId)return null;
  const row=(await ctx.db.query<{result:unknown}>("select result from research_query_cache where run_id=$1 and query_key=$2",[ctx.runId,cacheKey(query)])).rows[0];
  if(!row)return null;
  const parsed=responseSchema.safeParse(row.result);
  if(!parsed.success)throw new Error("Saved targeted query results could not be read; review before repeating a chargeable search.");
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
  const planned=buyerQueries(ctx.input),queries=planned.slice(0,queryBudget(ctx.input));
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
