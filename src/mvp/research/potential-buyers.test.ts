// @vitest-environment node
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import type {SearchBrief} from '@/mvp/discovery/brief';
import {checkNeed,judgeNeed,needPriorityScore,projectFollowKey,namesCompany} from './need';
import {registerNeedCandidates} from './need-candidates';
import {saveLikelyBuyers} from './likely';
import {claimJob,addJob,completeJob} from './store';
import {processResearchTick,type ResearchDeps} from './engine';
import {storeDocument} from '@/mvp/pipeline/read';
import type {RawDoc} from '@/mvp/pipeline/contracts';
import type {LLMProvider} from '@/mvp/llm';
import {researchBudget} from '@/mvp/discovery/plan';

const brief:SearchBrief={version:2,item:'Carbon steel process pipe',productId:'cs-process-pipe',source:'catalogue',mustHave:['ASTM A106'],buying:'both',
  uses:[{name:'chemical process plant',newsWords:['chemical plant','petrochemical'],countries:[],localWords:{},why:'Potential process piping'}],
  buyerRoles:[],notBuyers:[],owners:[],places:{IN:['India'],AE:['United Arab Emirates'],CA:['Canada']}};
const text='Example Process EPC Limited builds petrochemical process plants in India.';
const answer=(extra:Record<string,unknown>={})=>JSON.stringify({project:null,country:'India',date:null,use:null,needsItem:'unclear',needWhy:'The pipe material and grade are not specified.',
  companies:[{name:'Example Process EPC Limited',role:'epc',package:'petrochemical plant construction',quote:text,buysItem:'yes'}],...extra});
const provider:LLMProvider={name:'mock',model:'example',async complete(){return {text:answer(),tokensIn:1,tokensOut:1};}};

describe('evidence-first potential buyer admission and ranking',()=>{
  it('does not need a contract win, grade, value, date or contact for material-consuming work',()=>{
    const r=judgeNeed(answer(),{text,publishedAt:null},brief,['IN'])!;
    expect(r.companies[0]).toMatchObject({verdict:'lead',quoteVerified:true,applicationUse:'chemical process plant',since:null});
    expect(r.needsItem).toBe('yes');expect(r.needWhy).toContain('unconfirmed');
  });
  it.each([
    {extra:{needsItem:'no',needWhy:'The item is not suitable for this work.'},source:text},
    {extra:{country:'Canada'},source:text.replace('India','Canada')},
    {extra:{companies:[{name:'Example Process EPC Limited',role:'epc',package:'chemical plant construction',quote:'Example Process EPC Limited won work in India.'}]},source:text},
  ])('retains incompatible work, original quote and operating-country guards',({extra,source})=>{
    expect(judgeNeed(answer(extra),{text:source,publishedAt:null},brief,['IN'])!.companies[0].verdict).toBe('rejected');
  });
  it('recency and ongoing work rank potential buyers without needing a numeric rating threshold',()=>{
    const now=new Date('2026-10-11');
    expect(needPriorityScore('2026-09-01',true,false,now)).toBe(85);
    expect(needPriorityScore('2025-01-01',true,false,now)).toBe(80);
    expect(needPriorityScore(null,true,false,now)).toBe(75);
    expect(needPriorityScore(null,false,false,now)).toBe(65);
    expect(needPriorityScore('2023-01-01',true,true,now)).toBe(90);
  });
  it('does not spend another project-follow-up allowance for a reordered name, but keeps different phases',()=>{
    expect(projectFollowKey('LNG Canada Phase 2 Expansion')).toBe(projectFollowKey('Phase 2 of LNG Canada'));
    expect(projectFollowKey('LNG Canada Phase 1')).not.toBe(projectFollowKey('LNG Canada Phase 2'));
  });
  it('never assigns a parent company sentence to a geographic subsidiary',()=>{
    expect(namesCompany('Fluor Corporation won the LNG EPC contract.','Fluor Canada Ltd')).toBe(false);
    expect(namesCompany('Fluor Canada Ltd will execute the contract.','Fluor Canada Ltd')).toBe(true);
    expect(namesCompany('McDermott will construct the LNG plant.','McDermott International')).toBe(true);
  });
  it('describes the saved LNG Canada work from the original instead of a misnamed model application',()=>{
    // Literal paragraph captured in this rehearsal's stored Upstream page.
    const quote='Joint venture of Fluor and JGC Corporation awarded key contract for Phase 2 of LNG Canada by operator Shell';
    const b:SearchBrief={...brief,productId:'ss-duplex-pipe',uses:[{name:'oil & gas processing plant',newsWords:['LNG'],countries:[],localWords:{},why:'Potential process piping'},...brief.uses]};
    const raw=answer({country:'Canada',needsItem:'yes',use:'chemical process plant',companies:[{name:'Fluor',role:'jv_partner',package:'joint venture partner',quote,buysItem:'yes'}]});
    expect(judgeNeed(raw,{text:quote,publishedAt:'2026-10-02'},b,['CA'])!.companies[0])
      .toMatchObject({verdict:'lead',applicationUse:'oil & gas processing plant'});
  });
});

