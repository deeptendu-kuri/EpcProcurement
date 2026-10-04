// @vitest-environment node
import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { createTestDb,type Db } from "@/mvp/db";
import { storeDocument } from "@/mvp/pipeline/read";
import { discoverBuyers,saveBuyer,validateBuyer,type DiscoveredBuyer } from "./index";
import { buyerQueries,exactProductEvidence } from "./plan";
import type { RunInput } from "@/mvp/types";
import type { RawDoc } from "@/mvp/pipeline/contracts";
const mock=vi.hoisted(()=>({complete:vi.fn(),name:"groq"}));
vi.mock("@/mvp/llm",()=>({getLLM:()=>mock}));
const quote="Atlas Works is an EPC contractor in India constructing gas transmission pipelines with line pipe.";
const buyer:DiscoveredBuyer={company:"Atlas Works",country:"IN",role:"epc_contractor",companyQuote:quote,countryQuote:quote,productQuote:quote,project:null,projectQuote:null,confidence:0.95};
const input:RunInput={query:"line pipe",productId:"line-pipe",markets:["IN"],leadKinds:["supply_subcontract"]};
const raw:RawDoc & {text:string}={url:"https://atlas.example/services",sourceKey:"tavily",sourceName:"Atlas",tier:"C",title:"Atlas Works pipeline construction",text:quote,publishedAt:null,isSample:false};
let db:Db;
beforeAll(async()=>{db=await createTestDb();},120_000);
afterAll(async()=>{await db.close();});
beforeEach(()=>{mock.name="groq";mock.complete.mockReset();mock.complete.mockResolvedValue({text:JSON.stringify({buyers:[buyer]})});});
afterEach(()=>vi.unstubAllEnvs());
async function source() {const run=(await db.query<{id:string}>("insert into runs(status) values('running') returning id")).rows[0].id;const doc=await storeDocument(db,run,raw);await db.query("insert into run_documents(run_id,document_id) values($1,$2) on conflict do nothing",[run,doc.id]);return {run,doc};}
describe("company-first evidence-backed buyer discovery",()=>{
  it("plans country-specific company and awarded-project queries, not one country OR search",()=>{
    const plans=buyerQueries({...input,markets:["IN","SA"]});expect(plans).toHaveLength(4);expect(plans.map(p=>p.market)).toEqual(["IN","SA","IN","SA"]);
    expect(plans[0].query).toContain("pipeline construction");expect(plans[2].query).toContain("contract awarded");expect(plans[0].query).not.toContain("Saudi");
  });
  it("allows a documented contractor without an award, but requires the exact product/application",()=>{
    expect(validateBuyer(buyer,quote,input)).toBe(true);
    expect(validateBuyer(buyer,quote,{...input,productId:"cs-process-pipe"})).toBe(false);
    expect(exactProductEvidence("Atlas Works installs HDPE water pipelines","line-pipe")).toBe(false);
    expect(exactProductEvidence("Atlas Works constructs process steel pipe spools","line-pipe")).toBe(false);
    expect(exactProductEvidence("Atlas Works constructs gas transmission pipelines","line-pipe")).toBe(true);
  });
  it("rejects sellers, owners, invented quotes, borrowed scope, fabricated geography and project names",()=>{
    expect(validateBuyer({...buyer,role:"supplier"},quote,input)).toBe(false);
    expect(validateBuyer({...buyer,role:"owner"},quote,input)).toBe(false);
    expect(validateBuyer({...buyer,productQuote:"Atlas Works requires invented API 5L pipe"},quote,input)).toBe(false);
    expect(validateBuyer({...buyer,company:"Someone Else"},quote,input)).toBe(false);
    expect(validateBuyer({...buyer,country:"SA"},quote,{...input,markets:["SA"]})).toBe(false);
    const brand="Atlas Works is an EPC contractor executing gas transmission pipelines for Aramco.";
    expect(validateBuyer({...buyer,country:"SA",companyQuote:brand,countryQuote:brand,productQuote:brand},brand,{...input,markets:["SA"]})).toBe(false);
    expect(validateBuyer({...buyer,project:"Imaginary Project",projectQuote:quote},quote,input)).toBe(false);
    const tender="Atlas Works invites bids in India for a gas pipeline construction tender notice.";
    expect(validateBuyer({...buyer,companyQuote:tender,countryQuote:tender,productQuote:tender},tender,input)).toBe(false);
  });
  it("caches successful extraction by document content and product, but still rechecks evidence and geography",async()=>{
    const {run,doc}=await source();expect((await discoverBuyers(db,run,input,doc,raw)).buyers).toHaveLength(1);
    expect((await discoverBuyers(db,run,input,doc,raw)).cached).toBe(true);expect(mock.complete).toHaveBeenCalledTimes(1);
    expect((await discoverBuyers(db,run,{...input,markets:["SA"]},doc,raw)).buyers).toHaveLength(0);
    expect(mock.complete).toHaveBeenCalledTimes(1);
    const changed=await storeDocument(db,run,{...raw,text:quote+" New services announced."});
    await discoverBuyers(db,run,input,changed,raw);expect(mock.complete).toHaveBeenCalledTimes(2);
  });
  it("persists real source provenance without fake projects or fake verified contacts, and retries do not duplicate",async()=>{
    const {run,doc}=await source();expect(await saveBuyer(db,run,input,doc.id,raw,buyer)).toBe(true);
    expect(await saveBuyer(db,run,input,doc.id,raw,buyer)).toBe(false);
    const row=(await db.query("select o.discovery_kind,o.product_id,o.qualification,l.is_sample,l.project_id from search_opportunities o join leads l on l.id=o.lead_id where o.run_id=$1",[run])).rows[0];
    expect(row).toMatchObject({discovery_kind:"company",product_id:"line-pipe",qualification:"pending",is_sample:false,project_id:null});
    expect((await db.query("select id from contact_points")).rows).toEqual([]);
    expect((await db.query("select id from projects")).rows).toEqual([]);
    await expect(saveBuyer(db,run,input,doc.id,raw,{...buyer,company:"Invented"})).rejects.toThrow("evidence failed");
  });
  it("never substitutes a mock provider and never caches failed calls",async()=>{
    const {run,doc}=await source();const different={...input,productId:"ball-valves"};
    mock.name="mock";await expect(discoverBuyers(db,run,different,doc,raw)).rejects.toThrow("Live Groq");
    mock.name="groq";mock.complete.mockRejectedValueOnce(new Error("quota"));await expect(discoverBuyers(db,run,different,doc,raw)).rejects.toThrow("quota");
    expect((await db.query("select result from buyer_discovery_cache where product_id='ball-valves'")).rows).toEqual([]);
  });
});
