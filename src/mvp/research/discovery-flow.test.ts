// @vitest-environment node
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {createResearchRun,sessionFor} from './store';
import {processResearchTick,type ResearchDeps} from './engine';
import {saveBuyer} from '@/mvp/discovery';
import type {RawDoc} from '@/mvp/pipeline/contracts';
let db:Db;beforeAll(async()=>{db=await createTestDb();},120000);afterAll(async()=>db.close());afterEach(()=>vi.unstubAllEnvs());
describe('durable discovery-only integration',()=>{
  it('saves first-party consuming capabilities without spending an AI slot or inventing contacts',async()=>{
    vi.stubEnv('TAVILY_API_KEY','');vi.stubEnv('MVP_RESEARCH_NEWS','off');
    const input={query:'Power and control cables',productId:'cables',markets:['IN'],leadKinds:['supply_subcontract' as const],researchMode:'batch' as const};
    const id=await createResearchRun(input,db);
    const originals=Array.from({length:3},(_,i)=>({sourceKey:'offline-test-only',sourceName:'Synthetic fixtures',tier:'B' as const,
      url:`https://rule-fixture${i}.example/`,title:`Rule Fixture ${i} Electrical LLC`,publishedAt:null,isSample:false,
      text:`Rule Fixture ${i} Electrical LLC\nOur services include installation of power cables and electrical distribution systems.`}));
    const deps:ResearchDeps={collect:vi.fn(async()=>originals as RawDoc[]),read:vi.fn(),discover:vi.fn(),save:saveBuyer};
    for(let tick=0;tick<80&&(await sessionFor(db,id))?.state==='active';tick++)await processResearchTick(db,deps,id);
    expect((await db.query('select id from search_opportunities where run_id=$1',[id])).rows).toHaveLength(3);
    expect((await db.query("select key from research_budget_reservations where run_id=$1 and kind='ai_pages'",[id])).rows).toHaveLength(0);
    expect((await db.query("select distinct extracted_by from evidence where document_id in (select document_id from run_documents where run_id=$1)",[id])).rows).toEqual([{extracted_by:'rule:company-application'}]);
    expect(deps.discover).not.toHaveBeenCalled();expect((await db.query('select id from contact_points')).rows).toHaveLength(0);
    expect((await db.query('select id from funnel_threads')).rows).toHaveLength(0);
  });
  it('saves several companies with blank optional details, dedupes source repeats and has no outreach side effects',async()=>{
    vi.stubEnv('TAVILY_API_KEY','');vi.stubEnv('MVP_RESEARCH_NEWS','off');
    const input={query:'Power and control cables',productId:'cables',markets:['IN'],leadKinds:['supply_subcontract' as const],researchMode:'batch' as const};
    const id=await createResearchRun(input,db);
    const originals=Array.from({length:3},(_,i)=>{
      const name=`Fixture ${i} Electrical Contracting LLC`;
      const text=`${name} is a specialist electrical engineering contractor.\nWe install power cables and electrical distribution systems.`;
      return {sourceKey:'offline-test-only',sourceName:'Synthetic fixtures',tier:'B' as const,url:`https://fixture${i}.example/`,title:name,text,publishedAt:null,isSample:false};
    });
    const bundles=vi.fn(async(_db,_run,_input,bundle:Parameters<NonNullable<ResearchDeps['discoverBundle']>>[3])=>({
      buyers:[{company:bundle.candidate.company,country:null,role:'subcontractor' as const,companyQuote:bundle.documents[0].text.split('\n')[0],
        productQuote:'We install power cables and electrical distribution systems.',countryQuote:null,confidence:0,project:null,projectQuote:null}],cached:false,invalid:0,rejections:[],
    }));
    const deps:ResearchDeps={collect:vi.fn(async()=>originals as RawDoc[]),read:vi.fn(),discover:vi.fn(),discoverBundle:bundles,save:saveBuyer};
    for(let tick=0;tick<80&&(await sessionFor(db,id))?.state==='active';tick++)await processResearchTick(db,deps,id);
    expect((await sessionFor(db,id))?.state).toBe('done');expect(bundles).toHaveBeenCalledTimes(3);
    const saved=(await db.query<{product_id:string;project_id:string|null;country:string|null}>('select o.product_id,l.project_id,c.country from search_opportunities o join companies c on c.id=o.company_id join leads l on l.id=o.lead_id where o.run_id=$1',[id])).rows;
    expect(saved).toHaveLength(3);expect(saved.every(r=>r.product_id==='cables'&&r.country===null)).toBe(true);
    expect((await db.query('select id from funnel_threads')).rows).toEqual([]);
    expect((await db.query('select id from funnel_messages')).rows).toEqual([]);
    expect(deps.read).not.toHaveBeenCalled();expect(deps.discover).not.toHaveBeenCalled();
  });
});
