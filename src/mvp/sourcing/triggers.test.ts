// @vitest-environment node
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {storeDocument} from '@/mvp/pipeline/read';
import {extractDocument} from '@/mvp/pipeline/extract';
import {resolveDocument} from '@/mvp/pipeline/resolve';
import {noticeToDoc} from '@/mvp/pipeline/sources/ted';
import {buildSignalsAndScore} from '@/mvp/scoring';
import {awardTriggerSnapshots} from './hybrid';
import {resolveBuyerCompany,persistAwardTriggers,storeTrigger,triggersForCompany,strongestTrigger,triggerStageCap,quotedTriggerDate,confirmedSubcontractLinks} from './triggers';
import type {Trigger} from '@/mvp/buyers/types';
import pages from './fixtures/trigger-pages.json';
import baseline from './fixtures/baseline-pages.json';
import {persistRoundupAwards} from './roundup-triggers';
import {verifyRoundup} from './roundup';
let db:Db,run:string;
beforeAll(async()=>{db=await createTestDb();vi.stubEnv('GROQ_API_KEY','');},120000);
afterAll(async()=>{vi.unstubAllEnvs();await db.close();});
beforeEach(async()=>{await db.exec('truncate runs,source_documents,companies cascade');run=(await db.query<{id:string}>("insert into runs(status) values('running') returning id")).rows[0].id;});
async function proof(text:string,quote=text,url='https://example.com/Example-fixture'){
  const doc=await storeDocument(db,run,{sourceKey:'saved-evaluation',sourceName:'Fixture',tier:'B',url,title:null,text,publishedAt:null,isSample:false});
  await db.query('insert into run_documents(run_id,document_id) values($1,$2) on conflict do nothing',[run,doc.id]);
  const id=(await db.query<{id:string}>("insert into evidence(document_id,url,quote,extracted_by,quote_verified,agreement,tier,publisher_key) values($1,$2,$3,'rule:fixture',true,'single','B','fixture') returning id",[doc.id,url,quote])).rows[0].id;
  return {id,doc};
}
const trigger=(overrides:Partial<Omit<Trigger,'id'>>={}):Omit<Trigger,'id'>=>({kind:'award',role:'contractor',title:'Example Works won a pipeline contract in UAE on 28 September 2026 for USD 482 million.',date:'2026-09-28',datePrecision:'day',valueUsd:482e6,valueText:'USD 482 million',country:'AE',projectId:null,projectName:null,ownerName:null,strength:'confirmed',evidenceIds:[],...overrides});
describe('WP5 persisted original-quote triggers',()=>{
  it('run-C KPIL award is persisted once on extraction replay: September 2026 and approximately USD 482M',async()=>{
    const page=pages.documents.find(d=>d.url.includes('businessline'))!;
    const raw={sourceKey:'saved-evaluation',sourceName:'Businessline',tier:'B' as const,url:page.url,title:page.title,text:page.text,publishedAt:null,isSample:false};
    const doc=await storeDocument(db,run,raw);await db.query('insert into run_documents(run_id,document_id) values($1,$2)',[run,doc.id]);
    const extracted=await extractDocument({text:doc.text,url:page.url,publishedAt:null},{db,runId:run});
    await resolveDocument(db,{documentId:doc.id,url:page.url,tier:'B',publisherKey:'thehindubusinessline.com',market:'AE',publishedAt:null,text:doc.text},extracted);
    const snapshots=await awardTriggerSnapshots(db,doc.id);
    for(let i=0;i<3;i++)await persistAwardTriggers(db,run,'line-pipe',snapshots);
    const rows=(await db.query<{id:string;company_id:string}>("select id,company_id from company_triggers where kind='award'")).rows;expect(rows).toHaveLength(1);
    const [t]=await triggersForCompany(db,rows[0].company_id,run,'line-pipe');
    expect(t).toMatchObject({kind:'award',date:'2026-09-28',datePrecision:'day',country:'AE'});expect(t.valueUsd).toBeCloseTo(481927711,0);
    expect(t.evidenceIds.length).toBeGreaterThan(0);
  },30000);
  it('run-C West-team TED award retains value and does not claim publication is the award date',async()=>{
    const page=pages.documents.find(d=>d.url.includes('ted.europa'))!;
    const description=page.text.split('Description: ')[1];
    const raw=noticeToDoc({'publication-number':'680501-2026','notice-type':'can-standard','title-proc':{eng:page.title},'notice-title':{eng:'Norway – District-heating mains construction work – '+page.title},'buyer-name':{eng:['LYSE NEO AS']},'buyer-country':['NOR'],'winner-name':{eng:['West-team AS']},'winner-country':['NOR'],'total-value':19235075,'total-value-cur':['NOK'],'publication-date':'2026-10-02','classification-cpv':['45232140','45231110'],'description-lot':{eng:description}})!;
    expect(raw.text).toBe(page.text); // adapter uses the real saved TED fields, no invented fact.
    const doc=await storeDocument(db,run,{...raw,text:page.text});
    const ex=await extractDocument({text:doc.text,url:raw.url,publishedAt:raw.publishedAt,structured:raw.structured},{db,runId:run});
    await resolveDocument(db,{documentId:doc.id,url:raw.url,tier:'A',publisherKey:'ted.europa.eu',market:'NO',publishedAt:raw.publishedAt,text:doc.text},ex);
    const result=await persistAwardTriggers(db,run,'line-pipe',await awardTriggerSnapshots(db,doc.id));
    expect(result).toHaveLength(1);expect(result[0]).toMatchObject({kind:'award',date:null,datePrecision:'unknown'});
    expect(result[0].valueUsd).toBeCloseTo(1831912,0);
  },30000);
  it('name variants resolve BEFORE opportunity persistence without replacing headquarters',async()=>{
    const a=await resolveBuyerCompany(db,'Kalpataru Projects International Limited','IN','main_epc');
    const b=await resolveBuyerCompany(db,'KPIL',null,'main_epc');
    expect(b.id).toBe(a.id);expect((await db.query('select country from companies where id=$1',[a.id])).rows[0].country).toBe('IN');
  });
  it('dedupes quoted value/date reports and combines their evidence',async()=>{
    const c=await resolveBuyerCompany(db,'Example Works',null,'main_epc');
    const a=await proof(trigger().title);const b=await proof('Example Works secured the UAE pipeline order on 29 September 2026 for USD 480 million.',undefined,'https://example.org/Example-report');
    const first=await storeTrigger(db,run,c.id,'line-pipe',trigger({evidenceIds:[a.id]}));
    const second=await storeTrigger(db,run,c.id,'line-pipe',trigger({title:b.doc.text,date:'2026-09-29',valueUsd:480e6,valueText:'USD 480 million',evidenceIds:[b.id]}));
    expect(second?.id).toBe(first?.id);expect(second?.evidenceIds).toHaveLength(2);
  });
  it('different dates/values are not merged just because the company matches',async()=>{
    const c=await resolveBuyerCompany(db,'Example Works',null,'main_epc');const a=await proof(trigger().title);
    const b=await proof('Example Works won a UAE pipeline contract on 1 January 2025 for USD 100 million.',undefined,'https://example.org/Example-old');
    await storeTrigger(db,run,c.id,'line-pipe',trigger({evidenceIds:[a.id]}));
    await storeTrigger(db,run,c.id,'line-pipe',trigger({title:b.doc.text,date:'2025-01-01',valueUsd:100e6,valueText:'USD 100 million',evidenceIds:[b.id]}));
    expect(await triggersForCompany(db,c.id,run,'line-pipe')).toHaveLength(2);
  });
  it('unsupported date/value/country stay blank despite a verified identity/award quote',async()=>{
    const c=await resolveBuyerCompany(db,'Example Works',null,'main_epc');const a=await proof('Example Works won a pipeline contract.');
    const saved=await storeTrigger(db,run,c.id,'line-pipe',trigger({title:a.doc.text,evidenceIds:[a.id]}));
    expect(saved).toMatchObject({date:null,valueUsd:null,valueText:null,country:null});
  });
  it('a corrupt original cannot produce a displayed trigger even with quote_verified=true',async()=>{
    const c=await resolveBuyerCompany(db,'Example Works',null,'main_epc');const a=await proof(trigger().title);
    await storeTrigger(db,run,c.id,'line-pipe',trigger({evidenceIds:[a.id]}));
    await db.query("update source_documents set text='Example: original unavailable' where id=$1",[a.doc.id]);
    expect(await triggersForCompany(db,c.id,run,'line-pipe')).toEqual([]);
  });
  it('Tekzone capability has no invented contract date/value and is Early at best',async()=>{
    const page=baseline.documents.find(d=>d.url.includes('tekzoneme'))!;const quote=page.text.match(/Tekzone is among[^\n]+/)![0];
    const p=await proof(page.text,quote,page.url);const c=await resolveBuyerCompany(db,'Tekzone',null,'main_epc','tekzoneme.com');
    const t=await storeTrigger(db,run,c.id,'line-pipe',trigger({kind:'capability',title:quote,evidenceIds:[p.id]}));
    expect(t).toMatchObject({kind:'capability',date:null,valueUsd:null,country:'AE',strength:'possible'});
    expect(triggerStageCap(t,'ready',new Date('2026-10-08'))).toBe('early');
  });
  it('chooses the strongest trigger then recency; caps stale/undated work separately from fit',()=>{
    const cap={...trigger({kind:'capability'}),id:'c'};const old={...trigger({date:'2024-01-01'}),id:'a'};const recent={...trigger(),id:'b'};
    expect(strongestTrigger([cap,old,recent])?.id).toBe('b');expect(triggerStageCap(old,'ready',new Date('2026-10-08'))).toBe('early');
    expect(triggerStageCap(recent,'check',new Date('2026-10-08'))).toBe('check');expect(triggerStageCap(cap,'not_buyer')).toBe('not_buyer');
    expect(quotedTriggerDate('2026-10-02','Published: 2026-10-02.').date).toBeNull();
    expect(quotedTriggerDate('2026-09-01','Example Works won the order in September 2026.')).toEqual({date:'2026-09-01',precision:'month'});
  });
  it('a real empty run cannot rescore unrelated historical leads',async()=>{
    expect(await buildSignalsAndScore(run,{db})).toEqual({created:0,updated:0});
  });
  it('Example roundup award rows create product-scoped opportunities and reuse the same deal',async()=>{
    const text='Example EPC won a gas pipeline contract in UAE on 28 September 2026 for USD 482 million.';
    const p=await proof(text);
    const result=verifyRoundup({companies:[{name:'Example EPC',quote:text,role:'contractor',date:{text:'28 September 2026',quote:text},value:{text:'USD 482 million',quote:text}}]},text,p.doc.id);
    const input={query:'line pipe',productId:'line-pipe',markets:['AE'],leadKinds:['supply_subcontract' as const]};
    await persistRoundupAwards(db,run,input,result);await persistRoundupAwards(db,run,input,result);
    expect((await db.query('select trigger_kind,operating_country from search_opportunities')).rows).toEqual([{trigger_kind:'award',operating_country:'AE'}]);
    expect((await db.query('select id from company_triggers')).rows).toHaveLength(1);
    expect((await db.query('select id from funnel_threads')).rows).toHaveLength(0);
  });
  it('Example identity-only directory and unrelated material never become awards or emails',async()=>{
    const text='Example EPC is a contractor. Example Cables won an electrical cable installation contract in UAE.';
    const p=await proof(text);
    const result=verifyRoundup({companies:[{name:'Example EPC',quote:'Example EPC is a contractor.',role:'contractor'},{name:'Example Cables',quote:'Example Cables won an electrical cable installation contract in UAE.',role:'contractor'}]},text,p.doc.id);
    expect(await persistRoundupAwards(db,run,{query:'line pipe',productId:'line-pipe',markets:['AE'],leadKinds:['supply_subcontract']},result)).toBe(0);
    expect((await db.query('select id from company_triggers')).rows).toEqual([]);
  });
  it('confirmed chain links require a subcontract quote naming both companies, not just a shared project',async()=>{
    const parent=await resolveBuyerCompany(db,'Example EPC',null,'main_epc');const child=await resolveBuyerCompany(db,'Example Mechanical',null,'subcontractor');
    const project=(await db.query<{id:string}>("insert into projects(name,normalized_name) values('Example project','example project') returning id")).rows[0].id;
    await db.query("insert into project_parties(project_id,company_id,role) values($1,$2,'main_epc')",[project,parent.id]);
    const vague=await proof('Example Mechanical installs pipelines.');await confirmedSubcontractLinks(db,child.id,project,[vague.id]);
    expect((await db.query('select id from chain_links')).rows).toHaveLength(0);
    const named=await proof('Example EPC awarded the pipeline subcontract to Example Mechanical.',undefined,'https://example.org/Example-subcontract');
    await confirmedSubcontractLinks(db,child.id,project,[named.id]);await confirmedSubcontractLinks(db,child.id,project,[named.id]);
    expect((await db.query('select strength,evidence_ids from chain_links')).rows).toEqual([{strength:'confirmed',evidence_ids:[named.id]}]);
  });
});
