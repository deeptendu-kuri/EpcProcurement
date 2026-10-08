// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {createTestDb,type Db} from "@/mvp/db";
import {buyerQueries} from "@/mvp/discovery/plan";
import type {SourceContext} from "../contracts";
import {cachedTavilyQuery,collectTavilyQuery} from "./tavily";
const fetchMock=vi.fn();let db:Db;let ctx:SourceContext & {db:Db};
const input={query:"line pipe",productId:"line-pipe",markets:["IN"],leadKinds:["supply_subcontract" as const]};
const query=buyerQueries(input)[0];
beforeAll(async()=>{db=await createTestDb();},120_000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
  const run=(await db.query<{id:string}>("insert into runs(status) values('running') returning id")).rows[0];
  ctx={runId:run.id,input,profile:{} as SourceContext["profile"],terms:[],log:vi.fn(async()=>{}),db};
  vi.stubEnv("TAVILY_API_KEY","unit-secret");vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("successful query replay without repeating search credits",()=>{
  it("persists URL results with no snippet evidence and reuses them in the same run",async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({results:[{url:"https://atlas.example/services",title:"Atlas",content:"not evidence"}]}),{status:200}));
    expect(await cachedTavilyQuery(ctx,query)).toBeNull();
    const original=await collectTavilyQuery(ctx,query);
    expect(original[0]).toMatchObject({text:null,fallbackText:null,isSample:false});
    expect(await cachedTavilyQuery(ctx,query)).toEqual(original);
    expect(await collectTavilyQuery(ctx,query)).toEqual(original);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await db.query<{result:unknown}>("select result from research_query_cache where run_id=$1",[ctx.runId])).rows[0].result).toEqual({results:[{url:"https://atlas.example/services",title:"Atlas",content:'not evidence'}]});
  });
  it("caches successful empty responses, which must not automatically spend again",async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({results:[]}),{status:200}));
    expect(await collectTavilyQuery(ctx,query)).toEqual([]);
    expect(await cachedTavilyQuery(ctx,query)).toEqual([]);
    expect(await collectTavilyQuery(ctx,query)).toEqual([]);expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("accepts an undated provider result and preserves it as unknown, not a new publication date",async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({results:[{url:'https://atlas.example/services',title:'Atlas services',published_date:null}]}),{status:200}));
    const original=await collectTavilyQuery(ctx,query);
    expect(original[0].publishedAt).toBeNull();
    expect(await collectTavilyQuery(ctx,query)).toEqual(original);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps changed wording or different run provenance separate",async()=>{
    fetchMock.mockImplementation(async()=>new Response(JSON.stringify({results:[]}),{status:200}));
    await collectTavilyQuery(ctx,query);
    await collectTavilyQuery(ctx,{...query,query:query.query+" industrial"});
    const otherRun=(await db.query<{id:string}>("insert into runs(status) values('running') returning id")).rows[0].id;
    await collectTavilyQuery({...ctx,runId:otherRun},query);expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does not cache quota/auth/network responses, but blocks automatic repetition of accepted unreadable responses",async()=>{
    fetchMock.mockResolvedValueOnce(new Response("unit-secret",{status:429}));
    await expect(collectTavilyQuery(ctx,query)).rejects.toThrow("HTTP 429");
    expect(await cachedTavilyQuery(ctx,query)).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("unit-secret"));
    await expect(collectTavilyQuery(ctx,query)).rejects.toThrow("could not connect");
    fetchMock.mockResolvedValueOnce(new Response("not json",{status:200}));
    await expect(collectTavilyQuery(ctx,query)).rejects.toThrow("unreadable response");
    await expect(cachedTavilyQuery(ctx,query)).rejects.toThrow('review before repeating');
    await expect(collectTavilyQuery(ctx,query)).rejects.toThrow('review before repeating');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('does not reuse a cache after country/time/domain routing semantics change',async()=>{
    fetchMock.mockImplementation(async()=>new Response(JSON.stringify({results:[]}),{status:200}));
    await collectTavilyQuery(ctx,query);
    await collectTavilyQuery(ctx,{...query,timeRange:'year'});
    await collectTavilyQuery(ctx,{...query,includeDomains:['atlas.example']});
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('bounds a routing preview and never exposes it as source text',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({results:[{url:'https://atlas.example/',title:'Atlas',content:'x'.repeat(5000)}]}),{status:200}));
    const result=await collectTavilyQuery(ctx,query);
    expect(result[0].research?.searchPreview).toHaveLength(1200);
    expect(result[0].text).toBeNull();expect(result[0].fallbackText).toBeNull();
  });
});
