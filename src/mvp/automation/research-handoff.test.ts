// @vitest-environment node
/** Real saved pages + captured model answers through persistence and the real
 * qualification/intro code. Only AI decisions and provider delivery are mocked;
 * a passing test is NOT evidence of live Gmail delivery. */
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createTestDb,setDbForTests,type Db} from '@/mvp/db';
import type {LLMProvider} from '@/mvp/llm';
import {catalogueBrief} from '@/mvp/discovery/brief';
import {storeDocument} from '@/mvp/pipeline/read';
import {checkNeed} from '@/mvp/research/need';
import {registerNeedCandidates} from '@/mvp/research/need-candidates';
import {saveLikelyBuyers} from '@/mvp/research/likely';
import {finishResearchNow,pauseResearchRun} from '@/mvp/research/control';
import {setFunnelEnabled} from './config';
import {enrollCompletedSearches,processFunnelTick} from './engine';
import pages from '@/mvp/research/fixtures/live-quality-pages.json';
import captured from '@/mvp/research/fixtures/captured-need-answers.json';

const mocks=vi.hoisted(()=>{
  vi.stubEnv('APPROVED_DEMO_RECIPIENT_EMAIL','hritikdebnath00@gmail.com');
  return {complete:vi.fn(),send:vi.fn(),contact:vi.fn(),list:vi.fn()};
});
vi.mock('@/mvp/llm',()=>({getLLM:()=>({name:'groq',model:'Example mocked qualification',complete:mocks.complete})}));
vi.mock('./contacts',()=>({prepareContact:mocks.contact}));
vi.mock('./resend',async original=>({...await original<typeof import('./resend')>(),listInboxPage:mocks.list,sendFunnelMessage:mocks.send}));
let db:Db;
const query='Stainless steel pipe ASTM A312 TP316L for process piping';
const input={query,productId:'ss-duplex-pipe',markets:['IN','CA','AE'],leadKinds:['supply_subcontract' as const],brief:catalogueBrief(query,['IN','CA','AE'],'ss-duplex-pipe')};

beforeAll(async()=>{
  db=await createTestDb();setDbForTests(db);
  for(const [key,value] of Object.entries({DEMO_EMAIL_ENABLED:'1',DEMO_RECIPIENT_EMAIL:'hritikdebnath00@gmail.com',
    RESEND_API_KEY:'Example mock key',RESEND_RECEIVING_DOMAIN:'example123.resend.app',GROQ_API_KEY:'Example mock key',
    EMAILABLE_API_KEY:'live_Example_offline_mock_key',MVP_PROSPECT_DEMO_OUTREACH:'on',MVP_DEMO_PROSPECTS_PER_SEARCH:'3',
    SALES_PERSON_NAME:'Deeptendu Kuri',DEMO_CUSTOMER_NAME:'Hritik Debnath',DEMO_EMAIL_FROM:'Example <onboarding@resend.dev>'}))vi.stubEnv(key,value);
  mocks.list.mockResolvedValue({data:[],has_more:false});
  mocks.contact.mockRejectedValue(new Error('Contact enrichment must not run in the approved-inbox demo.'));
  mocks.send.mockImplementation(async()=>({id:`Example accepted ${crypto.randomUUID()}`,rfcId:null}));
  mocks.complete.mockImplementation(async(request:{user:string})=>{
    const data=JSON.parse(request.user),id=data.productEvidenceIds[0];
    return {text:JSON.stringify({approved:true,confidence:.95,reason:'Example mocked potential-application approval, not an order.',companyEvidenceId:id,productEvidenceId:id}),tokensIn:0,tokensOut:0};
  });
  vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No HTTP permitted in this offline handoff test.'));
},120000);
afterAll(async()=>{setDbForTests(undefined);await db?.close();vi.restoreAllMocks();vi.unstubAllEnvs();});

