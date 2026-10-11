// @vitest-environment node
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {catalogueBrief} from '@/mvp/discovery/brief';
import {sourcePlan} from '@/mvp/sourcing/plan';
import {classifyPage} from '@/mvp/sourcing/classify';
import {pageCompany,extendInvestigation,registerCandidate} from './investigation';
import {fairGroundingDocs} from './routing';
import type {RawDoc} from '@/mvp/pipeline/contracts';
import {registerNeedCandidates} from './need-candidates';
import {storeDocument} from '@/mvp/pipeline/read';
import {workAnalysisParagraphs} from './relevance';
import {judgeNeed} from './need';
import livePages from './fixtures/live-quality-pages.json';
const input={query:'Stainless steel pipe ASTM A312 TP316L',productId:'ss-duplex-pipe',markets:['IN','CA','AE'],leadKinds:['supply_subcontract' as const],
  brief:catalogueBrief('Stainless steel pipe ASTM A312 TP316L',['IN','CA','AE'],'ss-duplex-pipe')};
describe('routing defects observed in the six-credit live rehearsal',()=>{
  it('does not confuse a press-release publisher with its contractor',()=>{
    const url='https://markets.ft.com/data/announce/detail?dockey=600-202609290437BIZWIRE_USPRX____20260929_BW958215-1';
    const title='Fluor Joint Venture Selected for LNG Canada Phase 2 Expansion Following Final Investment Decision – Company Announcement - FT.com';
    const text='Fluor Corporation announced today that its joint venture with JGC Corporation has been selected to deliver engineering, procurement, fabrication, construction and commissioning for Phase 2 of LNG Canada.';
    expect(classifyPage({url,title,text})).toBe('article');expect(pageCompany(text,title,url)).toBeNull();
    expect(pageCompany('Upstream','ABOUT US | Upstream','https://www.upstreamonline.com/aboutus')).toBeNull();
  });
  it('keeps each country first before second paid queries regardless of its free news count',()=>{
    const plan=sourcePlan({productId:input.productId,keyword:input.query,markets:input.markets,mode:'preview',brief:input.brief});
    expect(plan.filter(t=>t.source==='tavily').slice(0,3).map(t=>t.market)).toEqual(['IN','CA','AE']);
  });
  it('alternates countries before their grounding URLs consume admission slots',()=>{
    const docs=input.markets.flatMap(m=>Array.from({length:20},(_,n):RawDoc=>({market:m,url:`https://example-${m.toLowerCase()}-${n}.example/`,title:'Example contractor',
      sourceKey:'Example',sourceName:'Example',tier:'C',text:null,publishedAt:null,isSample:false})));
    expect(fairGroundingDocs(docs,input).slice(0,6).map(d=>d.market)).toEqual(['IN','CA','AE','IN','CA','AE']);
  });
  it('can select a literal paragraph from the live ISGEC page instead of regenerating a stitched quote',()=>{
    const page=livePages.documents.find(d=>d.url.includes('isgec.com'))!;
    const paragraphs=workAnalysisParagraphs(page.text,input.brief);
    const quoteIndex=paragraphs.findIndex(p=>p.startsWith('Expertise spans the delivery'));
    expect(quoteIndex).toBeGreaterThanOrEqual(0);
    const raw={project:null,country:'India',use:'chemical process plant',needsItem:'yes',needWhy:'Potential process piping; exact grade and current procurement unknown',
      companies:[{name:'Isgec',role:'epc',package:'Turnkey chemical process plant EPC',buysItem:'yes',quoteIndex,
        identityQuote:page.text.split('\n')[0],quote:'Example model paraphrase: not source evidence'}]};
    const result=judgeNeed(JSON.stringify(raw),page,input.brief,input.markets)!;
    expect(result.companies[0].verdict).toBe('lead');expect(page.text).toContain(result.companies[0].quote);
    expect(result.companies[0].since).toBeNull();
    raw.companies[0].quoteIndex=999;
    expect(judgeNeed(JSON.stringify(raw),page,input.brief,input.markets)!.companies[0].verdict).toBe('rejected');
  });
  it('recognises actual Canadian JV work in the stored release, without calling the publisher a buyer',()=>{
    const page=livePages.documents.find(d=>d.url.includes('markets.ft.com'))!;
    const paragraphs=workAnalysisParagraphs(page.text,input.brief);
    const quoteIndex=paragraphs.findIndex(p=>p.startsWith('Fluor Corporation (NYSE: FLR) announced'));
    expect(quoteIndex).toBeGreaterThanOrEqual(0);
    const answer={project:'LNG Canada Phase 2',country:'Canada',use:'oil & gas processing plant',needsItem:'yes',needWhy:'Potential process-piping application, exact grade unconfirmed',
      companies:['Fluor Corporation','JGC Corporation'].map(name=>({name,role:'jv_partner',package:'Engineering procurement fabrication construction and commissioning',buysItem:'yes',quoteIndex}))};
    const result=judgeNeed(JSON.stringify(answer),page,input.brief,input.markets)!;
    expect(result.companies.map(c=>c.verdict)).toEqual(['lead','lead']);expect(result.market).toBe('CA');
    expect(result.companies.every(c=>page.text.includes(c.quote))).toBe(true);
  });
});
describe('buyer proof precedes additional same-domain/contact research',()=>{
  let db:Db;beforeAll(async()=>{db=await createTestDb();},120000);afterAll(async()=>db.close());
  it('lowers follow-ups and bundle work and retains an accepted quote on an existing seed',async()=>{
    const run=(await db.query<{id:string}>("insert into runs(status,adhoc_query) values('queued',$1::jsonb) returning id",[JSON.stringify(input)])).rows[0].id;
    await db.query("insert into research_sessions(run_id,budget) values($1,'{}')",[run]);
    const quote='Example Contractor installs stainless steel process piping in India.';
    const doc=(await storeDocument(db,run,{sourceKey:'Example',sourceName:'Example',tier:'B',url:'https://examplecontractor.example/services',text:quote,title:null,publishedAt:null,isSample:false})).id;
    const c=await db.tx(tx=>registerCandidate(tx,run,'Example Contractor','examplecontractor.example',doc,null));
    const raw:RawDoc={url:'https://examplecontractor.example/services',text:quote,title:'Example Contractor',sourceKey:'Example',sourceName:'Example',tier:'B',publishedAt:null,isSample:false};
    await extendInvestigation(db,run,c,raw,doc,quote,[{url:'https://examplecontractor.example/projects',text:'Projects'},
      {url:'https://examplecontractor.example/contact',text:'Contact'}],input,{maxPages:40});
    const jobs=(await db.query<{stage:string;priority:number;key:string}>('select stage,priority,key from research_jobs where run_id=$1',[run])).rows;
    expect(jobs.every(j=>j.priority<1000)).toBe(true);expect(jobs.some(j=>j.key.includes('/contact'))).toBe(false);
    await registerNeedCandidates(db,run,doc,{project:null,country:'India',market:'IN',date:null,use:'chemical process plant',needsItem:'yes',needWhy:'Example potential',
      companies:[{name:'Example Contractor',role:'subcontractor',package:'process piping',quote,quoteVerified:true,since:null,verdict:'lead',reason:'Example work'}]});
    expect((await db.query<{identity_quote:string}>('select identity_quote from research_candidates where id=$1',[c.id])).rows[0].identity_quote).toBe(quote);
  });
});
