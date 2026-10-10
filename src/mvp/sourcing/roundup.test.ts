// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {createResearchRun,sessionFor} from '@/mvp/research/store';
import {processResearchTick,type ResearchDeps} from '@/mvp/research/engine';
import {storeDocument} from '@/mvp/pipeline/read';
import {researchBudget} from '@/mvp/discovery/plan';
import type {RawDoc} from '@/mvp/pipeline/contracts';
import {extractRoundup,verifyRoundup,roundupBody,seedRoundup,lookupRoundupWebsite} from './roundup';
import fixtures from './fixtures/roundup-pages.json';
import baseline from './fixtures/baseline-pages.json';
import {junkReason} from './junk';
import india from './fixtures/india-contractors.json';
const top=fixtures.documents.find(d=>d.url.includes('sphericalinsights'))!;
const allowed=fixtures.documents.find(d=>d.url.includes('getglobalgroup'))!;
const dewa=baseline.documents.find(d=>d.url.includes('dewa-awards'))!;
const listed=top.text.split('Top 25 Companies Leading the Oil and Gas Pipeline Fabrication and Construction Market\n')[1].split('\nSaipem S.p.A.\nHeadquarters')[0].trim().split('\n');
const input={query:'line pipe',productId:'line-pipe',markets:['IN','AE'],leadKinds:['supply_subcontract' as const],researchMode:'batch' as const};
const raw=(page:typeof dewa):RawDoc & {text:string}=>({url:page.url,title:page.title,text:page.text,sourceKey:'saved-evaluation',sourceName:new URL(page.url).hostname,tier:'B',publishedAt:null,isSample:false});
let db:Db;
beforeAll(async()=>{db=await createTestDb();},120000);afterAll(async()=>db.close());
beforeEach(async()=>{await db.exec('truncate runs,source_documents,companies cascade');vi.stubEnv('GROQ_API_KEY','');vi.stubEnv('TAVILY_API_KEY','');vi.stubEnv('MVP_RESEARCH_NEWS','off');});
afterEach(()=>vi.unstubAllEnvs());
describe('WP3 evidence-faithful roundup fan-out',()=>{
  it('fans out ≥15 literal identity candidates from the actual saved India Top 25 directory without turning refresh dates into awards',async()=>{
    const rows=india.text.split('\n').filter(line=>/^\d+ \| /.test(line));
    expect(rows).toHaveLength(25);
    // Preserve source labels, including imperfect avatar prefixes. A later official-site
    // investigation must corroborate legal/brand identity; these are not verified buyers.
    const complete=vi.fn(async()=>({text:JSON.stringify({companies:rows.map(quote=>({name:quote.split(' | ')[1],quote}))}),tokensIn:1,tokensOut:1}));
    const result=await extractRoundup({id:india.id,text:india.text},{name:'groq',model:'fixture',complete});
    expect(result.companies.length).toBeGreaterThanOrEqual(15);expect(complete).toHaveBeenCalledTimes(1);
    expect(result.companies.every(c=>india.text.includes(c.quote)&&!c.date&&!c.value&&!c.project)).toBe(true);
    const id=await createResearchRun(input,db);const stored=await storeDocument(db,id,raw({...dewa,...india,documentId:india.id}));
    const seeded=await seedRoundup(db,id,input,{...result,found_via:{documentId:stored.id,kind:'roundup'}},researchBudget(input));
    expect(seeded.seeded).toBeGreaterThanOrEqual(15);
    expect((await db.query('select id from search_opportunities where run_id=$1',[id])).rows).toHaveLength(0);
  });
  it('retains all 25 real names from the saved GLOBAL list in one mocked JSON call; live admission still blocks the publisher',async()=>{
    expect(listed).toHaveLength(25);
    const complete=vi.fn(async()=>({text:JSON.stringify({companies:listed.map(name=>({name,quote:name}))}),tokensIn:1,tokensOut:1}));
    const result=await extractRoundup({id:top.id,text:top.text},{name:'groq',model:'fixture',complete});
    expect(result.companies).toHaveLength(25);expect(complete).toHaveBeenCalledTimes(1);
    expect(result.companies.every(c=>top.text.includes(c.quote))).toBe(true);
    expect(result.companies.every(c=>!c.country&&!c.date&&!c.value&&!c.project)).toBe(true);
    expect(junkReason(top.url,top.title,['IN'])).toBe('market report');
    const id=await createResearchRun(input,db);const stored=await storeDocument(db,id,raw({...dewa,...top,documentId:top.id}));
    const seeded=await seedRoundup(db,id,input,{...result,found_via:{documentId:stored.id,kind:'roundup'}},researchBudget(input));
    expect(seeded.seeded).toBeGreaterThanOrEqual(15);
    expect((await db.query('select company from research_candidates where run_id=$1',[id])).rows).toHaveLength(25);
    expect((await db.query('select id from search_opportunities where run_id=$1',[id])).rows).toHaveLength(0);
  });
  it('reports DEWA missing awardees and drops hallucinated and unrelated-story contractors',async()=>{
    const quote=dewa.text.split('\n').find(s=>s.startsWith('Dubai Electricity and Water Authority'))!;
    const result=verifyRoundup({companies:[{name:'Dubai Electricity and Water Authority (DEWA)',quote,role:'owner'},
      {name:'KEC International',quote:'KEC International won a DEWA award.',role:'contractor'},
      {name:'Combined Group Contracting',quote:'Combined Group Contracting (CGC) Company Emirates L.L.C., a subsidiary of Combined Group Contracting Company, Kuwait announces in a statement that it has awarded a contract in …',role:'contractor'}]},dewa.text,dewa.documentId);
    expect(result.companies).toHaveLength(1);expect(result.companies[0].role).toBe('owner');
    expect(result.dropped).toBe(2);expect(result.warnings.join(' ')).toContain('names no verified winning contractors');
    expect(roundupBody(dewa.text)).not.toContain('Combined Group');
    const id=await createResearchRun({...input,query:'power cables',productId:'cables'},db);const stored=await storeDocument(db,id,raw(dewa));
    await seedRoundup(db,id,input,{...result,found_via:{documentId:stored.id,kind:'roundup'}},researchBudget(input));
    expect((await db.query('select company from research_candidates where run_id=$1',[id])).rows).toHaveLength(0);
    const falseRole=verifyRoundup({companies:[{name:'Dubai Electricity and Water Authority (DEWA)',quote,role:'contractor'}]},dewa.text,dewa.documentId);
    expect(falseRole.companies[0].role).toBe('owner');expect(falseRole.warnings).toHaveLength(1);
  });
  it('rejects countries, headings, associations, publishers and article titles even with literal quotes',()=>{
    const names=['United Arab Emirates','Key Players & More','World Nuclear Association','Spherical Insights','Cable Laying in UAE: Essential Services'];
    const result=verifyRoundup({companies:names.map(name=>({name,quote:name}))},names.join('\n'),'Example');
    expect(result.companies).toEqual([]);expect(result.dropped).toBe(5);
  });
  it('malformed optional details do not erase a real quoted identity',()=>{
    const result=verifyRoundup({companies:[{name:'McDermott International',quote:'McDermott International',country:null,project:23,date:'unknown',value:{text:'$5m'},domain:null}]},allowed.text,allowed.id);
    expect(result.companies).toEqual([{name:'McDermott International',quote:'McDermott International'}]);
  });
  it('keeps real identities but drops another company’s value/date/project/country and unquoted domains',()=>{
    const name='McDermott International';const quote=roundupBody(allowed.text).split('\n').find(s=>s.startsWith('McDermott International has'))!;
    const other=allowed.text.split('\n').find(s=>s.startsWith('In 2024, Petrofac announced'))!;
    const result=verifyRoundup({companies:[{name,quote,role:'contractor',value:{text:'$2 billion',quote:other},date:{text:'2024',quote:other},project:{name:'offshore oilfield development',quote:other},country:{text:'Abu Dhabi',quote:allowed.text.split('\n').find(s=>s.startsWith('Abu Dhabi, the capital'))!},domain:'guessed.example'}]},allowed.text,allowed.id);
    expect(result.companies[0]).toEqual({name,quote,role:'contractor'});
  });
  it('fans out an allowed roundup in the durable engine and retains one lookup task per company on replay',async()=>{
    vi.stubEnv('TAVILY_API_KEY','fixture-key');const id=await createResearchRun(input,db);
    const names=['McDermott International','Technip Energies','Petrofac','Consolidated Contractors Company (CCC)'];
    const extractor=vi.fn(async(d:{id:string;text:string})=>verifyRoundup({companies:names.map(name=>({name,quote:name}))},d.text,d.id));
    const deps:ResearchDeps={collect:vi.fn(async()=>[raw({...dewa,...allowed,documentId:allowed.id})]),read:vi.fn(),discover:vi.fn(),save:vi.fn(),extractRoundup:extractor,lookupWebsite:vi.fn(async()=>[])};
    for(let i=0;i<80&&(await sessionFor(db,id))?.state==='active';i++)await processResearchTick(db,deps,id);
    expect((await sessionFor(db,id))?.state).toBe('done');expect(extractor).toHaveBeenCalledTimes(1);
    expect((await db.query("select id from research_jobs where run_id=$1 and payload->>'source'='roundup-website'",[id])).rows).toHaveLength(4);
    expect(deps.discover).not.toHaveBeenCalled();expect(deps.save).not.toHaveBeenCalled();
    expect((await db.query('select id from funnel_threads')).rows).toHaveLength(0);
  },30_000);
  it('website lookup respects the shared zero-credit ceiling and never guesses contacts',async()=>{
    const id=await createResearchRun(input,db);const stored=await storeDocument(db,id,raw({...dewa,...allowed,documentId:allowed.id}));
    const result=verifyRoundup({companies:[{name:'McDermott International',quote:'McDermott International'}]},allowed.text,stored.id);
    await seedRoundup(db,id,input,result,researchBudget(input));
    const candidate=(await db.query<{id:string}>('select id from research_candidates where run_id=$1',[id])).rows[0];const collect=vi.fn();
    expect(await lookupRoundupWebsite(db,id,input,candidate.id,{...researchBudget(input),searchQueries:0},collect)).toMatchObject({queued:0,budgetLimited:true});
    expect(collect).not.toHaveBeenCalled();
    expect((await db.query('select id from contact_points')).rows).toHaveLength(0);
  });
  it('seeds only one website investigation for a repeated company and never trusts search previews as evidence',async()=>{
    const id=await createResearchRun(input,db);const stored=await storeDocument(db,id,raw({...dewa,...allowed,documentId:allowed.id}));
    const result=verifyRoundup({companies:[{name:'McDermott International',quote:'McDermott International'}]},allowed.text,stored.id);
    await seedRoundup(db,id,input,result,researchBudget(input));
    const candidate=(await db.query<{id:string}>('select id from research_candidates where run_id=$1',[id])).rows[0];
    const collect=vi.fn(async()=>[{...raw({...dewa,...allowed,documentId:allowed.id}),url:'https://www.mcdermott.com/',text:null,research:{lane:'company' as const,searchPreview:'Example: unsupported award and buyer email.'}}]);
    expect(await lookupRoundupWebsite(db,id,input,candidate.id,researchBudget(input),collect)).toMatchObject({queued:1,cached:false});
    expect(await lookupRoundupWebsite(db,id,input,candidate.id,researchBudget(input),collect)).toMatchObject({queued:0,cached:true});
    expect(collect).toHaveBeenCalledTimes(1);
    expect((await db.query<{payload:{raw:RawDoc}}>("select payload from research_jobs where run_id=$1 and stage='read'",[id])).rows).toMatchObject([{payload:{raw:{url:'https://mcdermott.com/',text:null,fallbackText:null}}}]);
    expect((await db.query('select id from evidence')).rows).toHaveLength(0);
  });
  it('records a missing-details coverage warning through the real DEWA job without making up leads',async()=>{
    const id=await createResearchRun({...input,query:'power cables',productId:'cables',markets:['AE']},db);
    const deps:ResearchDeps={collect:vi.fn(async()=>[raw(dewa)]),read:vi.fn(),discover:vi.fn(),save:vi.fn()};
    for(let n=0;n<40&&(await sessionFor(db,id))?.state==='active';n++)await processResearchTick(db,deps,id);
    expect((await sessionFor(db,id))?.state).toBe('done');
    expect((await db.query<{counters:{coverageIncomplete:boolean;coverage:{reason:string}}}>('select counters from runs where id=$1',[id])).rows[0].counters).toMatchObject({coverageIncomplete:true,coverage:{reason:expect.stringContaining('contractor/award details')}});
    expect((await db.query('select id from search_opportunities where run_id=$1',[id])).rows).toHaveLength(0);
    expect(deps.read).not.toHaveBeenCalled();
  });
});
