// @vitest-environment node
import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import type {RunInput} from '@/mvp/types';
import type {RawDoc} from '@/mvp/pipeline/contracts';
import {storeDocument} from '@/mvp/pipeline/read';
import {MODE_BUDGETS,researchBudget} from '@/mvp/discovery/plan';
import {createResearchRun,reserveAnalysis,sessionFor} from './store';
import {registerCandidate} from './investigation';
import {finishIdleResearch} from './engine';
import {extendedBudget,retryAfterRateLimit,type ExtendableBudget} from './extend';
import {checkFoundCompany,listFoundCompanies} from './found';
import {sameStory} from '@/mvp/sourcing/story';

let db:Db;
const input:RunInput={query:'line pipe',productId:'line-pipe',markets:['IN'],leadKinds:['supply_subcontract']};
// Example synthetic source; no provider or network request is made in these tests.
const doc:RawDoc & {text:string}={sourceKey:'test',sourceName:'Example list',tier:'C',url:'https://example.com/top-pipeline-contractors',title:'Example top pipeline contractors',
  publishedAt:null,text:'Example Pipeline Builders Limited is a pipeline construction contractor in India.',isSample:false};
beforeAll(async()=>{db=await createTestDb();},120000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{vi.stubEnv('TAVILY_API_KEY','');vi.stubEnv('GROQ_API_KEY','');await db.exec('truncate runs cascade;');});
afterEach(()=>vi.unstubAllEnvs());

async function settledRun(skipped=true){
  const id=await createResearchRun(input,db);
  await db.query("update research_jobs set state='done',result='{}' where run_id=$1",[id]);
  if(skipped)await db.query(`insert into research_jobs(run_id,stage,key,state,payload,result) values($1,'analyse','Example-skipped','done','{}'::jsonb,$2::jsonb)`,
    [id,JSON.stringify({skipped:'AI analysis budget exhausted; saved pages and companies are retained.',budgetLimited:true})]);
  return id;
}

describe('keep researching until the minimum buyers are saved',()=>{
  it('adds the original budget once per round and never passes the deep ceiling or the AI allowance',()=>{
    const b=researchBudget({...input,researchMode:'batch'}) as ExtendableBudget;
    const one=extendedBudget(b);
    expect(one).toMatchObject({extensions:1,searchQueries:16,maxAiTokens:240_000,base:{searchQueries:8,maxAiTokens:120_000}});
    const two=extendedBudget(one);
    expect(two.maxAiTokens).toBe(MODE_BUDGETS.deep.maxAiTokens);
    expect(two.searchQueries).toBe(MODE_BUDGETS.deep.searchQueries);
    expect(extendedBudget(b,20_000).maxAiTokens).toBe(140_000);
  });

  it('re-queues work skipped at a limit instead of finishing with no buyers',async()=>{
    const id=await settledRun();
    const before=(await sessionFor(db,id))!.budget;
    await finishIdleResearch(db,id);
    const session=await sessionFor(db,id);
    expect(session?.state).toBe('active');
    expect((session!.budget as ExtendableBudget).extensions).toBe(1);
    expect(session!.budget.maxAiTokens).toBeGreaterThan(before.maxAiTokens);
    expect((await db.query("select state from research_jobs where run_id=$1 and key='Example-skipped'",[id])).rows[0]).toEqual({state:'queued'});
    const log=(await db.query<{message:string}>("select message from run_events where run_id=$1 order by id desc limit 1",[id])).rows[0].message;
    expect(log).toMatch(/searching further \(round 1 of 3\)/);
  });

  it('takes no extra round for a quick search (extraRounds 0)',async()=>{
    const id=await settledRun();
    await db.query(`update research_sessions set budget=budget||'{"extraRounds":0}'::jsonb where run_id=$1`,[id]);
    await finishIdleResearch(db,id);
    expect((await sessionFor(db,id))?.state).not.toBe('active');
    const log=(await db.query<{message:string}>("select message from run_events where run_id=$1 and message like 'Quick search%'",[id])).rows;
    expect(log).toHaveLength(1);
    expect(researchBudget({...input,extraRounds:0}).extraRounds).toBe(0);
    expect('extraRounds' in researchBudget(input)).toBe(false);
  });

  it('finishes normally when nothing was skipped, the rounds are used up or extension is off',async()=>{
    const none=await settledRun(false);await finishIdleResearch(db,none);
    expect((await sessionFor(db,none))?.state).toBe('done');
    const used=await settledRun();
    await db.query(`update research_sessions set budget=budget||'{"extensions":3}'::jsonb where run_id=$1`,[used]);
    await finishIdleResearch(db,used);expect((await sessionFor(db,used))?.state).toBe('done');
    vi.stubEnv('MVP_MIN_BUYERS','0');
    const off=await settledRun();await finishIdleResearch(db,off);
    expect((await sessionFor(db,off))?.state).toBe('done');
  });

  it('keeps part of the daily AI allowance for email replies',async()=>{
    vi.stubEnv('GROQ_API_KEY','Example-test-only');vi.stubEnv('LLM_DAILY_TOKEN_BUDGET__GROQ','40000');
    const id=await settledRun();
    await finishIdleResearch(db,id);
    expect((await sessionFor(db,id))?.state).toBe('done');
    const log=(await db.query<{message:string}>("select message from run_events where run_id=$1 and message like '%kept for email%'",[id])).rows;
    expect(log).toHaveLength(1);
  });

  it('retries a per-minute rate limit later and releases its uncharged reservation',async()=>{
    const id=await createResearchRun(input,db);
    const job=(await db.query<{id:string}>(`insert into research_jobs(run_id,stage,key,state,payload,lease_token,lease_until) values($1,'analyse','award:Example',
      'running',$2::jsonb,'00000000-0000-4000-8000-000000000001',now()+interval '5 minutes') returning id`,[id,JSON.stringify({documentId:'Example'})])).rows[0];
    expect(await reserveAnalysis(db,id,'award:Example:extract_a:model:extract',1000,(await sessionFor(db,id))!.budget)).toBe('reserved');
    await retryAfterRateLimit(db,{id:job.id,run_id:id,lease_token:'00000000-0000-4000-8000-000000000001',payload:{documentId:'Example'}},70);
    const row=(await db.query<{state:string;later:boolean}>("select state,available_at>now()+interval '60 seconds' as later from research_jobs where id=$1",[job.id])).rows[0];
    expect(row).toEqual({state:'queued',later:true});
    expect((await db.query("select key from research_budget_reservations where run_id=$1 and key like 'award:Example:%'",[id])).rows).toHaveLength(0);
  });
});

