// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {createResearchRun,addJob,claimJob,sessionFor} from '@/mvp/research/store';
import {processResearchTick,type ResearchDeps} from '@/mvp/research/engine';
import type {RawDoc} from '@/mvp/pipeline/contracts';
import fixtures from './fixtures/baseline-pages.json';
let db:Db;
const input={query:'line pipe',productId:'line-pipe',markets:['IN'],leadKinds:['supply_subcontract' as const],researchMode:'preview' as const};
beforeAll(async()=>{db=await createTestDb();},120000);afterAll(async()=>db.close());
beforeEach(async()=>{await db.exec('truncate runs cascade');vi.stubEnv('TAVILY_API_KEY','');vi.stubEnv('MVP_RESEARCH_NEWS','off');});
afterEach(()=>vi.unstubAllEnvs());
describe('WP2 admission before provider/page costs',()=>{
  it('never invokes the reader or reserves a read for IBISWorld, Wikipedia or Mordor',async()=>{
    const id=await createResearchRun(input,db);
    await db.query("update research_jobs set state='done' where run_id=$1",[id]);
    for(const domain of ['ibisworld.com','en.wikipedia.org','mordorintelligence.com'])await db.tx(tx=>addJob(tx,id,'read',domain,{raw:{url:`https://${domain}/pipeline`,title:'Example',text:null} as RawDoc}));
    const deps:ResearchDeps={collect:vi.fn(),read:vi.fn(),discover:vi.fn(),save:vi.fn()};
    for(let n=0;n<8&&(await sessionFor(db,id))?.state==='active';n++)await processResearchTick(db,deps,id);
    expect(deps.read).not.toHaveBeenCalled();expect(deps.discover).not.toHaveBeenCalled();
    expect((await db.query("select key from research_budget_reservations where run_id=$1 and kind='read'",[id])).rows).toHaveLength(0);
    expect((await db.query("select id from run_events where run_id=$1 and message like 'skipped:%'",[id])).rows).toHaveLength(3);
  });
  it('settles exhausted Bing/Tavily coverage without invoking search providers; public registries remain independent',async()=>{
    vi.stubEnv('TAVILY_API_KEY','fixture-key');vi.stubEnv('MVP_MAX_BING_QUERIES','0');vi.stubEnv('MVP_MAX_SEARCH_QUERIES','0');
    const id=await createResearchRun(input,db);
    const collect=vi.fn(async()=>[] as RawDoc[]);const deps:ResearchDeps={collect,read:vi.fn(),discover:vi.fn(),save:vi.fn()};
    for(let n=0;n<16&&(await sessionFor(db,id))?.state==='active';n++)await processResearchTick(db,deps,id);
    expect(collect).toHaveBeenCalledTimes(3);expect(collect.mock.calls.every(call=>(call as unknown[])[0]==='registry')).toBe(true);expect(deps.read).not.toHaveBeenCalled();
    expect((await sessionFor(db,id))?.state).toBe('done');
    expect((await sessionFor(db,id))?.stop_reason).toContain('budget');
    expect((await db.query('select status,error from runs where id=$1',[id])).rows[0]).toEqual({status:'done',error:null});
  });
  it('gives regular-buyer searches the same tier as contractor lists, after award news (doc 19)',async()=>{
    vi.stubEnv('TAVILY_API_KEY','fixture-key');const id=await createResearchRun(input,db);
    const first=await claimJob(db,id);expect(first?.payload.sourcingLane).toBe('trigger');
    const jobs=(await db.query<{priority:number;payload:{sourcingLane:string}}>("select priority,payload from research_jobs where run_id=$1 and stage='collect'",[id])).rows;
    const top=(lane:string)=>Math.max(...jobs.filter(j=>j.payload.sourcingLane===lane).map(j=>j.priority));
    expect(top('capability')).toBe(top('roundup')>=1950?1000:top('roundup')); // registry lists keep their own higher priority
    expect(top('capability')).toBeLessThan(top('trigger'));
    expect(jobs.filter(j=>j.payload.sourcingLane==='capability').every(j=>j.priority>0)).toBe(true);
  });
  it('finishes a real queued analysis at its AI ceiling without pausing the run',async()=>{
    vi.stubEnv('MVP_MAX_AI_DOCS','0');
    const id=await createResearchRun(input,db);
    const site=fixtures.documents.find(d=>d.url.includes('tekzoneme'))!;
    const raw:RawDoc={url:site.url,title:site.title,text:site.text,sourceKey:'saved-evaluation',sourceName:'Tekzone',tier:'B',publishedAt:null,isSample:false};
    const deps:ResearchDeps={collect:vi.fn(async()=>[raw]),read:vi.fn(),discover:vi.fn(),save:vi.fn(),discoverBundle:vi.fn()};
    for(let n=0;n<30&&(await sessionFor(db,id))?.state==='active';n++)await processResearchTick(db,deps,id);
    expect(deps.discoverBundle).not.toHaveBeenCalled();
    expect((await sessionFor(db,id))?.state).toBe('done');
    expect((await db.query("select id from research_jobs where run_id=$1 and state='paused'",[id])).rows).toHaveLength(0);
    expect((await db.query<{counters:{coverage:{reason:string}}}>('select counters from runs where id=$1',[id])).rows[0].counters.coverage.reason).toContain('budget');
  });
});
