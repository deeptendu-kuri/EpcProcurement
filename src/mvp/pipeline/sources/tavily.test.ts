// @vitest-environment node
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {tavilySource} from "./tavily";
import type {SourceContext} from "../contracts";
const fetchMock=vi.fn();const log=vi.fn();const ctx={input:{query:"carbon steel pipe",markets:["IN"],leadKinds:["supply_subcontract"]},log} as unknown as SourceContext;
beforeEach(()=>{vi.stubEnv("TAVILY_API_KEY","unit-secret");vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("targeted real web discovery",()=>{
  it("does nothing without a configured key",async()=>{vi.stubEnv("TAVILY_API_KEY","");expect(await tavilySource.collect(ctx)).toEqual([]);expect(fetchMock).not.toHaveBeenCalled();});
  it("queries actual award pages and refuses to turn search snippets into source evidence",async()=>{
    fetchMock.mockImplementation(async()=>new Response(JSON.stringify({results:[{url:"https://official.example/award",title:"Carbon steel pipe award",content:"Search snippet is not verified"}]}),{status:200}));
    const rows=await tavilySource.collect(ctx);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({text:null,fallbackText:null,isSample:false});
    const request=fetchMock.mock.calls[0][1];expect(request.headers.authorization).toBe("Bearer unit-secret");
    expect(JSON.parse(request.body).query).toContain("contractors");expect(JSON.parse(request.body).query).toContain("India");
    expect(JSON.parse(request.body)).toMatchObject({max_results:20,search_depth:'basic',country:'india',auto_parameters:false});
    expect(JSON.parse(request.body).exclude_domains).toContain('facebook.com');
    expect(JSON.parse(request.body).exclude_domains).toContain('linkedin.com');
    expect(rows[0].research?.searchPreview).toBe('Search snippet is not verified');
    expect(fetchMock).toHaveBeenCalledTimes(2);expect(JSON.parse(fetchMock.mock.calls[1][1].body).query).toContain("contract awarded");
    expect(JSON.parse(request.body).include_answer).toBe(false);expect(request.redirect).toBe("error");
  });
  it("reports quota or auth failures without including provider response or secrets",async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({error:"unit-secret"}),{status:429}));
    await expect(tavilySource.collect(ctx)).rejects.toThrow("HTTP 429");
  });
  it("caps requests and reports incomplete country coverage",async()=>{
    vi.stubEnv("MVP_MAX_SEARCH_QUERIES","1");
    fetchMock.mockImplementation(async()=>new Response(JSON.stringify({results:[]}),{status:200}));
    await tavilySource.collect({...ctx,input:{...ctx.input,markets:["IN","SA","AE"]}});
    expect(fetchMock).toHaveBeenCalledTimes(1);expect(log.mock.calls.at(-1)?.[0]).toContain("1/6 targeted queries completed");
  });
  it("retains successfully discovered pages when the next targeted query cannot connect",async()=>{
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({results:[{url:"https://official.example/services",title:"Contractor services"}]}),{status:200})).mockRejectedValueOnce(new Error("network unavailable"));
    const rows=await tavilySource.collect(ctx);expect(rows).toHaveLength(1);expect(rows[0].url).toBe("https://official.example/services");expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
