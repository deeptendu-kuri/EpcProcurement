// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { getOpportunity, isVerified } from "@/mvp/opportunities";
import { enrichOpportunity, enrichmentView } from "./index";
import { POST } from "@/app/api/mvp/opportunities/[id]/enrichment/route";
const publicResearch=vi.hoisted(()=>vi.fn());
const publicConfigured=vi.hoisted(()=>vi.fn());
vi.mock("./public-contacts",()=>({publicContactsConfigured:publicConfigured,researchPublishedContacts:publicResearch,researchCompanyWebsite:publicResearch,searchPublishedContacts:vi.fn()}));
vi.mock("@/mvp/buyers", () => ({ getBuyerView: vi.fn(async () => ({ role: "epc_contractor" })) }));
let db: Db;
let s: { company: string; lead: string; opportunity: string };
const fetchMock = vi.fn();
const candidate = { value: "jane@buyer.co", type: "personal", first_name: "Jane", last_name: "Doe", position: "Procurement Manager", sources: [{ uri: "https://buyer.co/team" }] };
const verified = { email: "jane@buyer.co", status: "valid", regexp: true, gibberish: false, disposable: false,
  webmail: false, mx_records: true, smtp_server: true, smtp_check: true, accept_all: false, block: false };
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const search = () => enrichOpportunity(s.opportunity, { action: "search", domain: "buyer.co", domainConfirmed: true });
beforeAll(async () => { db = await createTestDb(); setDbForTests(db); }, 120_000);
afterAll(async () => { setDbForTests(undefined); await db?.close(); });
beforeEach(async () => {
  publicResearch.mockReset();publicConfigured.mockReturnValue(true);
  vi.stubEnv("HUNTER_API_KEY", "unit-test-only-key"); vi.stubEnv("HUNTER_DAILY_REQUEST_LIMIT", "5"); vi.stubEnv("APP_URL", "");
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  await db.exec("delete from enrichment_requests");
  const company = (await db.query<{ id: string }>("insert into companies (canonical_name,normalized_name,country) values ('Test EPC','test epc','IN') returning id")).rows[0].id;
  const lead = (await db.query<{ id: string }>("insert into leads (kind,buyer_company_id,score_breakdown,gate_results,class,reasons,scoring_version,is_sample) values ('supply_subcontract',$1,'{}','[]','research','[]',1,false) returning id", [company])).rows[0].id;
  const run = (await db.query<{ id: string }>("insert into runs (status) values ('done') returning id")).rows[0].id;
  const opportunity = (await db.query<{ id: string }>(`insert into search_opportunities (run_id,lead_id,company_id,keyword,product_id,product_name,buying_reason,evidence_ids,qualification)
    values ($1,$2,$3,'pipeline','line-pipe','Line pipe','Unit-test evidence','{}','approved') returning id`, [run,lead,company])).rows[0].id;
  s = { company, lead, opportunity };
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("scoped contact enrichment", () => {
  it("stores company switchboards separately and named roles without email cannot become verified",async()=>{
    vi.stubEnv("HUNTER_API_KEY","");
    publicResearch.mockResolvedValue({contacts:[{name:"Jane Doe",title:"Procurement Manager",email:null,sources:["https://buyer.co/team"]}],companyContacts:[{kind:"phone",value:"+91 22 3064 2100",source_url:"https://buyer.co/contact",quote:"Phone +91 22 3064 2100"},{kind:"email",value:"info@buyer.co",source_url:"https://buyer.co/contact",quote:"Business enquiries info@buyer.co"}]});
    const result=await search();expect(result.view.contacts[0]).toMatchObject({name:"Jane Doe",email:null,verified_at:null});expect(result.view.companyContacts).toHaveLength(2);expect((await getOpportunity(s.opportunity))!.validated_emails).toBe(0);
    expect((await db.query("select id from contact_points where person_id=$1",[result.view.contacts[0].id])).rows).toHaveLength(0);
    await search();expect(publicResearch).toHaveBeenCalledTimes(1);
  });
  it("does not merge a provider candidate into a reviewed same-name employee with a different title", async () => {
    const existing = (await db.query<{ id: string }>("insert into people (full_name,normalized_name,current_company_id,title,confirmed_at) values ('Jane Doe','jane doe',$1,'Marketing Manager',now()) returning id", [s.company])).rows[0].id;
    fetchMock.mockResolvedValue(response({ domain: "buyer.co", emails: [candidate] }));
    const result = await search();
    const newContact = result.view.contacts.find(c => c.email === candidate.value)!;
    expect(newContact.id).not.toBe(existing); expect(newContact.confirmed_at).toBeNull();
    expect(result.view.contacts.find(c => c.id === existing)?.title).toBe("Marketing Manager");
  });
  it("keeps supported named contacts with optional buying-team role tags and caches repeated clicks", async () => {
    fetchMock.mockResolvedValue(response({ domain: "buyer.co", emails: [candidate, { ...candidate, first_name: "Bob", value: "bob@buyer.co", position: "Marketing Designer" }] }));
    const result = await search();
    expect(result.view.contacts).toHaveLength(2); expect(result.view.domainConfirmed).toBe(true);
    expect(result.view.contacts.find(c=>c.name==="Jane Doe")).toMatchObject({ name: "Jane Doe", confirmed_at: null, verified_at: null, validation_status: "not_checked" });
    const other=result.view.contacts.find(c=>c.name==="Bob Doe")!;
    expect((await db.query("select id from person_roles where person_id=$1",[other.id])).rows).toHaveLength(0);
    expect(isVerified((await getOpportunity(s.opportunity))!)).toBe(false);
    await search(); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await enrichmentView(s.opportunity)).contacts).toHaveLength(2);
    const events = (await db.query<{ body: string }>("select body from opportunity_events where opportunity_id=$1", [s.opportunity])).rows;
    expect(events[0].body).toContain("not validated");
  });
  it("reads company pages without API configuration or credits and durably caches empty or populated results",async()=>{
    publicConfigured.mockReturnValue(false);
    vi.stubEnv("HUNTER_API_KEY","");vi.stubEnv("TAVILY_API_KEY","");vi.stubEnv("GROQ_API_KEY","");vi.stubEnv("HUNTER_DAILY_REQUEST_LIMIT","1");
    publicResearch.mockReset();publicResearch.mockResolvedValue({contacts:[],companyContacts:[{kind:"phone",value:"+91 22 3064 2100",source_url:"https://buyer.co/contact",quote:"Phone +91 22 3064 2100"}]});
    const input={action:"search" as const,domain:"buyer.co",domainConfirmed:true as const,websiteOnly:true};
    await enrichOpportunity(s.opportunity,input);await enrichOpportunity(s.opportunity,input);
    expect(publicResearch).toHaveBeenCalledTimes(1);
    expect((await db.query("select id from enrichment_requests where input_hash not like 'website:%'")).rows).toHaveLength(0);
    const result=await enrichmentView(s.opportunity);expect(result.companyContacts).toHaveLength(1);
    expect((await getOpportunity(s.opportunity))!.validated_emails).toBe(0);
    vi.stubEnv("HUNTER_API_KEY","unit-test-only-key");fetchMock.mockResolvedValue(response({domain:"buyer.co",emails:[]}));
    await search();expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires independent fit review, current role review and actual deliverability before Verified CRM", async () => {
    fetchMock.mockResolvedValueOnce(response({ domain: "buyer.co", emails: [candidate] })).mockResolvedValueOnce(response(verified));
    const contact = (await search()).view.contacts[0];
    const verify = () => enrichOpportunity(s.opportunity, { action: "verify", personId: contact.id, pointId: contact.point_id! });
    await verify(); expect((await getOpportunity(s.opportunity))!.validated_emails).toBe(0);
    await enrichOpportunity(s.opportunity, { action: "confirm_role", personId: contact.id });
    expect(isVerified((await getOpportunity(s.opportunity))!)).toBe(true);
    const before = (await enrichmentView(s.opportunity)).contacts[0].verified_at;
    await verify(); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await enrichmentView(s.opportunity)).contacts[0].verified_at).toBe(before); // cache does not renew validity
    await db.query("update search_opportunities set qualification='pending' where id=$1", [s.opportunity]);
    expect(isVerified((await getOpportunity(s.opportunity))!)).toBe(false);
    await db.query("update people set confirmed_at=now()-interval '91 days' where id=$1", [contact.id]);
    expect((await getOpportunity(s.opportunity))!.validated_emails).toBe(0);
  });
  it("keeps catch-all/unknown emails unvalidated even after current-role review", async () => {
    fetchMock.mockResolvedValueOnce(response({ domain: "buyer.co", emails: [candidate] })).mockResolvedValueOnce(response({ ...verified, status: "accept_all", accept_all: true }));
    const c = (await search()).view.contacts[0];
    await enrichOpportunity(s.opportunity, { action: "confirm_role", personId: c.id });
    const result = await enrichOpportunity(s.opportunity, { action: "verify", personId: c.id, pointId: c.point_id! });
    expect(result.view.contacts[0]).toMatchObject({ verified_at: null, validation_status: "accept_all" });
    expect(isVerified((await getOpportunity(s.opportunity))!)).toBe(false);
  });
  it("refuses sample data and a contact from another company before any provider call", async () => {
    await db.query("update leads set is_sample=true where id=$1", [s.lead]);
    await expect(search()).rejects.toMatchObject({ status: 409 });
    await db.query("update leads set is_sample=false where id=$1", [s.lead]);
    const foreign = (await db.query<{ id: string }>("insert into people (full_name,normalized_name) values ('Other Person','other person') returning id")).rows[0].id;
    await expect(enrichOpportunity(s.opportunity, { action: "find", personId: foreign })).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("finds missing emails only after domain confirmation; discovery remains unverified", async () => {
    const person = (await db.query<{ id: string }>("insert into people (full_name,normalized_name,current_company_id,title) values ('Jane Doe','jane doe',$1,'Procurement Manager') returning id", [s.company])).rows[0].id;
    await expect(enrichOpportunity(s.opportunity, { action: "find", personId: person })).rejects.toMatchObject({ status: 409 });
    await db.query("update companies set domain='buyer.co',domain_confirmed_at=now() where id=$1", [s.company]);
    fetchMock.mockResolvedValue(response({ email: "jane@buyer.co", first_name: "Jane", last_name: "Doe" }));
    const result = await enrichOpportunity(s.opportunity, { action: "find", personId: person });
    expect(result.view.contacts[0]).toMatchObject({ email: "jane@buyer.co", verified_at: null });
  });
  it("caps actual provider attempts and caches failures without consuming another request", async () => {
    vi.stubEnv("HUNTER_DAILY_REQUEST_LIMIT", "1");
    fetchMock.mockResolvedValue(new Response("provider error", { status: 429 }));
    await expect(search()).rejects.toMatchObject({ status: 429 });
    await expect(search()).rejects.toMatchObject({ status: 429 });
    await expect(enrichOpportunity(s.opportunity, { action: "search", domain: "other.co", domainConfirmed: true })).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await db.query("select id from enrichment_requests")).rows).toHaveLength(1);
  });
  it("blocks simultaneous duplicate provider requests", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>(r => { resolve = r; }));
    const first = search();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await expect(search()).rejects.toMatchObject({ status: 409 });
    resolve(response({ domain: "buyer.co", emails: [] }));
    await first; expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("invalidates earlier Hunter verification when the official domain changes", async () => {
    fetchMock.mockResolvedValueOnce(response({ domain: "buyer.co", emails: [candidate] })).mockResolvedValueOnce(response(verified));
    const c = (await search()).view.contacts[0];
    await enrichOpportunity(s.opportunity, { action: "verify", personId: c.id, pointId: c.point_id! });
    fetchMock.mockResolvedValue(response({ domain: "other.co", emails: [] }));
    const result = await enrichOpportunity(s.opportunity, { action: "search", domain: "other.co", domainConfirmed: true });
    expect(result.view.contacts[0]).toMatchObject({ verified_at: null, validation_status: "domain_changed" });
  });
  it("strictly validates private route input and rejects cross-origin changes", async () => {
    const request = (body: object, origin?: string) => new Request(`http://localhost:3007/api/mvp/opportunities/${s.opportunity}/enrichment`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    const ctx = { params: Promise.resolve({ id: s.opportunity }) };
    expect((await POST(request({ action: "search", domain: "buyer.co", domainConfirmed: false }), ctx)).status).toBe(400);
    expect((await POST(request({ action: "search", domain: "buyer.co", domainConfirmed: true, recipient: "buyer@buyer.co" }), ctx)).status).toBe(400);
    expect((await POST(request({ action: "search", domain: "buyer.co", domainConfirmed: true }, "http://evil.co"), ctx)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
