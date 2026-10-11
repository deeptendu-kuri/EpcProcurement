// @vitest-environment node
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import type {RunInput} from '@/mvp/types';
import {briefKey,type SearchBrief,namesWork} from '@/mvp/discovery/brief';
import {buyerEvidence,saveBuyer} from '@/mvp/discovery';
import type {CompanyBundle} from '@/mvp/discovery/bundle';
import {buyerPageCandidate} from '@/mvp/discovery/plan';
import {supportedWorkProof} from '@/mvp/discovery/work-proof';
import {EXTRACTOR_PRIORITY} from '@/mvp/sourcing/classify';
import {sourcePlan} from '@/mvp/sourcing/plan';
import {junkReason} from '@/mvp/sourcing/junk';
import {articleAnalysisText,articleResearchReason} from './relevance';
import {createResearchRun,sessionFor} from './store';
import {processResearchTick,type ResearchDeps} from './engine';
import {extractDocument} from '@/mvp/pipeline/extract';
import pages from './fixtures/buyer-first-pages.json';
const b=pages.brief as SearchBrief;
const now=new Date('2026-10-11T09:00:00Z');
const worley=pages.documents.find(d=>d.url.includes('heartland'))!;
const butting=pages.documents.find(d=>d.url.includes('industrial-service'))!;
let db:Db;
beforeAll(async()=>{db=await createTestDb();},120000);
afterAll(async()=>{await db.close();});
afterEach(()=>vi.unstubAllEnvs());
describe('buyer-first real-page regression replay (no live requests)',()=>{
  it('rejects the old refinery and workers strike before AI but retains current Canadian work',()=>{
    for(const page of pages.documents.filter(d=>/129027|workers-strike/.test(d.url)))
      expect(articleResearchReason(page,'ss-duplex-pipe',b,now),page.url).not.toBeNull();
    expect(articleResearchReason(worley,'ss-duplex-pipe',b,now)).toBeNull();
    expect(articleAnalysisText(worley.text)).toContain('750 million cubic feet per day of natural gas');
    expect(namesWork('Contract workers at the steel plant demand reinstatement.',b)).toBe(false);
    expect(junkReason('https://www.mysteel.net/daily-prices/6831931','Seamless pipe prices')).toBeTruthy();
  });
  it('rejects BUTTING pipe output, without rejecting a fabricator consuming pipes as inputs',()=>{
    const quote=butting.text.split('\n').find(l=>l.startsWith('The use of complex welding techniques'))!;
    expect(buyerPageCandidate(quote,'ss-duplex-pipe')).toBe(false);
    const bundle:CompanyBundle={candidate:{id:'Example fixture id',key:'Example fixture key',company:'BUTTING',domain_hint:'butting.com',identity_document_id:null,
      identity_quote:'BUTTING',document_ids:['Example saved page'],state:'investigating'},hash:'Example test bundle',text:butting.text,
      documents:[{id:'Example saved page',url:butting.url,text:butting.text,tier:'B',content_hash:'Example fixture hash',is_sample:false}]};
    expect(buyerEvidence({company:'BUTTING',companyQuote:'BUTTING',country:null,countryQuote:null,role:'subcontractor',
      productQuote:quote,confidence:.99,project:null,projectQuote:null,activityDate:null,activityQuote:null},butting.text,
      {query:b.item,productId:'ss-duplex-pipe',markets:['CA'],leadKinds:['supply_subcontract']},bundle).reason).toContain('makes or sells');
    expect(buyerPageCandidate('Example Fabricator manufactures pressure vessels using stainless steel pipes as raw material inputs.','ss-duplex-pipe')).toBe(true);
  });
  it('spreads the initial paid-query allowance across contractor and project lanes',()=>{
    const tasks=sourcePlan({productId:'ss-duplex-pipe',keyword:b.item,markets:['IN','CA','AE'],mode:'preview',brief:b,includeResellers:false});
    const paid=tasks.filter(t=>t.source==='tavily').slice(0,8);
    expect(new Set(paid.map(t=>t.market))).toEqual(new Set(['IN','CA','AE']));
    expect(paid.some(t=>t.lane==='capability')).toBe(true);
    expect(paid.some(t=>t.lane==='roundup')).toBe(true);
    expect(tasks.filter(t=>t.source==='bing-query').some(t=>/^plant contract/i.test(t.query??''))).toBe(false);
    expect(EXTRACTOR_PRIORITY.company_site).toBeGreaterThan(EXTRACTOR_PRIORITY.article);
  });
  it('saves Worley BEFORE the run finishes with original proof and zero contacts',async()=>{
    for(const key of ['GROQ_API_KEY','CLOUDFLARE_API_TOKEN','TAVILY_API_KEY'])vi.stubEnv(key,'');
    vi.stubEnv('MVP_WORK_SEARCH','on');vi.stubEnv('MVP_RESEARCH_NEWS','off');vi.stubEnv('MVP_FUNNEL_WORKER','off');
    const input:RunInput={query:b.item,productId:'ss-duplex-pipe',markets:['IN','CA','AE'],leadKinds:['supply_subcontract'],researchMode:'preview'};
    await db.query("insert into search_briefs(key,material,markets,brief,source) values($1,$2,$3,$4::jsonb,'ai')",[briefKey(input.query,input.markets),input.query,input.markets,JSON.stringify(b)]);
    const run=await createResearchRun(input,db);
    // Example pending work keeps this test's run active. It is never executed:
    // prove visibility before settlement, rather than relying on finishIdleResearch.
    await db.query("insert into research_jobs(run_id,stage,key,payload,priority,available_at) values($1,'collect','Example pending work','{}',0,now()+interval '1 hour')",[run]);
    const quote=worley.text.split('\n').find(l=>l.startsWith('Worley has been awarded'))!;
    expect(supportedWorkProof({company:'Worley',quote,text:worley.text},'ss-duplex-pipe',b)).toBe(true);
    const extraction=vi.fn(async(...args:Parameters<typeof extractDocument>)=>extractDocument(args[0],{...args[1],rulesOnly:true}));
    const deps:ResearchDeps={collect:vi.fn(async()=>[{...worley,sourceKey:'saved-real-page',sourceName:'Worley',tier:'B' as const,isSample:false}]),
      read:vi.fn(),discover:vi.fn(),save:saveBuyer,extractAward:extraction,
      needProvider:{name:'groq',model:'Example mocked need check',complete:vi.fn(async()=>({tokensIn:0,tokensOut:0,text:JSON.stringify({
        project:'Heartland Extraction Plant',country:'Canada',date:'2026-08',use:'oil & gas processing plant',needsItem:'yes',
        needWhy:'Potential stainless process-piping application; exact ASTM A312 TP316L requirements are not confirmed.',
        companies:[{name:'Worley',role:'epc',package:'engineering, procurement, fabrication and construction',quote,buysItem:'yes'}]})}))}};
    let found=false;
    for(let tick=0;tick<70&&!found;tick++){
      await processResearchTick(db,deps,run);
      found=(await db.query('select 1 from search_opportunities where run_id=$1',[run])).rows.length>0;
    }
    expect(found).toBe(true);
    expect((await sessionFor(db,run))?.state).toBe('active');
    const result=(await db.query<{name:string;evidence_ids:string[]}>('select c.canonical_name as name,o.evidence_ids from search_opportunities o join companies c on c.id=o.company_id where o.run_id=$1',[run])).rows;
    expect(result).toHaveLength(1);expect(result[0].name).toBe('Worley');
    const evidence=(await db.query<{quote:string;text:string}>('select e.quote,d.text from evidence e join source_documents d on d.id=e.document_id where e.id=any($1::uuid[])',[result[0].evidence_ids])).rows;
    expect(evidence.every(e=>e.text.includes(e.quote))).toBe(true);
    expect((await db.query('select 1 from people')).rows).toHaveLength(0);
    expect((await db.query('select 1 from contact_points')).rows).toHaveLength(0);
    expect(extraction.mock.calls[0][1]?.includePeople).toBe(false);
    expect(deps.read).not.toHaveBeenCalled();
  },60000);
});
