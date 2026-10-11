// @vitest-environment node
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {briefKey,catalogueBrief,groundingQuery,parseBrief} from '@/mvp/discovery/brief';
import {classifyPage} from '@/mvp/sourcing/classify';
import {companyIdentityReason} from '@/mvp/sourcing/entities';
import {saveBuyer} from '@/mvp/discovery';
import {supportedWorkProof} from '@/mvp/discovery/work-proof';
import {extractDocument} from '@/mvp/pipeline/extract';
import {createResearchRun,sessionFor} from './store';
import {processResearchTick,type ResearchDeps} from './engine';
import {judgeNeed,needPrompt} from './need';
import {currentWorkProof} from './current-work';
import {pagePublishedAt} from './page-date';
import corpus from './fixtures/independent-buyers.json';

const material='Stainless steel pipe ASTM A312 TP316L for process piping';
const brief={...catalogueBrief(material,['IN','CA','AE'],'ss-duplex-pipe'),source:'ai' as const,item:material};
const now=new Date('2026-10-11T00:00:00Z');
const lines=(p:{text:string})=>p.text.split('\n').filter(Boolean);
const wood=corpus.documents.find(p=>p.url.endsWith('/construction/'))!;
const progress=corpus.documents.find(p=>p.url.includes('65-complete'))!;
const adnoc=corpus.documents.find(p=>p.url.includes('q2-2026'))!;
const ten=corpus.documents.find(p=>p.url.includes('ten.com'))!;
const praj=corpus.documents.find(p=>p.url.includes('praj.net'))!;
const quote=(p:{text:string},starts:string)=>lines(p).find(l=>l.startsWith(starts))!;
const makeAnswer=(project:string|null,country:string,use:string,companies:unknown[])=>JSON.stringify({project,country,use,needsItem:'yes',
  needWhy:'Potential stainless process-piping application; exact ASTM A312 TP316L, quantity and purchasing status are unconfirmed.',companies});
const co=(name:string,q:string,pkg:string,extra={})=>({name,quote:q,role:'epc',package:pkg,buysItem:'yes',...extra});
const answers=new Map([
  [wood.url,makeAnswer('Woodfibre LNG','Canada','oil & gas processing plant',[
    co('McDermott International',quote(wood,'Construction of the Project'),'Engineering, Procurement, Fabrication and Construction'),
    co('Ledcor Bird',quote(wood,'Construction of the Project'),'civil and marine works',{role:'subcontractor',buysItem:'no'}),
  ])],
  [progress.url,makeAnswer('Woodfibre LNG','Canada','oil & gas processing plant',[])],
  [adnoc.url,makeAnswer('RGD','United Arab Emirates','oil & gas processing plant',[
    co('Wison Engineering',quote(adnoc,'ADNOC Gas has awarded'),'EPC natural gas processing train'),
    co('Tecnimont',quote(adnoc,'ADNOC Gas has awarded'),'EPC natural gas liquids fractionation train'),
  ])],
  [ten.url,makeAnswer('Ruwais LNG','United Arab Emirates','oil & gas processing plant',[
    ...['Technip Energies','JGC','NMDC Energy'].map(n=>co(n,quote(ten,'Technip Energies (PARIS:TE)'),'Engineering procurement construction LNG plant',{role:'jv_partner'})),
  ])],
  [praj.url,makeAnswer(null,'India','food and pharmaceutical process plant',[
    co('Praj Industries Ltd.',lines(praj).find(l=>l.includes('Received contract for greenfield project'))!,'brewery project delivery',
      {role:'subcontractor',identityQuote:quote(praj,'Praj Industries Ltd. announces')}),
  ])],
]);