describe('saved genuine company work to approved-inbox demo handoff',()=>{
  it('saves five source-backed potential buyers with zero contacts, waits for finish, sends three once',async()=>{
    await setFunnelEnabled(true);
    const run=(await db.query<{id:string}>("insert into runs(status,adhoc_query) values('running',$1::jsonb) returning id",[JSON.stringify(input)])).rows[0].id;
    await db.query("insert into research_sessions(run_id,state,budget) values($1,'active','{}')",[run]);
    const noProvider:LLMProvider={name:'mock',model:'Example no requests',complete:vi.fn(async()=>{throw new Error('Use captured answers only.');})};
    for(const saved of captured.answers){
      const page=pages.documents.find(p=>p.url.includes(saved.urlIncludes))!;
      const doc=await storeDocument(db,run,{...page,sourceKey:'captured-original',sourceName:'Captured original',tier:'B',isSample:false});
      await db.query('insert into run_documents(run_id,document_id) values($1,$2) on conflict do nothing',[run,doc.id]);
      const need=await checkNeed(db,run,doc.id,page,input.brief,input.markets,noProvider,JSON.stringify(saved.answer));
      await registerNeedCandidates(db,run,doc.id,need.result);
      await saveLikelyBuyers(db,run,input);
    }
    const buyers=(await db.query<{name:string;operating_country:string;activity_status:string;buying_reason:string;material_fit_kind:string;evidence_ids:string[]}>(
      'select c.canonical_name as name,o.* from search_opportunities o join companies c on c.id=o.company_id where run_id=$1 order by name',[run])).rows;
    expect(buyers.map(b=>b.name)).toEqual(['ENPPI','Fluor Corporation','JGC Corporation','Petrofac Emirates LLC','Petrojet']);
    expect(buyers.every(b=>b.material_fit_kind==='potential'&&b.buying_reason.includes('purchasing status are unconfirmed'))).toBe(true);
    expect(buyers.find(b=>b.name==='Fluor Corporation')?.activity_status).toBe('recent');
    expect(buyers.map(b=>[b.name,b.operating_country])).toEqual([
      ['ENPPI','AE'],['Fluor Corporation','CA'],['JGC Corporation','CA'],['Petrofac Emirates LLC','AE'],['Petrojet','AE'],
    ]);
    const evidence=(await db.query<{quote:string;text:string}>(`select e.quote,d.text from evidence e join source_documents d on d.id=e.document_id
      where e.id in(select unnest(evidence_ids) from search_opportunities where run_id=$1)`,[run])).rows;
    expect(evidence.length).toBeGreaterThanOrEqual(5);expect(evidence.every(e=>e.text.includes(e.quote))).toBe(true);
    expect(evidence.some(e=>e.quote.includes('LNG pre-conditioning plant (LPP)'))).toBe(true);
    expect((await db.query('select id from people')).rows).toHaveLength(0);
    expect((await db.query('select id from contact_points')).rows).toHaveLength(0);
    expect(await enrollCompletedSearches()).toBe(0);
    expect(await pauseResearchRun(db,run)).toBe(true);expect(await enrollCompletedSearches()).toBe(0);
    expect(mocks.send).not.toHaveBeenCalled();
    await db.query("update research_candidates set rating=case company when 'Fluor Corporation' then 95 when 'JGC Corporation' then 90 when 'ENPPI' then 85 else 75 end where run_id=$1",[run]);
    await db.query(`update search_opportunities o set fit_score=case c.canonical_name when 'Fluor Corporation' then 95 when 'JGC Corporation' then 90 when 'ENPPI' then 85 else 75 end
      from companies c where o.company_id=c.id and o.run_id=$1`,[run]);
    expect(await finishResearchNow(db,run)).toBe(true);
    expect(await enrollCompletedSearches()).toBe(3);
    for(let n=0;n<4;n++)await processFunnelTick();
    const threads=(await db.query<{state:string;reason:string;person_id:string|null;recipient:string;name:string}>(
      'select t.*,c.canonical_name as name from funnel_threads t join companies c on c.id=t.company_id order by name')).rows;
    expect(threads.map(t=>t.name),JSON.stringify(threads.map(t=>({name:t.name,state:t.state,reason:t.reason})))).toEqual(['ENPPI','Fluor Corporation','JGC Corporation']);
    expect(threads.map(t=>({state:t.state,reason:t.reason}))).toEqual(expect.arrayContaining([expect.objectContaining({state:'active'})]));
    expect(threads.every(t=>t.state==='active'&&t.person_id===null&&t.recipient==='hritikdebnath00@gmail.com')).toBe(true);
    expect(mocks.contact).not.toHaveBeenCalled();expect(noProvider.complete).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled(); // source-backed demo needs no second paid AI qualification
    expect(mocks.send).toHaveBeenCalledTimes(3);
    for(const [message] of mocks.send.mock.calls){
      expect(message.body).toContain('Hi Hritik Debnath');expect(message.body).toContain('Seller: Deeptendu Kuri');
      expect(message.body).not.toMatch(/I(?: am|'m) Hritik/i);
    }
    const messages=(await db.query<{state:string}>('select state from funnel_messages')).rows;
    expect(messages).toHaveLength(3);expect(messages.every(m=>m.state==='accepted')).toBe(true);
    expect(await enrollCompletedSearches()).toBe(0);await processFunnelTick();expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  },120000);
});
