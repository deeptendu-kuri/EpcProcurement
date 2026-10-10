// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,it,expect,vi} from "vitest";
import {createTestDb,setDbForTests,type Db} from "@/mvp/db";
import {setFunnelEnabled} from "./config";
import { MeetingSlotUnavailableError } from './calendar';
import {controlThread,enrollCompletedSearches,ingestInbox,listFunnelThreads,listThreadMessages,processFunnelTick,startEmailTest,listEmailTestMessages,sendSellerTestIntroduction,startReviewedProspectDemo,reviewedProspectStatus,recoverMeetingSelection} from "./engine";
const mocks=vi.hoisted(()=>({fit:vi.fn(),initial:vi.fn(),reply:vi.fn(),contact:vi.fn(),list:vi.fn(),read:vi.fn(),send:vi.fn(),slots:vi.fn(),book:vi.fn()}));
vi.mock("./ai",()=>({qualifyBuyer:mocks.fit,initialEmail:mocks.initial,analyseReply:mocks.reply}));
vi.mock("./contacts",()=>({prepareContact:mocks.contact}));
vi.mock("./calendar",async importOriginal=>({...await importOriginal<typeof import('./calendar')>(),availableSlots:mocks.slots,bookDemoMeeting:mocks.book}));
vi.mock("./resend",async importOriginal=>({...await importOriginal<typeof import("./resend")>(),listInboxPage:mocks.list,readInbound:mocks.read,sendFunnelMessage:mocks.send}));
let db:Db;
beforeAll(async()=>{db=await createTestDb();setDbForTests(db);},120_000);
afterAll(async()=>{setDbForTests(undefined);await db?.close();});
beforeEach(async()=>{
  vi.stubEnv("DEMO_EMAIL_ENABLED","1");vi.stubEnv("DEMO_RECIPIENT_EMAIL","deeptendukuri@gmail.com");vi.stubEnv("RESEND_API_KEY","unit");
  vi.stubEnv("RESEND_RECEIVING_DOMAIN","demo123.resend.app");vi.stubEnv("GROQ_API_KEY","unit");vi.stubEnv("HUNTER_API_KEY","unit");
  vi.stubEnv("DEMO_CUSTOMER_NAME","Example Customer");
  for(const fn of Object.values(mocks))fn.mockReset();
  mocks.fit.mockResolvedValue({approved:true,reason:"Quoted contract and product evidence"});
  mocks.initial.mockResolvedValue({subject:"Line pipe discussion",body:"Could we discuss your line pipe requirements?"});
  mocks.list.mockResolvedValue({data:[],has_more:false});
  mocks.send.mockImplementation(async()=>({id:"provider-"+crypto.randomUUID(),rfcId:null}));
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
async function attachSource(s:Awaited<ReturnType<typeof seed>>) {
  const doc=(await db.query<{id:string}>("insert into source_documents(source_key,publisher_key,url,canonical_url,content_hash,text) values('unit','unit.example',$1,$1,'unit','Unit EPC performs line pipe construction in India') returning id",[`https://unit.example/${s.o}`])).rows[0].id;
  await db.query("insert into run_documents(run_id,document_id) values($1,$2)",[s.run,doc]);
  const evidence=(await db.query<{id:string}>("insert into evidence(document_id,url,quote,extracted_by,quote_verified,tier,publisher_key) values($1,'https://unit.example','Unit EPC performs line pipe construction in India','rule:unit',true,'C','unit.example') returning id",[doc])).rows[0].id;
  await db.query("update search_opportunities set evidence_ids=$2::uuid[],discovery_kind='company',fit_score=75 where id=$1",[s.o,[evidence]]);
}
async function replyTo(o:string,body:string,overrides:Record<string,unknown>={}) {
  const t=await thread(o);const email={id:crypto.randomUUID(),from:"deeptendukuri@gmail.com",to:[`lead-${t.reply_token}@demo123.resend.app`],subject:"Re: Line pipe",
    created_at:new Date(Date.now()+1000).toISOString(),text:body,headers:{},authentication:{dmarc:"pass",dkim:"pass",spf:"pass"},message_id:`<${crypto.randomUUID()}@mail.gmail.com>`,...overrides};
  mocks.list.mockResolvedValue({data:[email],has_more:false});mocks.read.mockResolvedValue(email);return email;
}
describe("persistent demo research-to-meeting funnel",()=>{
  async function incorrectlyClarifiedSelection(body='Slot 1: Thursday, 8 October 2026 at 10:00') {
    vi.setSystemTime(new Date('2026-10-07T13:20:00Z'));
    await setFunnelEnabled(true);const t=await startEmailTest('line-pipe');
    await db.query("update funnel_threads set state='awaiting_time',offered_slots=$2::jsonb where id=$1",[t.id,JSON.stringify(['2026-10-08T04:30:00.000Z'])]);
    const incoming=(await db.query<{id:string}>("insert into funnel_messages(thread_id,direction,kind,dedup_key,subject,body,state,analysed_at) values($1,'in','reply',$2,'Re: Line pipe',$3,'received',now()) returning id",[t.id,crypto.randomUUID(),body])).rows[0];
    await db.query("insert into funnel_messages(thread_id,direction,kind,dedup_key,subject,body,state) values($1,'out','scheduling_clarification',$2,'Re: Line pipe','Please confirm a slot','accepted')",[t.id,`reply-${incoming.id}`]);
    return {t,incoming};
  }
  it('recovers only the latest real misclarified selection and books through the normal worker once',async()=>{
    const {t,incoming}=await incorrectlyClarifiedSelection();
    await db.query("insert into funnel_integrations(provider,account,encrypted_refresh_token) values('google','deeptendukuri@gmail.com','unit-unused')");
    expect(await recoverMeetingSelection(t.id,incoming.id)).toMatchObject({start:'2026-10-08T04:30:00.000Z'});
    expect(mocks.book).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
    await expect(recoverMeetingSelection(t.id,incoming.id)).rejects.toThrow('awaiting a time');
    await processFunnelTick();expect((await listFunnelThreads())[0].state).toBe('meeting_pending');
    expect(mocks.reply).not.toHaveBeenCalled();
    mocks.book.mockResolvedValue({id:'recovered-event',url:'https://meet.google.com/abc-defg-hij'});
    await processFunnelTick();await processFunnelTick();
    expect(mocks.book).toHaveBeenCalledExactlyOnceWith(t.id,'2026-10-08T04:30:00.000Z',t.test_product);
    expect(mocks.send).toHaveBeenCalledTimes(1);expect(mocks.send.mock.calls[0][0].body).toContain('https://meet.google.com/abc-defg-hij');
    expect((await listEmailTestMessages(t.id)).filter(m=>m.kind==='scheduling_clarification')).toHaveLength(1);
  });
  it.each(['paused','disabled','busy','booked','stale','uncertain','suppressed','ambiguous'])('blocks unsafe meeting-selection recovery: %s',async mode=>{
    const {t,incoming}=await incorrectlyClarifiedSelection(mode==='ambiguous'?'Slot 1 or 2':undefined);
    if(mode==='paused')await controlThread(t.id,'pause');
    if(mode==='disabled')await setFunnelEnabled(false);
    if(mode==='busy')await db.query("update funnel_control set worker_until=now()+interval '1 minute'");
    if(mode==='booked')await db.query("update funnel_threads set event_id='existing-event' where id=$1",[t.id]);
    if(mode==='uncertain')await db.query("insert into funnel_messages(thread_id,direction,kind,dedup_key,subject,body,state) values($1,'out','reply',$2,'Re: Pipe','Uncertain','review')",[t.id,crypto.randomUUID()]);
    if(mode==='suppressed')await db.query("insert into funnel_suppressions(recipient,reason) values('deeptendukuri@gmail.com','unit opt-out')");
    await expect(recoverMeetingSelection(t.id,mode==='stale'?crypto.randomUUID():incoming.id)).rejects.toThrow();
    expect((await db.query('select analysed_at from funnel_messages where id=$1',[incoming.id])).rows[0].analysed_at).not.toBeNull();
    expect(mocks.book).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
  });
  it('automatically qualifies a source-backed partial search without manual review, score gates or contact enrichment',async()=>{
    vi.stubEnv('MVP_PROSPECT_DEMO_OUTREACH','on');await setFunnelEnabled(true);
    const s=await seed({validated:false});await attachSource(s);
    await db.query("insert into research_sessions(run_id,state,budget) values($1,'partial','{}')",[s.run]);
    await db.query('update search_opportunities set fit_score=1 where id=$1',[s.o]);
    expect(await reviewedProspectStatus(s.o)).toMatchObject({automaticEligible:true});
    await processFunnelTick();expect(await thread(s.o)).toMatchObject({state:'active',mode:'prospect_demo',person_id:null});
    expect(mocks.fit).toHaveBeenCalledTimes(1);expect(mocks.contact).not.toHaveBeenCalled();expect(mocks.send).toHaveBeenCalledTimes(1);
    expect((await db.query('select state from research_sessions where run_id=$1',[s.run])).rows[0].state).toBe('partial');
    await processFunnelTick();expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('does not enroll an active/cancelled search or source-less partial company',async()=>{
    vi.stubEnv('MVP_PROSPECT_DEMO_OUTREACH','on');await setFunnelEnabled(true);const s=await seed({validated:false});
    await db.query("insert into research_sessions(run_id,state,budget) values($1,'partial','{}')",[s.run]);
    expect(await enrollCompletedSearches()).toBe(0);await attachSource(s);
    await db.query("update research_sessions set state='active' where run_id=$1",[s.run]);expect(await enrollCompletedSearches()).toBe(0);
    await db.query("update research_sessions set state='cancelled' where run_id=$1",[s.run]);expect(await enrollCompletedSearches()).toBe(0);
    expect(mocks.fit).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
  });
  it('emails only a finished search, never its likely-only leads (a paused search waits until it ends)',async()=>{
    vi.stubEnv('MVP_PROSPECT_DEMO_OUTREACH','on');await setFunnelEnabled(true);const s=await seed({validated:false});await attachSource(s);
    await db.query("update runs set status='running' where id=$1",[s.run]);
    await db.query("insert into research_sessions(run_id,state,budget) values($1,'active','{}')",[s.run]);
    expect(await enrollCompletedSearches()).toBe(0);
    await db.query("update research_sessions set state='paused' where run_id=$1",[s.run]);expect(await enrollCompletedSearches()).toBe(0);
    await db.query("update runs set status='done' where id=$1",[s.run]);await db.query("update research_sessions set state='done' where run_id=$1",[s.run]);
    await db.query("update search_opportunities set verification='rating' where id=$1",[s.o]);expect(await enrollCompletedSearches()).toBe(0);
    await db.query("update search_opportunities set verification='website' where id=$1",[s.o]);expect(await enrollCompletedSearches()).toBe(1);
  });
  it('emails the top 3 leads of a finished search by default, best first, and no others',async()=>{
    vi.stubEnv('MVP_PROSPECT_DEMO_OUTREACH','on');vi.stubEnv('MVP_DEMO_PROSPECTS_PER_SEARCH','');await setFunnelEnabled(true);
    const s=await seed({validated:false});await attachSource(s);
    await db.query("insert into research_sessions(run_id,state,budget) values($1,'done','{}')",[s.run]);
    const evidence=(await db.query<{ids:string[]}>("select evidence_ids as ids from search_opportunities where id=$1",[s.o])).rows[0].ids;
    const fits:Record<string,number>={[s.o]:60};
    for(const [name,fit] of [['Second EPC',90],['Third EPC',80],['Fourth EPC',70]] as const){
      const company=(await db.query<{id:string}>("insert into companies(canonical_name,normalized_name,country) values($1,lower($1),'IN') returning id",[name])).rows[0].id;
      const lead=(await db.query<{id:string}>("insert into leads(kind,buyer_company_id,score_breakdown,gate_results,class,reasons,scoring_version) values('supply_subcontract',$1,'{}','[]','research','[]',1) returning id",[company])).rows[0].id;
      const o=(await db.query<{id:string}>(`insert into search_opportunities(run_id,lead_id,company_id,keyword,product_id,product_name,buying_reason,evidence_ids,qualification,discovery_kind,fit_score)
        values($1,$2,$3,'line pipe','line-pipe','Line pipe','Awarded piping contract',$4::uuid[],'pending','company',$5) returning id`,[s.run,lead,company,evidence,fit])).rows[0].id;
      fits[o]=fit;
    }
    await db.query("update search_opportunities set fit_score=60 where id=$1",[s.o]);
    expect(await enrollCompletedSearches()).toBe(3);
    const enrolled=(await db.query<{opportunity_id:string}>("select opportunity_id from funnel_threads")).rows.map(r=>fits[r.opportunity_id]).sort((a,b)=>b-a);
    expect(enrolled).toEqual([90,80,70]);
    expect(await enrollCompletedSearches()).toBe(0);
    expect((await reviewedProspectStatus(s.o))?.automaticReason).toBe('The top 3 leads of this search already have demo conversations. All other companies remain saved.');
  });
  it('automatically offers replacements if an agreed time expires or becomes occupied',async()=>{
    await setFunnelEnabled(true);const s=await seed();await processFunnelTick();
    const slots=['2026-10-12T04:30:00.000Z','2026-10-13T04:30:00.000Z'];
    await db.query("update funnel_threads set state='meeting_pending',meeting_start=$2,offered_slots=$3::jsonb,next_action_at=now() where opportunity_id=$1",[s.o,slots[0],JSON.stringify(slots)]);
    await replyTo(s.o,'Please book slot 1');await ingestInbox();
    await db.query('update funnel_messages set analysed_at=now() where direction=\'in\'');
    await db.query("update funnel_threads set state='meeting_pending' where opportunity_id=$1",[s.o]);
    mocks.book.mockRejectedValue(new MeetingSlotUnavailableError('That slot is no longer free'));
    mocks.slots.mockResolvedValue([slots[1]]);await processFunnelTick();
    expect(await thread(s.o)).toMatchObject({state:'awaiting_time',meeting_start:null,offered_slots:[slots[1]]});
    expect(mocks.send.mock.calls.at(-1)![0].body).toContain('previous time is no longer available');
    await processFunnelTick();expect(mocks.book).toHaveBeenCalledTimes(1);
  });
  it('queues one explicitly reviewed partial-search prospect without changing research or validating a contact',async()=>{
    vi.stubEnv('MVP_PROSPECT_DEMO_OUTREACH','on');vi.stubEnv('MVP_FUNNEL_WORKER','on');
    const s=await seed({old:true,approved:true,validated:false});await attachSource(s);
    await db.query("insert into research_sessions(run_id,state,budget) values($1,'partial','{}')",[s.run]);
    await setFunnelEnabled(true);expect(await enrollCompletedSearches()).toBe(0);
    expect(await reviewedProspectStatus(s.o)).toMatchObject({canStart:true,researchPaused:true});
    const [a,b]=await Promise.all([startReviewedProspectDemo(s.o),startReviewedProspectDemo(s.o)]);expect(a.id).toBe(b.id);
    expect((await db.query('select state from research_sessions where run_id=$1',[s.run])).rows[0].state).toBe('partial');
    expect((await db.query('select id from funnel_threads')).rows).toHaveLength(1);expect(mocks.send).not.toHaveBeenCalled();
    await processFunnelTick();expect(mocks.send).toHaveBeenCalledTimes(1);expect(mocks.fit).not.toHaveBeenCalled();expect(mocks.contact).not.toHaveBeenCalled();
    expect(await thread(s.o)).toMatchObject({mode:'prospect_demo',recipient:'deeptendukuri@gmail.com',person_id:null,state:'active'});
    expect((await db.query('select id from contact_points')).rows).toHaveLength(0);
  });
  it('requires enabled demo mode, worker, reviewed fit, real evidence and a settled search',async()=>{
    vi.stubEnv('MVP_FUNNEL_WORKER','on');const s=await seed({validated:false});await attachSource(s);
    await expect(startReviewedProspectDemo(s.o)).rejects.toThrow('Enable');
    await setFunnelEnabled(true);await expect(startReviewedProspectDemo(s.o)).rejects.toThrow('not configured');
    vi.stubEnv('MVP_PROSPECT_DEMO_OUTREACH','on');await expect(startReviewedProspectDemo(s.o)).rejects.toThrow('Confirm potential buyer');
    await db.query("update search_opportunities set qualification='approved' where id=$1",[s.o]);
    await db.query("update runs set status='running' where id=$1",[s.run]);await expect(startReviewedProspectDemo(s.o)).rejects.toThrow('Wait until research');
    await db.query("update runs set status='done' where id=$1",[s.run]);
    await db.query("update search_opportunities set evidence_ids='{}' where id=$1",[s.o]);await expect(startReviewedProspectDemo(s.o)).rejects.toThrow('original-source');
    vi.stubEnv('MVP_FUNNEL_WORKER','off');await expect(startReviewedProspectDemo(s.o)).rejects.toThrow('worker is off');
    expect((await db.query('select id from funnel_threads')).rows).toHaveLength(0);
  });
  it('blocks samples and inbox suppression without consuming providers',async()=>{
    vi.stubEnv('MVP_FUNNEL_WORKER','on');vi.stubEnv('MVP_PROSPECT_DEMO_OUTREACH','on');await setFunnelEnabled(true);
    const s=await seed({approved:true,sample:true});await attachSource(s);await expect(startReviewedProspectDemo(s.o)).rejects.toThrow('Sample');
    await db.query("insert into funnel_suppressions(recipient,reason) values('deeptendukuri@gmail.com','Unit opt-out')");await expect(startReviewedProspectDemo(s.o)).rejects.toThrow('opted out');
    expect(mocks.send).not.toHaveBeenCalled();expect(mocks.fit).not.toHaveBeenCalled();
  });
  it('enforces one prospect per search across concurrent reviewed selections regardless of score',async()=>{
    vi.stubEnv('MVP_FUNNEL_WORKER','on');vi.stubEnv('MVP_PROSPECT_DEMO_OUTREACH','on');vi.stubEnv('MVP_DEMO_PROSPECTS_PER_SEARCH','1');await setFunnelEnabled(true);
    const a=await seed({approved:true});const b=await seed({approved:true});await attachSource(a);await attachSource(b);
    await db.query('update search_opportunities set run_id=$2,fit_score=1 where id=$1',[b.o,a.run]);
    await db.query('insert into run_documents(run_id,document_id) select $1,document_id from run_documents where run_id=$2 on conflict do nothing',[a.run,b.run]);
    const outcomes=await Promise.allSettled([startReviewedProspectDemo(b.o),startReviewedProspectDemo(a.o)]);
    expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);expect((await db.query('select id from funnel_threads')).rows).toHaveLength(1);
    await enrollCompletedSearches();expect((await db.query('select id from funnel_threads')).rows).toHaveLength(1);
  });
  it('does not automatically replay searches completed while automation was paused',async()=>{
    await setFunnelEnabled(true);await db.query("update funnel_control set enabled_at=now()-interval '2 days'");await setFunnelEnabled(false);
    const old=await seed({old:true});await setFunnelEnabled(true);expect(await enrollCompletedSearches()).toBe(0);expect(await thread(old.o)).toBeUndefined();
  });
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
  it("keeps partial durable research visible but never enrolls it until completion",async()=>{
    await setFunnelEnabled(true);const s=await seed();
    await db.query("insert into research_sessions(run_id,state,budget) values($1,'partial','{}')",[s.run]);
    expect(await enrollCompletedSearches()).toBe(0);expect(mocks.send).not.toHaveBeenCalled();
    await db.query("update research_sessions set state='done' where run_id=$1",[s.run]);
    expect(await enrollCompletedSearches()).toBe(1);
  });
  it("automatically sends an explicitly labelled prospect demo without fabricating a validated buyer contact",async()=>{
    vi.stubEnv("MVP_PROSPECT_DEMO_OUTREACH","on");await setFunnelEnabled(true);const s=await seed({validated:false});await attachSource(s);
    await processFunnelTick();expect(await thread(s.o)).toMatchObject({mode:"prospect_demo",state:"active",person_id:null,recipient:"deeptendukuri@gmail.com"});
    expect(mocks.contact).not.toHaveBeenCalled();expect(mocks.fit).toHaveBeenCalledTimes(1);expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.initial.mock.calls[0][1]).toEqual({name:"Example Customer",title:"Demo customer representing Unit EPC"});
    expect(mocks.send.mock.calls[0][0].body).toContain("Demo customer: Example Customer. Seller: Deeptendu Kuri.");
    expect((await db.query("select verified_at from contact_points")).rows).toEqual([]);
    // Recipient and delivery mode are frozen: later toggles never turn this into buyer delivery.
    vi.stubEnv("MVP_PROSPECT_DEMO_OUTREACH","off");await replyTo(s.o,"Can we discuss specs?");mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});await processFunnelTick();
    expect(mocks.send).toHaveBeenCalledTimes(2);expect((await thread(s.o)).recipient).toBe("deeptendukuri@gmail.com");
  });
  it("caps prospect demos per search across repeated ticks and blocks revoked/source-less approval",async()=>{
    vi.stubEnv("MVP_PROSPECT_DEMO_OUTREACH","on");vi.stubEnv("MVP_DEMO_PROSPECTS_PER_SEARCH","1");await setFunnelEnabled(true);
    const a=await seed({validated:false});const b=await seed({validated:false});await attachSource(a);await attachSource(b);
    await db.query("update search_opportunities set run_id=$2,fit_score=50 where id=$1",[b.o,a.run]);
    await processFunnelTick();await processFunnelTick();expect((await db.query("select id from funnel_threads")).rows).toHaveLength(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await db.query("update search_opportunities set qualification='rejected' where id=$1",[a.o]);
    await replyTo(a.o,"Can you send specs?");mocks.send.mockResolvedValue({id:crypto.randomUUID(),rfcId:null});await processFunnelTick();
    expect(mocks.send).toHaveBeenCalledTimes(1);expect((await thread(a.o)).state).toBe("stopped");
    const c=await seed({approved:true,validated:false});await processFunnelTick();expect(await thread(c.o)).toBeUndefined();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("blocks uncertain product fit, missing named contact, revoked validation and unreadable inbox",async()=>{
    await setFunnelEnabled(true);const s=await seed();mocks.fit.mockResolvedValueOnce({approved:false,reason:"No exact product evidence"});
    await processFunnelTick();expect((await thread(s.o)).state).toBe("review");expect(mocks.send).not.toHaveBeenCalled();
    const b=await seed({approved:true,validated:false});await processFunnelTick();expect((await thread(b.o)).state).toBe("needs_contact");
    expect(mocks.send).not.toHaveBeenCalled();mocks.list.mockRejectedValueOnce(new Error("HTTP 401 receiving key"));
    await expect(processFunnelTick()).rejects.toThrow("HTTP 401");expect(mocks.send).not.toHaveBeenCalled();
  });
  it("continues to a valid lower-score prospect when the first ranked candidate fails fit checks",async()=>{
    vi.stubEnv("MVP_PROSPECT_DEMO_OUTREACH","on");vi.stubEnv("MVP_DEMO_PROSPECTS_PER_SEARCH","1");await setFunnelEnabled(true);
    const high=await seed({validated:false});const low=await seed({validated:false});await attachSource(high);await attachSource(low);
    await db.query("update search_opportunities set run_id=$2,fit_score=1 where id=$1",[low.o,high.run]);
    await db.query("insert into run_documents(run_id,document_id) select $1,document_id from run_documents where run_id=$2 on conflict do nothing",[high.run,low.run]);
    await db.query("update search_opportunities set fit_score=99 where id=$1",[high.o]);
    mocks.fit.mockResolvedValueOnce({approved:false,reason:"No valid product evidence"});
    await processFunnelTick();expect((await thread(high.o)).state).toBe("review");expect(mocks.send).not.toHaveBeenCalled();
    await processFunnelTick();expect((await thread(low.o)).state).toBe("active");expect(mocks.send).toHaveBeenCalledTimes(1);
    await processFunnelTick();expect(mocks.send).toHaveBeenCalledTimes(1);
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
    mocks.reply.mockRejectedValue(new Error('AI cannot classify exact slot selections'));
    await replyTo(s.o,"Please book slot 2");await processFunnelTick();expect((await thread(s.o)).state).toBe("meeting_pending");expect(mocks.reply).toHaveBeenCalledTimes(1);
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
    expect((await thread(s.o)).state).toBe("review");expect((await thread(s.o)).reason).toContain("Follow-up limit");
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
