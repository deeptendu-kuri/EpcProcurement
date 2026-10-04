// @vitest-environment node
import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { createTestDb,setDbForTests,type Db } from "@/mvp/db";
import { startRun,waitForRun,liveSources } from "@/mvp/pipeline";
import { listOpportunities } from "@/mvp/opportunities";
import { getBuyerView } from "@/mvp/buyers";
import type { RunRow } from "@/mvp/types";
const complete=vi.hoisted(()=>vi.fn());
vi.mock("@/mvp/llm",async original=>({...await original<typeof import("@/mvp/llm")>(),getLLM:()=>({name:"groq",complete})}));
let db:Db;
const quote="Atlas Works is an EPC contractor in India constructing gas transmission pipelines with line pipe.";
const buyer={company:"Atlas Works",country:"IN",role:"epc_contractor",companyQuote:quote,countryQuote:quote,productQuote:quote,project:null,projectQuote:null,confidence:0.95};
beforeAll(async()=>{db=await createTestDb();setDbForTests(db);},120_000);
afterAll(async()=>{setDbForTests(undefined);await db.close();});
beforeEach(()=>{
  vi.stubEnv("MVP_OFFLINE","0");vi.stubEnv("MVP_MAX_AI_DOCS","1");complete.mockReset();complete.mockResolvedValue({text:JSON.stringify({buyers:[buyer]})});
  for(const source of liveSources())vi.spyOn(source,"collect").mockResolvedValue([]);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function run(){const id=await startRun({query:"line pipe",productId:"line-pipe",markets:["IN"],leadKinds:["supply_subcontract"]});await waitForRun(id);return (await db.query<RunRow>("select * from runs where id=$1",[id])).rows[0];}
describe("real-mode product pipeline wiring (providers mocked; isolated database)",()=>{
  it("saves a company buyer without an award and reuses evidence on subsequent searches without consuming AI budget",async()=>{
    vi.mocked(liveSources()[0].collect).mockResolvedValue([{sourceKey:"unit",sourceName:"Atlas",tier:"C",url:"https://atlas.example/company-services",title:"Atlas Works pipeline construction",text:quote,publishedAt:null,isSample:false}]);
    const a=await run();expect(a.status).toBe("done");expect(a.counters.scopedProspects).toBe(1);
    expect((await listOpportunities(a.id))[0]).toMatchObject({name:"Atlas Works",discovery_kind:"company",product_id:"line-pipe",project_id:null,validated_emails:0});
    const detail=await getBuyerView((await listOpportunities(a.id))[0].lead_id);expect(detail).not.toBeNull();expect(detail?.proof.length).toBeGreaterThan(0);
    const b=await run();expect(b.counters.scopedProspects).toBe(1);expect(complete).toHaveBeenCalledTimes(1);
    expect((await listOpportunities(b.id))[0].id).not.toBe((await listOpportunities(a.id))[0].id);
  });
  it("does not convert an all-analysis failure into a successful empty search",async()=>{
    vi.mocked(liveSources()[0].collect).mockResolvedValue([{sourceKey:"unit",sourceName:"Failing",tier:"C",url:"https://atlas.example/failing-page",title:"Atlas Works gas pipeline construction",text:quote+" Fresh page.",publishedAt:null,isSample:false}]);
    complete.mockRejectedValue(new Error("quota unavailable"));const result=await run();expect(result.status).toBe("failed");expect(result.error).toContain("Buyer analysis failed");
    expect(await listOpportunities(result.id)).toEqual([]);
  });
});
