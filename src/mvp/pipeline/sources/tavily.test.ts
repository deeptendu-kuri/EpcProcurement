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
    fetchMock.mockResolvedValue(new Response(JSON.stringify({results:[{url:"https://official.example/award",title:"Carbon steel pipe award",content:"Search snippet is not verified"}]}),{status:200}));
    const rows=await tavilySource.collect(ctx);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({text:null,fallbackText:null,isSample:false});
    const request=fetchMock.mock.calls[0][1];expect(request.headers.authorization).toBe("Bearer unit-secret");
    expect(JSON.parse(request.body).query).toContain("contract awarded");expect(JSON.parse(request.body).query).toContain("India");
    expect(JSON.parse(request.body).include_answer).toBe(false);expect(request.redirect).toBe("error");
  });
  it("reports quota or auth failures without including provider response or secrets",async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({error:"unit-secret"}),{status:429}));
    await expect(tavilySource.collect(ctx)).rejects.toThrow("HTTP 429");
  });
});