afterEach(()=>vi.unstubAllEnvs());
describe('independent research controls',()=>{
  it('grounds consuming work, not a pipe catalogue, and rejects serialized JSON search values',()=>{
    expect(groundingQuery(material,'ss-duplex-pipe','CA')).toContain('chemical and petrochemical process plants');
    expect(groundingQuery(material,'ss-duplex-pipe','CA')).not.toMatch(/ASTM|316L/);
    const b=parseBrief(JSON.stringify({...brief,owners:['places','Reliance Industries Ltd","Saudi Aramco','ADNOC'],places:{AE:[':','Ruwais']}}),material,['AE'],'ss-duplex-pipe')!;
    expect(b.owners).toEqual(['ADNOC']);expect(b.places.AE).toEqual(['Ruwais']);
    expect(b.uses.some(u=>u.newsWords.includes('LNG'))).toBe(true);
  });
  it('does not fan out a technical specification table as a contractor directory',()=>{
    const rows=Array.from({length:8},(_,n)=>[String(n),'316L','ASTM A312']);
    expect(classifyPage({url:'https://example.org/pipe-chart',title:'Pipe specification chart',text:rows.map(r=>r.join(' | ')).join('\n'),tables:[[['Size','Grade','Standard'],...rows]]})).toBe('company_site');
    expect(classifyPage({url:'https://example.org/contractors',title:'Members',text:'',tables:[[['Company name','Category'],...rows]]})).toBe('directory');
    expect(companyIdentityReason('info@gneestainless.com',{confirmedDomain:'gneestainless.com'})).toMatch(/not a company/);
  });
  it('recovers actual publication datelines without substituting a forecast or a project year',()=>{
    expect(pagePublishedAt(adnoc.text,null)?.slice(0,10)).toBe('2026-08-10');
    expect(pagePublishedAt(praj.text,null)?.slice(0,10)).toBe('2026-02-12');
    expect(pagePublishedAt('Example plant will open in 2028.\nSigned a contract in 2005.',null)).toBeNull();
    expect(pagePublishedAt('February 30, 2026',null)).toBeNull();
  });
  it('links recent project progress to older role proof, without redating the contract or copying names from another project',()=>{
    const support={id:'Example stored progress ID',url:progress.url,text:progress.text,publishedAt:progress.publishedAt};
    const active=currentWorkProof('Woodfibre LNG',[support],now);
    expect(active?.quote).toContain('65% complete');expect(progress.text).toContain(active!.quote);
    expect(currentWorkProof('Example Unrelated LNG',[support],now)).toBeNull();
    expect(currentWorkProof('Woodfibre LNG',[{...support,text:'Woodfibre LNG construction is suspended.',publishedAt:'2026-10-01'},support],now)).toBeNull();
    const without=judgeNeed(answers.get(wood.url)!,wood,brief,['CA'],now)!;
    expect(without.companies[0].verdict).toBe('rejected');
    const withProgress=judgeNeed(answers.get(wood.url)!,{...wood,related:[support]},brief,['CA'],now)!;
    expect(withProgress.companies[0].verdict).toBe('lead');
    expect(withProgress.companies[0].since?.slice(0,4)).toBe('2023');
    expect(withProgress.companies[1].verdict).toBe('rejected');
  });
  it('accepts corporate own-work bullets with separate identity proof, never publisher attribution',()=>{
    const result=judgeNeed(answers.get(praj.url)!,{...praj,publishedAt:pagePublishedAt(praj.text,praj.publishedAt)},brief,['IN'],now)!;
    expect(result.companies[0].verdict).toBe('lead');
    const c=result.companies[0];
    expect(supportedWorkProof({company:c.name,quote:c.quote,text:praj.text,url:praj.url,identityQuote:c.identityQuote},'ss-duplex-pipe',brief)).toBe(true);
    expect(judgeNeed(answers.get(praj.url)!,{...praj,url:'https://publisher.example/finance',publishedAt:'2026-02-12'},brief,['IN'],now)!.companies[0].verdict).toBe('rejected');
  });
  it('actually puts the role and work evidence into the model prompt, not just the saved full page',()=>{
    for(const p of [wood,adnoc,ten,praj]){
      const prompt=needPrompt(p,brief).user;
      for(const c of JSON.parse(answers.get(p.url)!).companies){
        expect(prompt,p.url).toContain(c.quote);
        if(c.identityQuote)expect(prompt,p.url).toContain(c.identityQuote);
      }
    }
  });
  it('rejects AI-invented locations, completed jobs and civil-only packages even when the model says buyer',()=>{
    const q='Example Contractor completed a chemical process plant in Canada in 2020.';
    const answer=makeAnswer('Example Chemical','United Arab Emirates','chemical process plant',[co('Example Contractor',q,'EPC')]);
    const r=judgeNeed(answer,{text:q,publishedAt:'2026-08-10'},brief,['AE','CA'],now)!;
    expect(r.companies[0].verdict).toBe('rejected');expect(r.market).toBeNull();
    expect(r.companies[0].reason).toContain('completed work');
  });
});

