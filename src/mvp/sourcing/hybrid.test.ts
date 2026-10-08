// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type Db } from '@/mvp/db';
import type { RunInput } from '@/mvp/types';
import type { RawDoc } from '@/mvp/pipeline/contracts';
import type { Trigger } from '@/mvp/buyers/types';
import { extractDocument } from '@/mvp/pipeline/extract';
import { saveBuyer } from '@/mvp/discovery';
import { attachStoredHybridRun, createResearchRun, reserveAnalysis, sessionFor } from '@/mvp/research/store';
import { processResearchTick, type ResearchDeps } from '@/mvp/research/engine';
import { researchBudget } from '@/mvp/discovery/plan';
import { awardTriggerSnapshots, budgetedAwardProviders, needsAwardAnalysis } from './hybrid';
import fixtures from './fixtures/baseline-pages.json';

let db:Db;
const input:RunInput={query:'line pipe',productId:'line-pipe',markets:['AE','IN'],leadKinds:['supply_subcontract'],researchMode:'batch'};
const article=fixtures.documents.find(d=>d.url.includes('businessline'))!;
const site=fixtures.documents.find(d=>d.url.includes('tekzoneme'))!;
const raw=(page:typeof site):RawDoc=>({sourceKey:'saved-evaluation',sourceName:new URL(page.url).hostname,tier:'B',
  url:page.url,title:page.title,text:page.text,publishedAt:null,isSample:false});