describe('companies found by a search',()=>{
  it('lists a named company with empty details and lets the user check it',async()=>{
    const id=await settledRun(false);
    const d=await storeDocument(db,id,doc);
    const c=await registerCandidate(db,id,'Example Pipeline Builders Limited',null,d.id,doc.text);
    await db.query("update research_candidates set state='review',reason='Named in a verified roundup; official website not established. Contacts and buying activity remain unconfirmed.' where id=$1",[c.id]);
    await finishIdleResearch(db,id);
    const [found]=await listFoundCompanies(db,id);
    // Doc 19: its listed work (pipeline construction) is quoted evidence, so it is saved as a lead at once;
    // a website check can still upgrade it.
    expect(found).toMatchObject({name:'Example Pipeline Builders Limited',website:null,status:'saved',statusText:'Lead · its listed work',verification:'listing',source:{url:doc.url}});
    expect(found.opportunityId).not.toBeNull();
    const result=await checkFoundCompany(db,id,c.id);
    expect(result.queued).toBe(true);
    expect((await sessionFor(db,id))?.state).toBe('active');
    expect((await db.query<{status:string}>('select status from runs where id=$1',[id])).rows[0].status).toBe('running');
    expect((await db.query("select stage,state from research_jobs where run_id=$1 and key=$2",[id,`official:${c.id}`])).rows).toEqual([{stage:'collect',state:'queued'}]);
    expect((await listFoundCompanies(db,id))[0].status).toBe('checking');
  });

  it('re-reads companies parked by a reading limit during an extension round',async()=>{
    const id=await settledRun();
    const d=await storeDocument(db,id,doc);
    const c=await registerCandidate(db,id,'Example Pipeline Builders Limited','example-builders.com',d.id,doc.text);
    await db.query("update research_candidates set state='review',reason='Company investigation deferred by the shared reading budget.' where id=$1",[c.id]);
    await finishIdleResearch(db,id);
    expect((await db.query("select state from research_jobs where run_id=$1 and key='https://example-builders.com/'",[id])).rows).toEqual([{state:'queued'}]);
    expect((await db.query<{state:string}>('select state from research_candidates where id=$1',[c.id])).rows[0].state).toBe('investigating');
  });
});

