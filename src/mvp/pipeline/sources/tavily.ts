import { z } from "zod";
import { COUNTRIES } from "@/mvp/config/countries";
import type { Source } from "../contracts";

export const tavilySource: Source = {
  key:"tavily",name:"Targeted web research",
  async collect(ctx) {
    const key=process.env.TAVILY_API_KEY?.trim(); if (!key) return [];
    const markets=ctx.input.markets.map(code=>COUNTRIES.find(c=>c.code===code)?.name??code).join(" OR ");
    const query=`${ctx.input.query} (${markets}) EPC contractor subcontractor contract awarded project -tender -bid invitation`.slice(0,550);
    const res=await fetch("https://api.tavily.com/search",{method:"POST",redirect:"error",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},
      body:JSON.stringify({query,search_depth:"basic",max_results:15,topic:"general",include_answer:false,include_raw_content:false}),signal:AbortSignal.timeout(20_000)});
    if (!res.ok) throw new Error(`Targeted web search unavailable (HTTP ${res.status}). Check Tavily key/quota.`);
    const data=z.object({results:z.array(z.object({url:z.url(),title:z.string(),published_date:z.string().optional()}))}).parse(await res.json());
    await ctx.log(`Targeted web search returned ${data.results.length} pages. Original pages must be read and quotes verified; search snippets are not evidence.`);
    return data.results.filter(r=>new URL(r.url).protocol==="https:").map(r=>({sourceKey:"tavily",sourceName:new URL(r.url).hostname,tier:"C" as const,
      url:r.url,title:r.title,publishedAt:r.published_date??null,text:null,fallbackText:null,isSample:false}));
  },
};