describe('durable buyer-first scheduling and persistence',()=>{
  let db:Db;
  beforeAll(async()=>{db=await createTestDb();},120_000);
  afterAll(async()=>{await db.close();});
  const run=async()=>{
    const input={query:'Carbon steel process pipe ASTM A106',productId:'cs-process-pipe',markets:['IN','CA','AE'],brief,leadKinds:['supply_subcontract' as const],extraRounds:0};
    const id=(await db.query<{id:string}>("insert into runs(status,adhoc_query) values('running',$1::jsonb) returning id",[JSON.stringify(input)])).rows[0].id;
    await db.query("insert into research_sessions(run_id,budget) values($1,$2::jsonb)",[id,JSON.stringify(researchBudget(input))]);
    return {id,input};
  };
  const raw=(market:string):RawDoc&{text:string}=>({url:`https://example.test/${market}`,title:'Example EPC work',text,sourceKey:'test',sourceName:'Example',tier:'C',market,publishedAt:null,isSample:false});
  it('checks another selected country before repeating the first country or enriching a saved project',async()=>{
    const {id}=await run();
    const first=await addJob(db,id,'analyse','Example India first',{kind:'analyse:work',raw:raw('IN')},1300);
    const claimed=await claimJob(db,id,first!);await completeJob(db,claimed!,{accepted:[]});
    await addJob(db,id,'analyse','Example India repeat',{kind:'analyse:award',raw:raw('IN')},1300);
    const canada=await addJob(db,id,'analyse','Example Canada first',{kind:'analyse:award',raw:raw('CA')},1300);
    await addJob(db,id,'analyse','Example optional details',{kind:'analyse:award-details'},200);
    await addJob(db,id,'read','Example UAE unread',{raw:raw('AE')},1250);
    expect((await claimJob(db,id))?.id).toBe(canada);
  });
  it('saves source-checked work even when an unrelated second rating disagrees, with zero contacts',async()=>{
    const {id,input}=await run();
    const d=await storeDocument(db,id,raw('IN'));
    const n=await checkNeed(db,id,d.id,{text,url:raw('IN').url,title:null,publishedAt:null},brief,['IN'],provider);
    await registerNeedCandidates(db,id,d.id,n.result);
    await db.query("update research_candidates set rating=10,rating_reason='Not this work: exact ASTM grade unspecified',rating_buyer_type='contractor' where run_id=$1",[id]);
    expect((await saveLikelyBuyers(db,id,input)).saved).toBe(1);
    expect((await db.query<{fit_score:number}>("select fit_score from search_opportunities where run_id=$1",[id])).rows[0].fit_score).toBe(65);
    expect((await db.query('select id from people')).rows).toHaveLength(0);
  });
  it('does not allow a later generic rating to turn a source-proven owner into a contractor lead',async()=>{
    const {id,input}=await run();
    const d=await storeDocument(db,id,raw('IN'));
    const n=await checkNeed(db,id,d.id,{text,url:raw('IN').url,title:null,publishedAt:null},brief,['IN'],provider,answer({needsItem:'yes',use:'chemical process plant',companies:[{name:'Example Process EPC Limited',role:'owner',package:'plant owner',quote:text}]}));
    const {registerCandidate}=await import('./investigation');
    await db.tx(tx=>registerCandidate(tx,id,'Example Process EPC Limited',null,d.id,text));
    expect(n.result!.companies[0].verdict).toBe('owner');
    await db.query("update research_candidates set rating=95,rating_reason='Looks like a contractor',rating_buyer_type='contractor' where run_id=$1",[id]);
    expect((await saveLikelyBuyers(db,id,input)).saved).toBe(0);
  });
  it('defers optional extraction after one need check, including a catalogue brief, and retains a paid-answer checkpoint',async()=>{
    vi.stubEnv('TAVILY_API_KEY','');
    try{
      const {id,input}=await run();
      const d=await storeDocument(db,id,raw('IN'));
      const job=await addJob(db,id,'analyse','Example first award',{kind:'analyse:award',documentId:d.id,raw:raw('IN')},1300);
      // Sentinel keeps finishIdleResearch from rating or finishing this proof.
      await addJob(db,id,'read','Example other country pending',{raw:raw('CA')},1250);
      const extraction=vi.fn();const need=vi.fn(provider.complete);
      const deps:ResearchDeps={collect:vi.fn(),read:vi.fn(),discover:vi.fn(),save:vi.fn(),extractAward:extraction,needProvider:{...provider,complete:need}};
      await processResearchTick(db,deps,id,job!);
      expect(need).toHaveBeenCalledOnce();expect(extraction).not.toHaveBeenCalled();
      const queued=(await db.query<{payload:{needAnswer:string};priority:number}>("select payload,priority from research_jobs where run_id=$1 and payload->>'kind'='analyse:award-details'",[id])).rows;
      expect(queued).toHaveLength(1);expect(queued[0].payload.needAnswer).toBe(answer());expect(queued[0].priority).toBe(200);
      expect((await db.query("select id from search_opportunities where run_id=$1",[id])).rows).toHaveLength(1);
      expect((await db.query<{result:{detailsDeferred:boolean}}>('select result from research_jobs where id=$1',[job])).rows[0].result.detailsDeferred).toBe(true);
      expect(input.brief.source).toBe('catalogue');
    }finally{vi.unstubAllEnvs();}
  });
});
