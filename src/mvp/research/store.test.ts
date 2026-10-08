// @vitest-environment node
import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createTestDb,type Db,assertSchemaReady} from '@/mvp/db';
import type {RunInput} from '@/mvp/types';
import {admitDeferredDiscovery,createResearchRun,claimJob,completeJob,reserveBudget,reserveAnalysis,enqueueRawDocs,replayCachedCompanyAnalyses,resumeResearchRun,sessionFor,researchProgress} from './store';
import {loadCompanyBundle} from '@/mvp/discovery/bundle';
import {registerCandidate} from './investigation';
import {researchBudget} from '@/mvp/discovery/plan';
import {finishIdleResearch,processResearchTick,type ResearchDeps} from './engine';
import {recordResendReceipt,dispatchResearchOutbox,processFunnelWake} from './transport';
import type {RawDoc} from '@/mvp/pipeline/contracts';
import {storeDocument} from '@/mvp/pipeline/read';
import {DISCOVERY_VERSION} from '@/mvp/discovery';
let db:Db;
const input:RunInput={query:'line pipe',productId:'line-pipe',markets:['IN'],leadKinds:['supply_subcontract']};
beforeAll(async()=>{db=await createTestDb();},120000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{vi.stubEnv('TAVILY_API_KEY','');await db.exec('truncate runs cascade;truncate provider_webhook_receipts;');});
afterEach(()=>vi.unstubAllEnvs());
const doc=(n:number):RawDoc & {text:string}=>({sourceKey:'test',sourceName:'Synthetic test',tier:'C',url:`https://example.com/services/${n}`,title:'Engineering contractor',publishedAt:null,text:'Atlas Engineering Limited performs pipeline construction and EPC contracting in India.',isSample:false});
describe('durable research checkpoints',()=>{
  it('projects lane counts and pending work from durable jobs without provider calls',async()=>{
    const id=await createResearchRun(input,db);
    await db.query("update research_jobs set state='done',result='{}' where run_id=$1",[id]);
    await db.query("insert into research_jobs(run_id,stage,key,state,payload,result) values($1,'analyse','Example-roundup','done',$2::jsonb,$3::jsonb)",[id,JSON.stringify({kind:'analyse:roundup'}),JSON.stringify({seeded:15})]);
    const counters=await researchProgress(db,id,'info','Example offline lane proof');
    expect(counters.sourcingLanes).toMatchObject({roundups:1,roundupCompanies:15,pending:0});
  });
  it('rejects mismatched material before persistence or provider work',async()=>{
    await expect(createResearchRun({...input,query:'power cables'},db)).rejects.toThrow();
    expect((await db.query('select id from runs')).rows).toHaveLength(0);
  });
  it('creates persisted run, tasks and outbox without a provider request',async()=>{
    const id=await createResearchRun(input,db);
    const jobs=(await db.query('select id from research_jobs where run_id=$1',[id])).rows;
    expect(jobs).toHaveLength(2); // two planned Bing headlines; Tavily is unconfigured
    expect((await db.query('select id from research_outbox where run_id=$1',[id])).rows).toHaveLength(jobs.length);
    expect((await sessionFor(db,id))?.state).toBe('active');
  });
  it('only one stage per run can claim; stale owner cannot commit',async()=>{
    const id=await createResearchRun(input,db);
    const claims=await Promise.all([claimJob(db,id),claimJob(db,id)]);const first=claims.find(Boolean)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    await db.query('update research_jobs set lease_until=now()-interval \'1 second\' where id=$1',[first.id]);
    const next=await claimJob(db,id,first.id);expect(next?.lease_token).not.toBe(first.lease_token);
    expect(await completeJob(db,first,{})).toBe(false);
    expect(await completeJob(db,next!,{})).toBe(true);
  });
  it('atomically caps requests and recognizes retries',async()=>{
    const id=await createResearchRun(input,db);
    const states=await Promise.all([reserveBudget(db,id,'search','a',1,1),reserveBudget(db,id,'search','b',1,1)]);
    expect(states.sort()).toEqual(['exhausted','reserved']);
    expect(await reserveBudget(db,id,'search','a',1,1)).toBe('existing');
  });
  it('reclaims unused query shares from saved URLs without new search requests or crossing reading caps',async()=>{
    vi.stubEnv('TAVILY_API_KEY','unit-key');
    const id=await createResearchRun({...input,researchMode:'batch'},db);
    const search=(await db.query<{id:string}>("select id from research_jobs where run_id=$1 and payload->>'source'='tavily' order by priority desc limit 1",[id])).rows[0];
    const job=(await claimJob(db,id,search.id))!;
    const rows=Array.from({length:20},(_,i)=>({...doc(i),url:`https://company${i}.example/services`,research:{lane:'company' as const}}));
    await enqueueRawDocs(db,job,rows,80);
    expect((await db.query("select id from research_jobs where run_id=$1 and stage='read'",[id])).rows).toHaveLength(6);
    expect(await admitDeferredDiscovery(db,id)).toBe(0); // other searches are unfinished
    await db.query("update research_jobs set state='done',result='{}',lease_token=null,lease_until=null where run_id=$1 and stage='collect' and id<>$2",[id,job.id]);
    expect(await admitDeferredDiscovery(db,id)).toBe(14);
    expect((await db.query("select id from research_jobs where run_id=$1 and stage='read'",[id])).rows).toHaveLength(20);
    expect(await admitDeferredDiscovery(db,id)).toBe(0);
    expect((await db.query<{result:{deferred:number}}>("select result from research_jobs where id=$1",[job.id])).rows[0].result.deferred).toBe(0);
    expect((await db.query("select key from research_budget_reservations where run_id=$1 and kind='search'",[id])).rows).toHaveLength(0);
  });
  it('token refusal does not consume an analysis page',async()=>{
    const id=await createResearchRun(input,db);const budget={...researchBudget(input),maxAiTokens:100};
    expect(await reserveAnalysis(db,id,'doc',200,budget)).toBe('exhausted');
    expect((await db.query('select key from research_budget_reservations where run_id=$1',[id])).rows).toHaveLength(0);
  });
  it('retains deferred source URLs and resumes without recollecting',async()=>{
    const id=await createResearchRun(input,db);const job=(await claimJob(db,id))!;
    await enqueueRawDocs(db,job,[doc(1),doc(2)],1);
    await db.query(`update research_sessions set state='partial' where run_id=$1`,[id]);
    await db.query(`update research_sessions set budget=jsonb_set(budget,'{maxPages}','1') where run_id=$1`,[id]);
    await resumeResearchRun(id,db);
    expect((await db.query('select id from research_jobs where run_id=$1 and stage=\'read\'',[id])).rows).toHaveLength(2);
    expect((await db.query('select state from research_jobs where id=$1',[job.id])).rows[0]).toEqual({state:'done'});
  });
  it('cancelled parents cannot be resurrected by old deliveries',async()=>{
    const id=await createResearchRun(input,db);await db.query('update runs set status=\'cancelled\' where id=$1',[id]);
    expect(await claimJob(db,id)).toBeNull();expect((await sessionFor(db,id))?.state).toBe('cancelled');
  });
  it('resume rechecks rejected cached extractions without requeuing completed searches',async()=>{
    const id=await createResearchRun(input,db);const source=(await claimJob(db,id))!;
    await completeJob(db,source,{});
    const d=await storeDocument(db,id,doc(9));
    const hash=(await db.query<{content_hash:string}>('select content_hash from source_documents where id=$1',[d.id])).rows[0].content_hash;
    await db.query("insert into buyer_discovery_cache(document_id,product_id,content_hash,version,result) values($1,'line-pipe',$2,$3,'{\"buyers\":[]}'::jsonb)",[d.id,hash,DISCOVERY_VERSION]);
    await db.query("insert into research_jobs(run_id,stage,key,state,payload,result) values($1,'analyse',$2,'done',$3::jsonb,'{\"invalid\":1,\"saved\":0}'::jsonb)",[id,d.id,JSON.stringify({documentId:d.id,raw:doc(9)})]);
    await db.query("update research_sessions set state='partial' where run_id=$1",[id]);
    await resumeResearchRun(id,db);
    expect((await db.query("select state from research_jobs where run_id=$1 and stage='analyse'",[id])).rows[0].state).toBe('queued');
    expect((await db.query('select state from research_jobs where id=$1',[source.id])).rows[0].state).toBe('done');
    expect((await db.query("select key from research_budget_reservations where run_id=$1 and kind='search'",[id])).rows).toEqual([]);
  });
  it('does not expand repeated resume past the cumulative deep ceiling',async()=>{
    const id=await createResearchRun(input,db);
    await db.query("update research_sessions set state='partial',budget=$2::jsonb where run_id=$1",[id,JSON.stringify(researchBudget({...input,researchMode:'deep'}))]);
    await expect(resumeResearchRun(id,db)).rejects.toThrow('Maximum cumulative');
    expect((await sessionFor(db,id))?.state).toBe('partial');
  });
  it('does not repeat failed paid analyses just because Resume was clicked',async()=>{
    const id=await createResearchRun(input,db);
    await db.query("insert into research_jobs(run_id,stage,key,state) values($1,'analyse','failed-response','failed')",[id]);
    await db.query("update research_sessions set state='partial' where run_id=$1",[id]);
    await expect(resumeResearchRun(id,db)).rejects.toThrow('provider/evidence review');
  });
  it('repairs a malformed optional field from the exact saved bundle without new searches, reads, AI or budget expansion',async()=>{
    const id=await createResearchRun(input,db);const before=(await sessionFor(db,id))!.budget;
    await db.query("update research_jobs set state='done',result='{}' where run_id=$1",[id]);
    const text='Atlas Engineering Limited constructs gas transmission pipelines using line pipe in India.';
    const raw={...doc(40),text};const d=await storeDocument(db,id,raw);
    await db.query('insert into run_documents(run_id,document_id) values($1,$2)',[id,d.id]);
    const c=await registerCandidate(db,id,'Atlas Engineering Limited','example.com',d.id,text);
    await db.query('update research_candidates set document_ids=$2::uuid[] where id=$1',[c.id,[d.id]]);
    const bundle=(await loadCompanyBundle(db,id,c.id))!;
    const response={buyers:[{company:c.company,role:'epc_contractor',country:'IN',companyQuote:text,countryQuote:text,productQuote:text,confidence:.2,operatingCountries:['IN']}]};
    await db.query('insert into research_bundle_cache(candidate_id,content_hash,product_id,version,result) values($1,$2,$3,$4,$5::jsonb)',[c.id,bundle.hash,input.productId,DISCOVERY_VERSION,JSON.stringify(response)]);
    const job=(await db.query<{id:string}>("insert into research_jobs(run_id,stage,key,state,payload) values($1,'analyse',$2,'failed',$3::jsonb) returning id",[id,'bundle:'+c.id,JSON.stringify({candidateId:c.id})])).rows[0];
    await db.query("insert into research_jobs(run_id,stage,key,state) values($1,'analyse','uncached-provider-failure','failed')",[id]);
    await db.query("update research_sessions set state='partial' where run_id=$1",[id]);await db.query("update runs set status='done' where id=$1",[id]);
    expect(await replayCachedCompanyAnalyses(id,db)).toBe(1);
    expect((await sessionFor(db,id))!.budget).toEqual(before);
    await processResearchTick(db,undefined,id,job.id);
    expect((await db.query('select state,result from research_jobs where id=$1',[job.id])).rows[0]).toMatchObject({state:'done',result:{cached:true,saved:1}});
    expect((await db.query('select key from research_budget_reservations where run_id=$1',[id])).rows).toEqual([]);
    expect((await db.query("select state from research_jobs where run_id=$1 and key='uncached-provider-failure'",[id])).rows[0].state).toBe('failed');
    await expect(replayCachedCompanyAnalyses(id,db)).rejects.toThrow('No compatible cached');
  });
  it('executes each persisted source/read/analysis once across worker instances',async()=>{
    const id=await createResearchRun(input,db);const collect=vi.fn(async(source:string)=>source==='bing-query'?[doc(1)]:[]);
    const sourceCount=(await db.query('select id from research_jobs where run_id=$1 and stage=\'collect\'',[id])).rows.length;
    const discover=vi.fn(async()=>({buyers:[],invalid:0,rejections:[],cached:false}));
    const deps:ResearchDeps={collect,read:vi.fn(),discover,save:vi.fn()};
    for(let i=0;i<100&&(await sessionFor(db,id))?.state==='active';i++)await processResearchTick(db,deps,id);
    expect((await sessionFor(db,id))?.state).toBe('done');expect(collect).toHaveBeenCalledTimes(sourceCount);expect(discover).toHaveBeenCalledTimes(1);
    await processResearchTick(db,deps,id);expect(discover).toHaveBeenCalledTimes(1);
    expect((await db.query<{counters:{itemsRead:number}}>('select counters from runs where id=$1',[id])).rows[0].counters.itemsRead).toBe(1);
  });
  it('fails all-source failure rather than completing a fictitious empty result',async()=>{
    const id=await createResearchRun(input,db);const deps:ResearchDeps={collect:vi.fn(async()=>{throw new Error('source failed');}),read:vi.fn(),discover:vi.fn(),save:vi.fn()};
    for(let i=0;i<100&&(await sessionFor(db,id))?.state==='active';i++)await processResearchTick(db,deps,id);
    expect((await sessionFor(db,id))?.state).toBe('failed');
  });
  it('settles reviewed work with parked jobs as partial, but never finishes future queued work',async()=>{
    const id=await createResearchRun(input,db);
    const first=(await db.query<{id:string}>('select id from research_jobs where run_id=$1 limit 1',[id])).rows[0];
    const original=await storeDocument(db,id,doc(32));
    await db.query("update research_jobs set state='done',result='{}' where run_id=$1",[id]);
    await db.query("insert into research_jobs(run_id,stage,key,state,result) values($1,'read','saved-original','done',$2::jsonb)",[id,JSON.stringify({documentId:original.id})]);
    const reason='AI analysis budget exhausted; saved pages and companies are retained.';
    await db.query("insert into research_jobs(run_id,stage,key,state,error) values($1,'analyse','parked-original','paused',$2)",[id,reason]);
    await db.query("update research_jobs set state='queued',available_at=now()+interval '1 hour' where id=$1",[first.id]);
    await finishIdleResearch(db,id);
    expect((await sessionFor(db,id))?.state).toBe('active');
    await db.query("update research_jobs set state='done' where id=$1",[first.id]);
    await finishIdleResearch(db,id);
    expect((await sessionFor(db,id))?.state).toBe('done');
    expect((await sessionFor(db,id))?.stop_reason).toBe(reason);
    const run=(await db.query<{status:string;counters:{researchState:string;coverageIncomplete:boolean}}>('select status,counters from runs where id=$1',[id])).rows[0];
    expect(run.status).toBe('done');expect(run.counters.researchState).toBe('done');expect(run.counters.coverageIncomplete).toBe(true);
    expect((await db.query('select key from research_budget_reservations where run_id=$1',[id])).rows).toHaveLength(0);
  });
  it('a settled GDELT rate limit is a coverage warning, not a partial-search barrier',async()=>{
    vi.stubEnv('MVP_RESEARCH_NEWS','on');
    const id=await createResearchRun(input,db);
    const deps:ResearchDeps={collect:vi.fn(async(source:string)=>{if(source==='gdelt')throw new Error('GDELT rate limit');return [];}),read:vi.fn(),discover:vi.fn(),save:vi.fn()};
    for(let i=0;i<100&&(await sessionFor(db,id))?.state==='active';i++)await processResearchTick(db,deps,id);
    expect((await sessionFor(db,id))?.state).toBe('done');
    expect((await db.query<{counters:{coverageIncomplete:boolean}}>('select counters from runs where id=$1',[id])).rows[0].counters.coverageIncomplete).toBe(true);
  });
  it('does not report directory-seed enqueue success as a completed search when every remote read fails',async()=>{
    vi.stubEnv('TAVILY_API_KEY','test-key');
    const id=await createResearchRun({...input,query:'power cables',productId:'cables',markets:['AE']},db);
    const deps:ResearchDeps={collect:vi.fn(async(source,_ctx,payload)=>{
      if(source==='directory-seed')return [payload.raw as RawDoc];
      throw new Error('Targeted web search could not connect; no automatic paid retry.');
    }),read:vi.fn(async()=>({ok:false as const,reason:'error' as const})),discover:vi.fn(),save:vi.fn()};
    for(let i=0;i<100&&(await sessionFor(db,id))?.state==='active';i++)await processResearchTick(db,deps,id);
    expect((await sessionFor(db,id))?.state).toBe('failed');
    expect((await db.query("select error from research_jobs where run_id=$1 and state='failed'",[id])).rows[0].error).toContain('could not connect');
    expect(deps.discover).not.toHaveBeenCalled();
  });
  it('checks schema readiness without applying a migration',async()=>{
    await assertSchemaReady(db);await expect(assertSchemaReady(db,['999_not_applied.sql'])).rejects.toThrow('Cloud schema');
  });
  it('deduplicates incoming event and queues a wake only once',async()=>{
    expect(await recordResendReceipt('evt1','email.received','message1',db)).toBe(true);
    expect(await recordResendReceipt('evt1','email.received','message1',db)).toBe(false);
    expect((await db.query('select id from research_outbox where kind=\'funnel\'')).rows).toHaveLength(1);
  });
  it('outbox publication freezes identity and retains pending work after failure',async()=>{
    await createResearchRun(input,db);vi.stubEnv('MVP_RESEARCH_TRANSPORT','qstash');vi.stubEnv('QSTASH_TOKEN','not-a-live-key');vi.stubEnv('APP_URL','https://example.com');
    const fetcher=vi.fn(async()=>new Response('{}',{status:503}));
    expect((await dispatchResearchOutbox(db,fetcher)).published).toBe(0);
    const entry=(await db.query<{state:string;attempts:number;error:string}>('select state,attempts,error from research_outbox where attempts=1')).rows[0];
    expect(entry.state).toBe('pending');expect(entry.error).not.toContain('not-a-live-key');
  });
  it('consumes a durable inbox wake only after successful reconciliation',async()=>{
    vi.stubEnv('MVP_FUNNEL_WORKER','on');await recordResendReceipt('wake1','email.received','message1',db);
    expect(await processFunnelWake(db,async()=>({processed:false}))).toEqual({processed:false});
    expect((await db.query('select processed_at from provider_webhook_receipts where event_id=\'wake1\'')).rows[0]).toEqual({processed_at:null});
    await db.query('update research_outbox set available_at=now() where kind=\'funnel\'');
    expect(await processFunnelWake(db,async()=>({processed:true,inbound:1}))).toEqual({processed:true});
    expect((await db.query('select processed_at from provider_webhook_receipts where event_id=\'wake1\'')).rows[0].processed_at).toBeTruthy();
  });
});
