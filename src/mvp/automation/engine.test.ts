// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,it,expect,vi} from "vitest";
import {createTestDb,setDbForTests,type Db} from "@/mvp/db";
import {setFunnelEnabled} from "./config";
import {controlThread,enrollCompletedSearches,ingestInbox,listFunnelThreads,listThreadMessages,processFunnelTick,startEmailTest,listEmailTestMessages,sendSellerTestIntroduction} from "./engine";
const mocks=vi.hoisted(()=>({fit:vi.fn(),initial:vi.fn(),reply:vi.fn(),contact:vi.fn(),list:vi.fn(),read:vi.fn(),send:vi.fn(),slots:vi.fn(),book:vi.fn()}));
vi.mock("./ai",()=>({qualifyBuyer:mocks.fit,initialEmail:mocks.initial,analyseReply:mocks.reply}));
vi.mock("./contacts",()=>({prepareContact:mocks.contact}));
vi.mock("./calendar",()=>({availableSlots:mocks.slots,bookDemoMeeting:mocks.book}));
vi.mock("./resend",async importOriginal=>({...await importOriginal<typeof import("./resend")>(),listInboxPage:mocks.list,readInbound:mocks.read,sendFunnelMessage:mocks.send}));
let db:Db;
beforeAll(async()=>{db=await createTestDb();setDbForTests(db);},120_000);
afterAll(async()=>{setDbForTests(undefined);await db?.close();});
beforeEach(async()=>{
  vi.stubEnv("DEMO_EMAIL_ENABLED","1");vi.stubEnv("DEMO_RECIPIENT_EMAIL","deeptendukuri@gmail.com");vi.stubEnv("RESEND_API_KEY","unit");
  vi.stubEnv("RESEND_RECEIVING_DOMAIN","demo123.resend.app");vi.stubEnv("GROQ_API_KEY","unit");vi.stubEnv("HUNTER_API_KEY","unit");
  for(const fn of Object.values(mocks))fn.mockReset();
  mocks.fit.mockResolvedValue({approved:true,reason:"Quoted contract and product evidence"});
  mocks.initial.mockResolvedValue({subject:"Line pipe discussion",body:"Could we discuss your line pipe requirements?"});
  mocks.list.mockResolvedValue({data:[],has_more:false});
  mocks.send.mockResolvedValue({id:"provider-"+crypto.randomUUID(),rfcId:null});
  mocks.reply.mockResolvedValue({intent:"question",confidence:0.95,summary:"Buyer asked for specifications",body:"Which line pipe specification would you like to discuss?"});
  await db.exec("delete from funnel_messages;delete from funnel_threads;delete from funnel_integrations;delete from funnel_suppressions;delete from search_opportunities;delete from runs;delete from contact_points;delete from person_roles;delete from people;delete from leads;delete from companies;update funnel_control set enabled=false,enabled_at=null,worker_until=null,worker_lease=null,last_error=null;");
});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
async function seed(options:{sample?:boolean;approved?:boolean;company?:string;old?:boolean;validated?:boolean}={}) {
  const company=options.company??(await db.query<{id:string}>("insert into companies(canonical_name,normalized_name,country) values('Unit EPC','unit epc','IN') returning id")).rows[0].id;
  const existing=(await db.query<{id:string}>("select id from leads where buyer_company_id=$1 limit 1",[company])).rows[0];
  const lead=existing?.id??(await db.query<{id:string}>("insert into leads(kind,buyer_company_id,score_breakdown,gate_results,class,reasons,scoring_version,is_sample) values('supply_subcontract',$1,'{}','[]','research','[]',1,$2) returning id",[company,options.sample??false])).rows[0].id;
  const run=(await db.query<{id:string}>("insert into runs(status,created_at) values('done',case when $1::boolean then now()-interval '1 day' else now() end) returning id",[options.old??false])).rows[0].id;
  const o=(await db.query<{id:string}>(`insert into search_opportunities(run_id,lead_id,company_id,keyword,product_id,product_name,buying_reason,evidence_ids,qualification)
    values($1,$2,$3,'line pipe','line-pipe','Line pipe','Awarded piping contract','{}',$4) returning id`,[run,lead,company,options.approved?"approved":"pending"])).rows[0].id;
  const person=(await db.query<{id:string}>("insert into people(full_name,normalized_name,title,current_company_id,confirmed_at) values('Test Person','test person','Procurement Manager',$1,now()) returning id",[company])).rows[0].id;
  await db.query("insert into person_roles(person_id,company_id,buying_role) values($1,$2,'procurement_lead')",[person,company]);
  if(options.validated!==false)await db.query("insert into contact_points(person_id,kind,value,source,verified_at,validation_status) values($1,'email','test@unit-epc.example','provider:hunter:verifier',now(),'valid')",[person]);
  mocks.contact.mockResolvedValue({id:person,name:"Test Person",title:"Procurement Manager"});
  return {company,lead,run,o,person};
}
async function thread(o:string) {return (await db.query("select * from funnel_threads where opportunity_id=$1",[o])).rows[0];}
async function replyTo(o:string,body:string,overrides:Record<string,unknown>={}) {
  const t=await thread(o);const email={id:crypto.randomUUID(),from:"deeptendukuri@gmail.com",to:[`lead-${t.reply_token}@demo123.resend.app`],subject:"Re: Line pipe",
    created_at:new Date(Date.now()+1000).toISOString(),text:body,headers:{},authentication:{dmarc:"pass",dkim:"pass",spf:"pass"},message_id:`<${crypto.randomUUID()}@mail.gmail.com>`,...overrides};
  mocks.list.mockResolvedValue({data:[email],has_more:false});mocks.read.mockResolvedValue(email);return email;
}
describe("persistent demo research-to-meeting funnel",()=>{
  it("runs an explicitly labelled inbox test without creating or falsely qualifying any buyer",async()=>{
    await expect(startEmailTest("line-pipe")).rejects.toThrow("Enable");await setFunnelEnabled(true);
    const t=await startEmailTest("line-pipe");expect(await startEmailTest("line-pipe")).toMatchObject({id:t.id});
    expect(t).toMatchObject({mode:"email_test",opportunity_id:null,company_id:null,recipient:"deeptendukuri@gmail.com"});
    await processFunnelTick();expect(mocks.send).toHaveBeenCalledTimes(1);expect(mocks.fit).not.toHaveBeenCalled();expect(mocks.contact).not.toHaveBeenCalled();
    expect((await db.query("select id from search_opportunities")).rows).toHaveLength(0);expect((await listEmailTestMessages(t.id))[0]).toMatchObject({kind:"initial",state:"accepted"});
    const inbound={id:crypto.randomUUID(),from:"deeptendukuri@gmail.com",to:[`lead-${t.reply_token}@demo123.resend.app`],subject:"Re: Line pipe",created_at:new Date(Date.now()+1000).toISOString(),text:"What pipe specifications should we discuss?",authentication:{dmarc:"pass",dkim:"pass",spf:"pass"}};
    mocks.list.mockResolvedValue({data:[inbound],has_more:false});mocks.read.mockResolvedValue(inbound);mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});
    await processFunnelTick();expect(mocks.reply).toHaveBeenCalledTimes(1);expect(mocks.send).toHaveBeenCalledTimes(2);
    expect((await listFunnelThreads())[0].summary).toContain("specifications");
  });
  it("never retargets a conversation when its frozen recipient differs from the configured inbox",async()=>{
    await setFunnelEnabled(true);const t=await startEmailTest("line-pipe");await db.query("update funnel_threads set recipient='previous@example.com' where id=$1",[t.id]);
    await processFunnelTick();expect(mocks.initial).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
  });
  it("books an inbox-test meeting without inserting events or summaries into a nonexistent buyer CRM",async()=>{
    await db.query("insert into funnel_integrations(provider,account,encrypted_refresh_token) values('google','deeptendukuri@gmail.com','unit-unused')");
    await setFunnelEnabled(true);const t=await startEmailTest("line-pipe");await processFunnelTick();
    const slots=["2026-10-12T04:30:00.000Z","2026-10-13T04:30:00.000Z","2026-10-14T04:30:00.000Z"];
    mocks.slots.mockResolvedValue(slots);mocks.reply.mockResolvedValue({intent:"meeting_request",confidence:0.98,summary:"Demo inbox owner requested a meeting",body:""});
    async function incoming(text:string){const email={id:crypto.randomUUID(),from:"deeptendukuri@gmail.com",to:[`lead-${t.reply_token}@demo123.resend.app`],subject:"Re: Line pipe",created_at:new Date(Date.now()+1000).toISOString(),text,authentication:{dmarc:"pass",dkim:"pass",spf:"pass"}};mocks.list.mockResolvedValue({data:[email],has_more:false});mocks.read.mockResolvedValue(email);mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});}
    await incoming("Can you arrange a meeting?");await processFunnelTick();expect((await listFunnelThreads())[0].state).toBe("awaiting_time");
    await incoming("Please book slot 2");await processFunnelTick();mocks.book.mockResolvedValue({id:"test-calendar-event",url:"https://meet.google.com/abc-defg-hij"});await processFunnelTick();
    expect((await listFunnelThreads())[0]).toMatchObject({state:"meeting_booked",event_id:"test-calendar-event"});
    expect(mocks.send.mock.calls.at(-1)![0].body).toContain("https://meet.google.com/abc-defg-hij");
    expect((await db.query("select id from search_opportunities")).rows).toHaveLength(0);
    expect((await db.query("select id from opportunity_events")).rows).toHaveLength(0);
  });
  it("is opt-in, excludes samples and historical searches, and deduplicates repeated company/product searches",async()=>{
    const old=await seed({old:true});expect(await enrollCompletedSearches()).toBe(0);
    await setFunnelEnabled(true);await seed({sample:true});const current=await seed();await seed({company:current.company});
    expect(await enrollCompletedSearches()).toBe(1);expect(await enrollCompletedSearches()).toBe(0);
    expect(await thread(old.o)).toBeUndefined();expect((await listFunnelThreads())[0]).not.toHaveProperty("reply_token");
  });
  it("automatically qualifies and sends once after a completed search without a per-email approval",async()=>{
    await setFunnelEnabled(true);const s=await seed();
    await Promise.all([processFunnelTick(),processFunnelTick()]);
    expect(mocks.fit).toHaveBeenCalledTimes(1);expect(mocks.contact).toHaveBeenCalledTimes(1);expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(await thread(s.o)).toMatchObject({state:"active",person_id:s.person});
    expect((await listThreadMessages(s.o))[0]).toMatchObject({state:"accepted",kind:"initial"});
    await processFunnelTick();expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("blocks uncertain product fit, missing named contact, revoked validation and unreadable inbox",async()=>{
    await setFunnelEnabled(true);const s=await seed();mocks.fit.mockResolvedValueOnce({approved:false,reason:"No exact product evidence"});
    await processFunnelTick();expect((await thread(s.o)).state).toBe("review");expect(mocks.send).not.toHaveBeenCalled();
    const b=await seed({approved:true,validated:false});await processFunnelTick();expect((await thread(b.o)).state).toBe("needs_contact");
    expect(mocks.send).not.toHaveBeenCalled();mocks.list.mockRejectedValueOnce(new Error("HTTP 401 receiving key"));
    await expect(processFunnelTick()).rejects.toThrow("HTTP 401");expect(mocks.send).not.toHaveBeenCalled();
  });
  it("ingests an actual authenticated reply once, generates a polite AI response and saves CRM summary",async()=>{
    await setFunnelEnabled(true);const s=await seed();await processFunnelTick();mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});
    const email=await replyTo(s.o,"What specifications do you need?");await processFunnelTick();
    expect(mocks.reply).toHaveBeenCalledTimes(1);expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[1][0].in_reply_to).toBe(email.message_id);
    expect((await db.query("select summary from search_opportunities where id=$1",[s.o])).rows[0].summary).toContain("specifications");
    await processFunnelTick();expect(mocks.reply).toHaveBeenCalledTimes(1);expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it("rejects forged sender authentication and unrelated recipient tokens",async()=>{
    await setFunnelEnabled(true);const s=await seed();await processFunnelTick();
    await replyTo(s.o,"Please book a meeting",{authentication:{dmarc:"fail",dkim:"fail",spf:"fail"}});
    expect(await ingestInbox()).toBe(0);expect(mocks.reply).not.toHaveBeenCalled();
    await replyTo(s.o,"Please book a meeting",{to:["unrelated@demo123.resend.app"]});expect(await ingestInbox()).toBe(0);
  });
  it("suppresses the approved inbox globally on opt-out and never asks AI or sends a reply",async()=>{
    await setFunnelEnabled(true);const s=await seed();await processFunnelTick();
    await replyTo(s.o,"Please unsubscribe me");await processFunnelTick();
    expect((await thread(s.o)).state).toBe("stopped");expect(mocks.reply).not.toHaveBeenCalled();expect(mocks.send).toHaveBeenCalledTimes(1);
    expect((await db.query("select recipient from funnel_suppressions")).rows).toHaveLength(1);
  });
  it("offers real free slots, waits for explicit selection, creates the event and only then shares its Meet link",async()=>{
    await db.query("insert into funnel_integrations(provider,account,encrypted_refresh_token) values('google','deeptendukuri@gmail.com','unit-unused')");
    await setFunnelEnabled(true);const s=await seed();await processFunnelTick();
    const slots=["2026-10-12T04:30:00.000Z","2026-10-13T04:30:00.000Z","2026-10-14T04:30:00.000Z"];mocks.slots.mockResolvedValue(slots);
    mocks.reply.mockResolvedValue({intent:"meeting_request",confidence:0.98,summary:"Buyer requested a meeting",body:"Let's discuss"});
    await replyTo(s.o,"Can you share a meeting link?");mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});await processFunnelTick();
    expect((await thread(s.o)).state).toBe("awaiting_time");expect(mocks.book).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[1][0].body).toContain("Slot 1:");expect(mocks.send.mock.calls[1][0].body).not.toContain("https://meet.google.com");
    await replyTo(s.o,"Please book slot 2");await processFunnelTick();expect((await thread(s.o)).state).toBe("meeting_pending");
    mocks.book.mockResolvedValue({id:"unit-event",url:"https://meet.google.com/abc-defg-hij"});mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});
    await processFunnelTick();expect(mocks.book).toHaveBeenCalledWith((await thread(s.o)).id,slots[1],"Line pipe");
    expect((await thread(s.o)).state).toBe("meeting_booked");expect(mocks.send.mock.calls.at(-1)![0].body).toContain("https://meet.google.com/abc-defg-hij");
  });
  it("waits for Calendar consent without re-consuming AI credits, then resumes the actual meeting request automatically",async()=>{
    await setFunnelEnabled(true);const s=await seed();await processFunnelTick();
    mocks.reply.mockResolvedValue({intent:"meeting_request",confidence:0.99,summary:"Requested a meeting",body:""});
    await replyTo(s.o,"Please arrange a meeting and send a link");await processFunnelTick();
    expect((await thread(s.o)).state).toBe("awaiting_calendar");expect(mocks.slots).not.toHaveBeenCalled();
    await db.query("update funnel_threads set next_action_at=now() where opportunity_id=$1",[s.o]);await processFunnelTick();
    expect(mocks.reply).toHaveBeenCalledTimes(1);expect(mocks.send).toHaveBeenCalledTimes(1);
    await db.query("insert into funnel_integrations(provider,account,encrypted_refresh_token) values('google','deeptendukuri@gmail.com','unit-unused')");
    mocks.slots.mockResolvedValue(["2026-10-12T04:30:00.000Z"]);mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});await processFunnelTick();
    expect((await thread(s.o)).state).toBe("awaiting_time");expect(mocks.send).toHaveBeenCalledTimes(2);expect(mocks.send.mock.calls[1][0].body).toContain("Slot 1:");
  });
  it("answers a product question after suggesting times instead of treating every subsequent reply as meeting consent",async()=>{
    await db.query("insert into funnel_integrations(provider,account,encrypted_refresh_token) values('google','deeptendukuri@gmail.com','unit-unused')");
    await setFunnelEnabled(true);const s=await seed();await processFunnelTick();
    mocks.slots.mockResolvedValue(["2026-10-12T04:30:00.000Z"]);mocks.reply.mockResolvedValueOnce({intent:"meeting_request",confidence:0.99,summary:"Asked for a meeting",body:""});
    await replyTo(s.o,"Could we have a call?");mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});await processFunnelTick();
    await replyTo(s.o,"What grades should I send you before the call?");mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});await processFunnelTick();
    expect(mocks.slots).toHaveBeenCalledTimes(1);expect(mocks.book).not.toHaveBeenCalled();expect(mocks.send.mock.calls.at(-1)![0].body).toContain("specification");
    expect((await thread(s.o)).state).toBe("engaged");
  });
  it("sends only one explicitly requested corrected seller introduction, preserving the inbox-test history",async()=>{
    await setFunnelEnabled(true);const t=await startEmailTest("line-pipe");await processFunnelTick();
    await sendSellerTestIntroduction(t.id);await expect(sendSellerTestIntroduction(t.id)).rejects.toThrow("pending");
    mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});await processFunnelTick();
    expect(mocks.send).toHaveBeenCalledTimes(2);expect((await listEmailTestMessages(t.id)).filter(m=>m.kind==="seller_intro")).toHaveLength(1);
    await sendSellerTestIntroduction(t.id);await processFunnelTick();expect(mocks.send).toHaveBeenCalledTimes(2);
    expect((await db.query("select id from search_opportunities")).rows).toHaveLength(0);
  });
  it("pauses all sends, respects per-thread pause and bounds retries of frozen messages",async()=>{
    await setFunnelEnabled(true);const s=await seed();await enrollCompletedSearches();const t=await thread(s.o);
    await controlThread(String(t.id),"pause");await processFunnelTick();expect(mocks.send).not.toHaveBeenCalled();
    await controlThread(String(t.id),"resume");mocks.send.mockRejectedValue(new Error("timeout"));
    for(let i=0;i<3;i++)await expect(processFunnelTick()).rejects.toThrow("uncertain");
    await processFunnelTick();expect(mocks.send).toHaveBeenCalledTimes(3);expect((await thread(s.o)).state).toBe("review");
    await expect(controlThread(String(t.id),"retry")).rejects.toThrow("uncertain");
    await setFunnelEnabled(false);expect(await processFunnelTick()).toEqual({processed:false});
  });
  it("limits chasing to two working-hour follow-ups and resumes a conversation only on an actual reply",async()=>{
    await setFunnelEnabled(true);const s=await seed();await processFunnelTick();
    vi.setSystemTime(new Date("2026-10-12T05:00:00Z"));
    for(let i=0;i<3;i++) {
      await db.query("update funnel_threads set next_action_at=now()-interval '1 minute' where opportunity_id=$1",[s.o]);
      await db.query("update funnel_messages set created_at=now()-interval '4 days' where thread_id=(select id from funnel_threads where opportunity_id=$1) and direction='out'",[s.o]);
      mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});await processFunnelTick();
    }
    expect(mocks.send).toHaveBeenCalledTimes(3);expect((await thread(s.o)).followups).toBe(2);
    expect((await listThreadMessages(s.o)).filter(m=>m.kind==='followup')).toHaveLength(2);
    await replyTo(s.o,"What specification can we discuss?");mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});await processFunnelTick();
    expect((await thread(s.o)).state).toBe("engaged");expect(mocks.reply).toHaveBeenCalledTimes(1);
  });
  it("does not use another contact's validation to authorize a revoked selected person",async()=>{
    await setFunnelEnabled(true);const s=await seed();mocks.send.mockRejectedValueOnce(new Error("timeout"));
    await expect(processFunnelTick()).rejects.toThrow("uncertain");
    await db.query("update people set confirmed_at=null where id=$1",[s.person]);
    const other=(await db.query<{id:string}>("insert into people(full_name,normalized_name,title,current_company_id,confirmed_at) values('Other Manager','other manager','Procurement Manager',$1,now()) returning id",[s.company])).rows[0].id;
    await db.query("insert into person_roles(person_id,company_id,buying_role) values($1,$2,'procurement_lead')",[other,s.company]);
    await db.query("insert into contact_points(person_id,kind,value,source,verified_at) values($1,'email','other@unit-epc.example','provider:hunter:verifier',now())",[other]);
    await processFunnelTick();expect((await thread(s.o)).state).toBe("review");expect((await thread(s.o)).reason).toContain("selected person");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
