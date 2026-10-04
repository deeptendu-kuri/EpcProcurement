import { z } from "zod";
import type { Source } from "../contracts";
import { buyerQueries, queryBudget } from "@/mvp/discovery/plan";

export const tavilySource: Source = {
  key:"tavily",name:"Targeted web research",
  async collect(ctx) {
    const key=process.env.TAVILY_API_KEY?.trim(); if (!key) return [];
    const planned=buyerQueries(ctx.input);const queries=planned.slice(0,queryBudget());
    if(!queries.length)return [];
    const docs=new Map<string,Awaited<ReturnType<Source["collect"]>>[number]>();
    let succeeded=0;
    for(const query of queries) {
      let res:Response;
      try {
        res=await fetch("https://api.tavily.com/search",{method:"POST",redirect:"error",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},
          body:JSON.stringify({query:query.query,search_depth:"basic",max_results:8,topic:"general",include_answer:false,include_raw_content:false}),signal:AbortSignal.timeout(20_000)});
      } catch {
        await ctx.log(`Targeted ${query.market} ${query.lane} search could not connect. Earlier successful pages are retained; no paid retries.`);
        continue;
      }
      if(!res.ok) {
        await ctx.log(`Targeted ${query.market} ${query.lane} search unavailable (HTTP ${res.status}); no paid retries.`);
        if(res.status===401 || res.status===403 || res.status===429) {
          if(!succeeded)throw new Error(`Targeted web search unavailable (HTTP ${res.status}). Check Tavily key/quota.`);
          break;
        }
        continue;
      }
      const parsed=z.object({results:z.array(z.object({url:z.url(),title:z.string(),published_date:z.string().optional()}))}).safeParse(await res.json().catch(()=>null));
      if(!parsed.success){await ctx.log(`Targeted ${query.market} search returned an unreadable response; earlier pages are retained.`);continue;}
      const data=parsed.data;
      succeeded++;
      await ctx.log(`${query.market}: ${query.lane==='company'?'company buying activities':'awarded / ongoing projects'} — ${data.results.length} pages found. Search location is not verified company location.`);
      for(const r of data.results)if(new URL(r.url).protocol==='https:' && !docs.has(r.url))docs.set(r.url,{sourceKey:"tavily",sourceName:new URL(r.url).hostname,tier:"C",
        url:r.url,title:r.title,publishedAt:r.published_date??null,text:null,fallbackText:null,isSample:false});
    }
    if(!succeeded)throw new Error("Targeted web searches failed. No fictional results substituted.");
    await ctx.log(`${succeeded}/${planned.length} targeted queries completed within a ${queryBudget()}-request budget. Unsearched countries/routes need another search. Original pages, not snippets, provide evidence.`);
    return [...docs.values()];
  },
};