beforeAll(async()=>{db=await createTestDb();},120000);
afterAll(async()=>db.close());
beforeEach(async()=>{
  vi.stubEnv('TAVILY_API_KEY','');vi.stubEnv('GROQ_API_KEY','');vi.stubEnv('CLOUDFLARE_API_TOKEN','');vi.stubEnv('MVP_RESEARCH_NEWS','off');
  await db.exec('truncate runs,source_documents,companies cascade');
});
afterEach(()=>vi.unstubAllEnvs());
async function settle(id:string,deps:ResearchDeps){
  for(let tick=0;tick<150&&(await sessionFor(db,id))?.state==='active';tick++)await processResearchTick(db,deps,id);
  expect((await sessionFor(db,id))?.state).toBe('done');
}
describe('WP1 hybrid durable run',()=>{
  it('one award article and one company site produce separate award/capability triggers in the same run',async()=>{
    const id=await createResearchRun(input,db);
    const award=vi.fn(extractDocument);
    const deps:ResearchDeps={collect:vi.fn(async()=>[raw(article),raw(site)]),read:vi.fn(),discover:vi.fn(),save:saveBuyer,extractAward:award};
    await settle(id,deps);
    expect(award).toHaveBeenCalledTimes(1);
    expect(award.mock.calls[0][1]).toMatchObject({runId:id,singleAttempt:true});
    const jobs=(await db.query<{payload:{kind?:string};result:{triggers?:Trigger[]}}>("select payload,result from research_jobs where run_id=$1 and stage='analyse' and state='done'",[id])).rows;
    const awardTrigger=jobs.find(j=>j.payload.kind==='analyse:award')?.result.triggers?.find(t=>t.kind==='award');
    const capability=jobs.flatMap(j=>j.result.triggers??[]).find(t=>t.kind==='capability');
    expect(awardTrigger).toBeDefined();expect(capability).toBeDefined();
    expect(awardTrigger?.date).toBe('2026-09-28');expect(capability?.date).toBeNull();
    const awardCompany=(await db.query<{name:string}>('select c.canonical_name as name from companies c join project_parties pp on pp.company_id=c.id where pp.id=$1',[awardTrigger!.id])).rows[0].name;
    const capabilityCompany=(await db.query<{name:string}>('select c.canonical_name as name from companies c join search_opportunities o on o.company_id=c.id where o.id=$1',[capability!.id])).rows[0].name;
    expect(awardCompany).toMatch(/Kalpataru|KPIL/);expect(capabilityCompany).toMatch(/Tekzone/i);
    expect(awardCompany).not.toBe(capabilityCompany);
    expect((await db.query('select id from runs')).rows).toHaveLength(1);
    expect((await db.query('select distinct run_id from run_events')).rows).toEqual([{run_id:id}]);
    expect((await db.query('select id from funnel_threads')).rows).toHaveLength(0);
    expect((await db.query('select id from contact_points')).rows).toHaveLength(0);
    expect(deps.read).not.toHaveBeenCalled();
  });
  it('stored-page continuation keeps the run and does not recollect or call a live provider',async()=>{
    const id=(await db.query<{id:string}>("insert into runs(adhoc_query,status) values($1::jsonb,'running') returning id",[JSON.stringify(input)])).rows[0].id;
    await attachStoredHybridRun(id,input,[raw(article),raw(site)],db);
    const collect=vi.fn();const deps:ResearchDeps={collect,read:vi.fn(),discover:vi.fn(),save:saveBuyer};
    await settle(id,deps);
    expect(collect).not.toHaveBeenCalled();
    expect((await db.query("select id from research_jobs where run_id=$1 and payload->>'kind'='analyse:award'",[id])).rows).toHaveLength(1);
  });
  it('award passes and capability analysis cannot each obtain a separate AI budget',async()=>{
    const id=await createResearchRun(input,db);
    const budget={...researchBudget(input),maxAiPages:1};
    expect(await reserveAnalysis(db,id,'capability-page',100,budget)).toBe('reserved');
    const complete=vi.fn();
    const providers=budgetedAwardProviders(db,id,article.documentId,budget,()=>({name:'groq',model:'fixture-mocked',complete}));
    await expect(providers.provider('extract_a').complete({system:'Extract',user:article.text,purpose:'extract_P1'})).rejects.toThrow('Shared research AI budget');
    expect(complete).not.toHaveBeenCalled();expect(providers.limited).toBe(true);
    expect((await db.query("select key from research_budget_reservations where run_id=$1 and kind='ai_pages'",[id])).rows).toHaveLength(1);
  });
  it('reserves each real pass once and refuses an uncertain retry',async()=>{
    const id=await createResearchRun(input,db);
    const complete=vi.fn(async()=>({text:'{}',tokensIn:12,tokensOut:2}));
    const providers=budgetedAwardProviders(db,id,article.documentId,researchBudget(input),()=>({name:'groq',model:'fixture-mocked',complete}));
    const provider=providers.provider('extract_a');const request={system:'Extract',user:article.text,purpose:'extract_P1',maxTokens:100};
    await provider.complete(request);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({runId:id,singleAttempt:true}));
    await expect(provider.complete(request)).rejects.toThrow('no repeated paid call');expect(complete).toHaveBeenCalledTimes(1);
  });
  it('never accepts a quote merely because the database boolean says verified',async()=>{
    const id=await createResearchRun(input,db);
    await attachStoredHybridRun(id,input,[raw(article)],db);
    await db.query("update research_jobs set state='done' where run_id=$1 and stage='collect'",[id]);
    await settle(id,{collect:vi.fn(),read:vi.fn(),discover:vi.fn(),save:saveBuyer});
    const doc=(await db.query<{id:string}>('select id from source_documents where url=$1',[article.url])).rows[0];
    expect((await awardTriggerSnapshots(db,doc.id)).length).toBeGreaterThan(0);
    await db.query("update source_documents set text='Example: no original award text remains.' where id=$1",[doc.id]);
    expect(await awardTriggerSnapshots(db,doc.id)).toEqual([]);
  });
  it('routes awards, not a service-page search preview, to award extraction',()=>{
    expect(needsAwardAnalysis(raw(article),article.text,input)).toBe(true);
    expect(needsAwardAnalysis({...raw(site),research:{lane:'company',searchPreview:'won a contract'}},site.text,input)).toBe(false);
  });
});