describe('repeat news stories',()=>{
  it('recognises other outlets reporting the same contract, not a different company',()=>{
    expect(sameStory('KPIL bags ₹4,000 crore UAE gas pipeline EPC contract; stock slips','KPIL wins over ₹4,000 crore gas pipeline EPC order in UAE')).toBe(true);
    expect(sameStory('Example Alpha wins UAE gas pipeline EPC contract','Example Beta wins UAE gas pipeline EPC contract')).toBe(false);
    expect(sameStory('Example Alpha wins ₹500 crore order','Example Gamma wins ₹500 crore order')).toBe(false);
    expect(sameStory('KPIL wins ₹4,000 crore UAE order','KPIL wins ₹1,200 crore India order')).toBe(false);
    expect(sameStory(null,'KPIL wins order')).toBe(false);
  });
});

describe('switched-off limits',()=>{
  it('never re-runs work whose limit is set to 0',async()=>{
    vi.stubEnv('MVP_MAX_AI_DOCS','0');
    const id=await settledRun();
    await finishIdleResearch(db,id);
    expect((await sessionFor(db,id))?.state).toBe('done');
    expect((await db.query("select state from research_jobs where run_id=$1 and key='Example-skipped'",[id])).rows[0]).toEqual({state:'done'});
  });
});

describe('found-company relevance',()=>{
  // Source lines as they appeared beside a live pipe-order article and in contractor lists.
  it('keeps work-related companies and folds away page furniture',async()=>{
    const {relevantFound}=await import('./found');
    expect(relevantFound('Engineers India Limited','Pipeline project experience across India',null,false)).toBe(true);
    expect(relevantFound('GAIL','1800 km HBJ Gas Pipeline and its rehabilitation project for GAIL, India',null,false)).toBe(true);
    expect(relevantFound('Tata Projects','For over 45 years, Tata has completed landmark builds',null,false)).toBe(true);
    expect(relevantFound('Kotak Neo','This article is for informational purposes only and should not be considered investment advice from Kotak Neo.',null,false)).toBe(false);
    expect(relevantFound('Bloomberg','according to Bloomberg data',null,false)).toBe(false);
    expect(relevantFound('Example Wealth','Example Wealth Q2 results today: share price falls, interim dividend in focus',null,false)).toBe(false);
    expect(relevantFound('Example Technologies Private Limited','Example Technologies Private Limited','internshala.com',false)).toBe(false);
    expect(relevantFound('कंपनी अधिनियम','कंपनी अधिनियम, 2013',null,false)).toBe(false);
    expect(relevantFound('Example Pipeline Builders Limited',null,null,true)).toBe(true);
  });
});

describe('AI rate limits during research',()=>{
  async function failingAnalysis(message:string){
    const {processResearchTick}=await import('./engine');
    const {LLMHttpError}=await import('@/mvp/llm/types');
    const id=await settledRun(false);
    const d=await storeDocument(db,id,doc);
    await db.query("insert into research_jobs(run_id,stage,key,state,payload,priority) values($1,'analyse',$2,'queued',$3::jsonb,100)",[id,d.id,JSON.stringify({documentId:d.id,raw:doc})]);
    const deps={collect:vi.fn(),read:vi.fn(),save:vi.fn(),discover:vi.fn(async()=>{throw new LLMHttpError('groq',429,message);})};
    await processResearchTick(db,deps as never,id);
    return (await db.query<{state:string;later:boolean}>("select state,available_at>now()+interval '60 seconds' as later from research_jobs where run_id=$1 and key=$2",[id,d.id])).rows[0];
  }
  it('waits and retries a per-minute limit',async()=>{
    expect(await failingAnalysis('groq 429: Rate limit reached on tokens per minute (TPM)')).toEqual({state:'queued',later:true});
  });
  it('still stops on a per-day limit',async()=>{
    expect((await failingAnalysis('groq 429: Rate limit reached on tokens per day (TPD)')).state).toBe('paused');
  });
});

describe('found-company role hints and duplicates',()=>{
  it('reads a likely role from the source wording, and leaves unknown roles empty',async()=>{
    const {likelyRole}=await import('./found');
    expect(likelyRole('Example Gas Company','2000 km natural gas pipeline project for Example Gas Company, India')).toBe('owner');
    expect(likelyRole('Example Refining Company (Exref)','Inter-refineries pipeline project for Example Refining Company (Exref), Abu Dhabi')).toBe('owner');
    expect(likelyRole('Example Energy','signed a major pipeline contract with Example Energy valued at over SAR 771 million')).toBe('owner');
    expect(likelyRole('Example Pipes Integrated Company',null)).toBe('pipe_maker');
    expect(likelyRole('Example Corp','its subsidiary bagged its largest-ever HFIW pipe order worth ₹4,000 crore')).toBe('pipe_maker');
    expect(likelyRole('Example Builders','one of the largest construction companies in the country')).toBe('contractor');
    expect(likelyRole('Example Group','a major player in highways and airports')).toBeNull();
  });
  it('merges a name repeated with its city',async()=>{
    const id=await settledRun(false);
    const d=await storeDocument(db,id,doc);
    await registerCandidate(db,id,'Example Gas',null,d.id,'Pipeline network project for Example Gas');
    await registerCandidate(db,id,'Example Gas, Abu Dhabi',null,d.id,'Gas pipeline project for Example Gas, Abu Dhabi');
    expect((await listFoundCompanies(db,id)).map(c=>c.name)).toEqual(['Example Gas']);
  });
});

