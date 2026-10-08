// @vitest-environment node
import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { createTestDb,type Db } from "@/mvp/db";
import { storeDocument } from "@/mvp/pipeline/read";
import { buyerEvidence,discoverBuyers,discoverySchema,saveBuyer,validateBuyer,type DiscoveredBuyer } from "./index";
import { buyerQueries,buyerResearchPriority,exactProductEvidence } from "./plan";
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
beforeEach(async()=>{await db.exec("delete from buyer_discovery_cache");mock.name="groq";mock.complete.mockReset();mock.complete.mockResolvedValue({text:JSON.stringify({buyers:[buyer]})});});
afterEach(()=>vi.unstubAllEnvs());
async function source() {const run=(await db.query<{id:string}>("insert into runs(status) values('running') returning id")).rows[0].id;const doc=await storeDocument(db,run,raw);await db.query("insert into run_documents(run_id,document_id) values($1,$2) on conflict do nothing",[run,doc.id]);return {run,doc};}
describe("company-first evidence-backed buyer discovery",()=>{
  it('drops malformed optional operating locations, never the grounded company or its literal country evidence',async()=>{
    const response={buyers:[{...buyer,operatingCountries:['AE',{country:'SA'},null,{country:'IN',quote}]}]};
    expect(discoverySchema.parse(response).buyers[0].operatingCountries).toEqual([{country:'IN',quote}]);
    const {run,doc}=await source();mock.complete.mockResolvedValue({text:JSON.stringify(response)});
    const first=await discoverBuyers(db,run,input,doc,raw);expect(first.buyers).toHaveLength(1);
    expect((await discoverBuyers(db,run,input,doc,raw)).cached).toBe(true);expect(mock.complete).toHaveBeenCalledTimes(1);
    expect((await discoverBuyers(db,run,{...input,markets:['AE']},doc,raw)).buyers).toEqual([]);
    const unknown=discoverySchema.parse({buyers:[{...buyer,country:null,countryQuote:null,operatingCountries:['AE']}]}).buyers[0];
    // The quote explicitly places work in India; malformed AE hints cannot hide that.
    expect(buyerEvidence(unknown,quote,{...input,markets:['AE']}).buyer).toBeNull();
  });
  it("keeps unknown geography blank and accepts an adjacent, unambiguous consuming activity",async()=>{
    const identity="Atlas Works is an engineering company.";
    const scope="We construct gas transmission pipelines with line pipe.";
    const text=identity+"\n\n"+scope;
    const candidate={...buyer,country:null,countryQuote:null,companyQuote:identity,productQuote:scope};
    const checked=buyerEvidence(candidate,text,input).buyer;
    expect(checked).not.toBeNull();expect(checked?.country).toBeNull();expect(text.includes(checked!.productQuote)).toBe(true);
    const other="Beta Works is another company.";
    expect(validateBuyer(candidate,identity+"\n\n"+other+"\n\n"+scope,input)).toBe(false);
    const run=(await db.query<{id:string}>("insert into runs(status) values('running') returning id")).rows[0].id;
    const original={...raw,url:"https://atlas.example/unknown-country",text};const doc=await storeDocument(db,run,original);
    expect(await saveBuyer(db,run,input,doc.id,original,candidate)).toBe(true);
    expect(await saveBuyer(db,run,input,doc.id,original,candidate)).toBe(false);
    expect((await db.query("select c.country,o.activity_status,o.material_fit_kind from search_opportunities o join companies c on c.id=o.company_id where o.run_id=$1",[run])).rows[0]).toMatchObject({country:null,activity_status:"capability_only",material_fit_kind:"explicit"});
  });
  it("attributes a later buying-work quote to the explicit short legal name, not another company",()=>{
    const identity="Likhitha Infrastructure Limited is an engineering and construction contractor serving India.";
    const scope="Likhitha Infrastructure undertakes construction of gas transmission pipelines.";
    const candidate={...buyer,company:"Likhitha Infrastructure Limited",companyQuote:identity,countryQuote:identity,productQuote:scope};
    expect(validateBuyer(candidate,identity+"\n"+scope,input)).toBe(true);
    const other="Beta Infrastructure undertakes construction of gas transmission pipelines.";
    expect(validateBuyer({...candidate,productQuote:other},identity+"\n"+other,input)).toBe(false);
  });
  it("accepts a short literal product excerpt only when the original company claim proves the work",async()=>{
    const {run,doc}=await source();mock.complete.mockResolvedValue({text:JSON.stringify({buyers:[{...buyer,productQuote:"gas transmission"}]})});
    const result=await discoverBuyers(db,run,input,doc,raw);expect(result.buyers).toHaveLength(1);expect(result.buyers[0].productQuote).toBe(quote);
    expect(validateBuyer({...buyer,productQuote:"unpublished pipe"},quote,input)).toBe(false);
  });
  it("plans country-specific company and awarded-project queries, not one country OR search",()=>{
    const plans=buyerQueries({...input,markets:["IN","SA"]});expect(plans).toHaveLength(8);expect(plans.slice(0,4).map(p=>p.market)).toEqual(["IN","SA","IN","SA"]);expect(plans.slice(0,2).map(p=>p.lane)).toEqual(["company","company"]);
    expect(plans[0].query).toContain("pipeline construction");expect(plans.find(p=>p.lane==='project')?.query).toContain("contract awarded");expect(plans[0].query).not.toContain("Saudi");
  });
  it("allows a documented contractor without an award, but requires the exact product/application",()=>{
    expect(validateBuyer(buyer,quote,input)).toBe(true);
    expect(validateBuyer(buyer,quote,{...input,productId:"cs-process-pipe"})).toBe(false);
    expect(exactProductEvidence("Atlas Works installs HDPE water pipelines","line-pipe")).toBe(false);
    expect(exactProductEvidence("Atlas Works constructs process steel pipe spools","line-pipe")).toBe(false);
    expect(exactProductEvidence("Atlas Works constructs gas transmission pipelines","line-pipe")).toBe(true);
  });
  it("does not reject valid source evidence because the reference score is low",()=>{
    expect(validateBuyer({...buyer,confidence:0},quote,input)).toBe(true);
    expect(validateBuyer({...buyer,confidence:1,productQuote:"Invented"},quote,input)).toBe(false);
  });
  it("matches a documented operating market rather than rejecting foreign headquarters",()=>{
    const scope="Atlas Works constructs gas transmission pipelines in Saudi Arabia.";
    const candidate={...buyer,productQuote:scope,operatingCountries:[{country:"SA",quote:scope}]};
    expect(buyerEvidence(candidate,quote+"\n"+scope,{...input,markets:["SA"]}).buyer).toMatchObject({country:'IN',operatingCountries:[{country:'SA',quote:scope}]});
    const other="Beta Works constructs gas transmission pipelines in Saudi Arabia.";
    expect(validateBuyer({...candidate,operatingCountries:[{country:"SA",quote:other}]},quote+"\n"+scope+"\n"+other,{...input,markets:["SA"]})).toBe(false);
  });
  it("retains a fabricator buying an input, not selling the searched material",()=>{
    const identity="Atlas Works manufactures and supplies steel structures in India.";
    const scope="Atlas Works performs structural welding using welding consumables.";
    expect(validateBuyer({...buyer,role:"fabricator",companyQuote:identity,countryQuote:identity,productQuote:scope},identity+"\n"+scope,{...input,productId:"welding-consumables"})).toBe(true);
    const output="Atlas Works manufactures and supplies welding consumables in India.";
    expect(validateBuyer({...buyer,role:"fabricator",companyQuote:output,countryQuote:output,productQuote:output},output,{...input,productId:"welding-consumables"})).toBe(false);
  });
  it("uses a cited operating-work country and literal activity when headquarters/product output is unusable",()=>{
    const identity="Larsen & Toubro Limited (L&T) is an engineering, procurement and construction contractor based in India.";
    const work="In the UAE, L&T has secured an order to construct 132/11 kV substations along with associated cabling works.";
    const candidate={...buyer,company:"Larsen & Toubro Limited (L&T)",companyQuote:identity,countryQuote:identity,productQuote:"...secured an order...",activityQuote:work};
    const checked=buyerEvidence(candidate,identity+"\n"+work,{...input,productId:"cables",markets:["AE"]}).buyer;
    expect(checked?.country).toBe("IN");expect(checked?.productQuote).toBe(work);expect(checked?.countryQuote).toBe(identity);expect(checked?.operatingCountries).toEqual([{country:'AE',quote:work}]);
    const other="In the UAE, Beta Works has secured an order to construct substations along with associated cabling works.";
    expect(validateBuyer({...candidate,activityQuote:other},identity+"\n"+other,{...input,productId:"cables",markets:["AE"]})).toBe(false);
    expect(validateBuyer({...candidate,activityQuote:null},identity+"\n"+work,{...input,productId:"cables",markets:["AE"]})).toBe(false);
    expect(exactProductEvidence("Unit EPC constructs substations and associated cabling works","cables")).toBe(true);
    expect(exactProductEvidence("Unit EPC installs telecom cabling works","cables")).toBe(false);
  });
  it("recovers shortened product and headquarters quotes from the live KPIL-shaped response",()=>{
    const identity="Kalpataru Projects International Limited (KPIL) secured a major EPC gas pipeline construction contract in the United Arab Emirates.";
    const headquarters="According to an exchange filing, the Mumbai-headquartered infrastructure major received the award.";
    const text=identity+" "+headquarters;
    const candidate={...buyer,company:"Kalpataru Projects International Limited (KPIL)",companyQuote:identity,
      productQuote:"secured a major EPC gas pipeline construction contract in the United Arab Emirates",countryQuote:"Mumbai-headquartered infrastructure major",confidence:0.2};
    const result=buyerEvidence(candidate,text,{...input,markets:['AE']});expect(result.buyer).not.toBeNull();
    expect(result.buyer?.productQuote).toBe(identity);expect(text.includes(result.buyer!.countryQuote!)).toBe(true);
    expect(result.buyer?.countryQuote).toContain("Mumbai");
  });
  it("supports explicitly defined acronyms and original typography without borrowing another company",()=>{
    const identity="Atlas Engineering Limited (AEL) is an EPC contractor.";
    const location="AEL is headquartered in India.";const scope="AEL constructs gas transmission pipelines with line pipe.";
    const text=[identity,location,scope].join("\n");
    expect(validateBuyer({...buyer,company:"Atlas Engineering Limited",companyQuote:identity,countryQuote:location,productQuote:scope},text,input)).toBe(true);
    const other="Beta Works is headquartered in Saudi Arabia.";
    expect(validateBuyer({...buyer,country:"SA",countryQuote:other},quote+" "+other,{...input,markets:["SA"]})).toBe(false);
    const borrowed="Beta Works constructs gas transmission pipelines with line pipe.";
    expect(validateBuyer({...buyer,productQuote:borrowed},quote+" "+borrowed,input)).toBe(false);
    const smart="Atlas Works is an EPC contractor in India constructing ‘line pipe’ gas transmission pipelines.";
    const plain=smart.replaceAll("‘","'").replaceAll("’","'");
    expect(buyerEvidence({...buyer,companyQuote:plain,countryQuote:plain,productQuote:plain},smart,input).buyer?.companyQuote).toBe(smart);
  });
  it("prioritizes targeted contractor project pages before global lists and unrelated news",()=>{
    const official={...raw,sourceKey:"tavily",url:"https://atlas.example/current-projects",title:"Our Current Projects"};
    const news={...raw,sourceKey:"bing",url:"https://news.example/award",title:"EPC contractor wins line pipe contract"};
    const list={...raw,sourceKey:"tavily",url:"https://directory.example/list",title:"Top 20 EPC companies"};
    expect(buyerResearchPriority(official,quote,input)).toBeGreaterThan(buyerResearchPriority(news,quote,input));
    expect(buyerResearchPriority(official,quote,input)).toBeGreaterThan(buyerResearchPriority(list,quote,input));
  });
  it("rejects sellers, owners, invented quotes, borrowed scope, fabricated geography and project names",()=>{
    expect(validateBuyer({...buyer,role:"supplier"},quote,input)).toBe(false);
    expect(validateBuyer({...buyer,role:"owner"},quote,input)).toBe(false);
    expect(validateBuyer({...buyer,productQuote:"Atlas Works requires invented API 5L pipe"},quote,input)).toBe(false);
    expect(validateBuyer({...buyer,company:"Someone Else"},quote,input)).toBe(false);
    expect(validateBuyer({...buyer,country:"SA"},quote,{...input,markets:["SA"]})).toBe(false);
    const brand="Atlas Works is an EPC contractor executing gas transmission pipelines for Aramco.";
    expect(validateBuyer({...buyer,country:"SA",companyQuote:brand,countryQuote:brand,productQuote:brand},brand,{...input,markets:["SA"]})).toBe(false);
    expect(buyerEvidence({...buyer,project:"Imaginary Project",projectQuote:quote},quote,input).buyer?.project).toBeNull();
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
  it("keeps valid buyers when a sibling candidate is malformed; omitted project fields mean unknown",async()=>{
    const special={...raw,url:"https://atlas.example/partial-response",text:quote+" Partial-response test."};
    const run=(await db.query<{id:string}>("insert into runs(status) values('running') returning id")).rows[0].id;
    const doc=await storeDocument(db,run,special);
    const {project,projectQuote,...minimal}=buyer;void project;void projectQuote;
    mock.complete.mockResolvedValue({text:JSON.stringify({buyers:[minimal,{company:"Broken response"}]})});
    const result=await discoverBuyers(db,run,input,doc,special);expect(result.buyers).toHaveLength(1);expect(result.buyers[0].project).toBeNull();expect(result.invalid).toBeGreaterThan(0);
    const cache=(await db.query<{result:{buyers:unknown[]}}>("select result from buyer_discovery_cache where document_id=$1",[doc.id])).rows[0];expect(cache.result.buyers).toHaveLength(2);
  });
  it('retains an accepted malformed JSON candidate for schema review instead of losing it and calling again',async()=>{
    const {run,doc}=await source();mock.complete.mockResolvedValue({text:JSON.stringify({buyers:[{company:'Malformed buyer'}]})});
    await expect(discoverBuyers(db,run,input,doc,raw)).rejects.toThrow('Invalid buyer response field');
    expect((await db.query('select result from buyer_discovery_cache where document_id=$1',[doc.id])).rows).toHaveLength(1);
    await expect(discoverBuyers(db,run,input,doc,raw)).rejects.toThrow('Invalid buyer response field');
    expect(mock.complete).toHaveBeenCalledTimes(1);
  });
});