describe('stored primary-page end-to-end replay, providers mocked',()=>{
  let db:Db;
  beforeAll(async()=>{db=await createTestDb();},120000);
  afterAll(async()=>{await db.close();});
  it('saves seven distinct potential buyers across three countries, retaining real source quotes and no contacts',async()=>{
    for(const key of ['GROQ_API_KEY','TAVILY_API_KEY','CLOUDFLARE_API_TOKEN'])vi.stubEnv(key,'');
    vi.stubEnv('MVP_WORK_SEARCH','on');vi.stubEnv('MVP_RESEARCH_NEWS','off');vi.stubEnv('MVP_FUNNEL_WORKER','off');
    const input={query:material,productId:'ss-duplex-pipe',markets:['IN','CA','AE'],leadKinds:['supply_subcontract' as const],researchMode:'preview' as const,brief};
    await db.query("insert into search_briefs(key,material,markets,brief,source) values($1,$2,$3,$4::jsonb,'ai')",[briefKey(material,input.markets),material,input.markets,JSON.stringify(brief)]);
    const run=await createResearchRun(input,db);
    await db.query("insert into research_jobs(run_id,stage,key,payload,priority,available_at) values($1,'collect','Example pending work','{}',0,now()+interval '1 hour')",[run]);
    const supplied=[progress,wood,adnoc,ten,praj];
    const need=vi.fn(async(request:{user:string})=>({text:answers.get(supplied.find(p=>request.user.includes(p.url))?.url??'')??'{}',tokensIn:0,tokensOut:0}));
    const deps:ResearchDeps={collect:vi.fn(async()=>supplied.map(p=>({...p,sourceKey:'primary-page-replay',sourceName:'Stored primary source',tier:'B' as const,isSample:false}))),
      read:vi.fn(),discover:vi.fn(),save:saveBuyer,needProvider:{name:'groq',model:'Example mocked extraction',complete:need},
      extractAward:async(...args)=>extractDocument(args[0],{...args[1],rulesOnly:true})};
    let count=0;
    for(let tick=0;tick<100&&count<7;tick++){
      await processResearchTick(db,deps,run);
      count=(await db.query('select id from search_opportunities where run_id=$1',[run])).rows.length;
    }
    const rows=(await db.query<{name:string;evidence_ids:string[];material_fit_kind:string;activity_status:string}>(
      'select c.canonical_name as name,o.evidence_ids,o.material_fit_kind,o.activity_status from search_opportunities o join companies c on c.id=o.company_id where o.run_id=$1',[run])).rows;
    expect(rows.map(r=>r.name).sort()).toEqual(['McDermott International','Wison Engineering','Tecnimont','Technip Energies','JGC','NMDC Energy','Praj Industries Ltd.'].sort());
    expect(rows.every(r=>r.material_fit_kind==='potential')).toBe(true);
    const evidence=(await db.query<{quote:string;text:string}>(
      'select e.quote,d.text from evidence e join source_documents d on d.id=e.document_id where e.id=any($1::uuid[])',[rows.flatMap(r=>r.evidence_ids)])).rows;
    // EPC partners legitimately share an original JV sentence. Nine links
    // resolve to six distinct quotes; do not manufacture one quote per company.
    expect(rows.flatMap(r=>r.evidence_ids).length).toBeGreaterThanOrEqual(9);
    expect(evidence.length).toBeGreaterThanOrEqual(6);
    expect(evidence.every(e=>e.text.includes(e.quote))).toBe(true);
    expect(rows.find(r=>r.name==='McDermott International')?.activity_status).toBe('ongoing');
    expect(need).toHaveBeenCalledTimes(5);
    expect(deps.read).not.toHaveBeenCalled();expect(deps.discover).not.toHaveBeenCalled();
    expect((await sessionFor(db,run))?.state).toBe('active');
    expect((await db.query('select 1 from people')).rows).toHaveLength(0);
    expect((await db.query('select 1 from contact_points')).rows).toHaveLength(0);
  },90000);
});