describe('official website lookup for listed companies',()=>{
  it('accepts only a domain carrying the company name, initials or ampersand form',async()=>{
    const {officialSite}=await import('@/mvp/sourcing/roundup');
    const r=(...urls:string[])=>urls.map(url=>({url}));
    expect(officialSite('Example & Partners Limited',r('https://www.globaldata.com/company-profile/example','https://www.examplepartners.com/'))?.url).toBe('https://www.examplepartners.com/');
    expect(officialSite('Larsen & Toubro Limited',r('https://www.zoominfo.com/c/lt','https://www.lntecc.com/'))?.url).toBe('https://www.lntecc.com/');
    expect(officialSite('Hindustan Example Company',r('https://hecindia.com/'))?.url).toBe('https://hecindia.com/');
    expect(officialSite('Example Gas',r('https://www.globaldata.com/example-gas','https://en.wikipedia.org/wiki/Example_Gas'))).toBeUndefined();
    expect(officialSite('Example Gas',r('https://news.othersite.com/example'))).toBeUndefined();
  });
  it('drops an already-read wrong website and searches again on a second Check now',async()=>{
    const id=await settledRun(false);
    const d=await storeDocument(db,id,doc);
    const c=await registerCandidate(db,id,'Example Pipeline Builders Limited','profile-site.example',d.id,doc.text);
    await db.query("insert into research_jobs(run_id,stage,key,state,payload,result) values($1,'read','https://profile-site.example/','done','{}'::jsonb,'{\"documentId\":null}'::jsonb)",[id]);
    await db.query("update research_candidates set state='investigating' where id=$1",[c.id]);
    expect((await listFoundCompanies(db,id))[0].statusText).toBe('Website checked · no company page');
    expect((await checkFoundCompany(db,id,c.id)).queued).toBe(true);
    expect((await db.query<{domain_hint:string|null}>('select domain_hint from research_candidates where id=$1',[c.id])).rows[0].domain_hint).toBeNull();
    expect((await db.query("select state from research_jobs where run_id=$1 and key=$2",[id,`official:${c.id}`])).rows).toEqual([{state:'queued'}]);
  });
});

describe('found-company list quality from the live UAE run',()=>{
  it('folds away headlines, trackers and industry bodies but keeps long real company names',async()=>{
    const {relevantFound}=await import('./found');
    expect(relevantFound('Example Arabia and Egypt Drive Record Hotel Construction Activity Across the Middle East',null,null,false)).toBe(false);
    expect(relevantFound('Example Drydocks Secures A $300M Vessel Construction',null,null,false)).toBe(false);
    expect(relevantFound('UAE Construction Companies Overview',null,null,false)).toBe(false);
    expect(relevantFound('Example Energy Monitor',null,null,false)).toBe(false);
    expect(relevantFound('Constructing Excellence',null,null,false)).toBe(false);
    expect(relevantFound('EXAMPLE Mechanical Contractor & Manufacturer for OIL & GAS Onshore & Offshore',null,null,false)).toBe(true);
    expect(relevantFound('Consolidated Example Contractors Company','an EPC contractor',null,false)).toBe(true);
  });
  it('treats a bracketed short form as part of the same company',async()=>{
    const {candidatePageIdentity}=await import('./investigation');
    const c={id:'x',key:'x',company:'Example Projects International Ltd (EPIL)',domain_hint:null,identity_document_id:null,identity_quote:null,document_ids:[],state:'investigating'};
    expect(candidatePageIdentity(c,'Welcome to Example Projects International Limited, an EPC company.')).toBe(true);
    const id=await settledRun(false);
    const d=await storeDocument(db,id,doc);
    await registerCandidate(db,id,'Example Projects International Ltd (EPIL)',null,d.id,'Example Projects International Ltd (EPIL) secured a pipeline EPC contract');
    await registerCandidate(db,id,'Example Projects International Limited',null,d.id,'Example Projects International Limited pipeline work');
    expect(await listFoundCompanies(db,id)).toHaveLength(1);
  });
});
