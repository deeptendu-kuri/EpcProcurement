// @vitest-environment node
// Cases modelled on the live "steel plates" search (synthetic Example names; no provider or network calls).
import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import type {RunInput} from '@/mvp/types';
import type {RawDoc} from '@/mvp/pipeline/contracts';
import {storeDocument} from '@/mvp/pipeline/read';
import {createResearchRun,sessionFor} from './store';
import {finishIdleResearch} from './engine';
import {genericServicePhrase} from './investigation';
import {seedRoundup,officialSite} from '@/mvp/sourcing/roundup';
import {junkFoundName,looksLikeSupplier,relevantFound} from '@/mvp/sourcing/names';
import {productApplication,applicationSentence} from '@/mvp/discovery/application';
import {capabilityLabel} from '@/mvp/discovery/locations';
import {materialEvidenceKind} from '@/mvp/discovery/plan';
import {titleOnly} from '@/mvp/evidence';
import {likelyRole} from './found';

let db:Db;
const input:RunInput={query:'steel plates',productId:'plates',markets:['MY'],leadKinds:['supply_subcontract']};
beforeAll(async()=>{db=await createTestDb();},120000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{vi.stubEnv('TAVILY_API_KEY','Example-test-only');vi.stubEnv('GROQ_API_KEY','');await db.exec('truncate runs cascade;');});
afterEach(()=>vi.unstubAllEnvs());

describe('why a company needs steel plates',()=>{
  it('explains pressure vessel, shipyard and tank work in plain words',()=>{
    expect(productApplication('plates','Our workshop supports our pressure vessel manufacturing.')?.label).toBe('Pressure vessel fabricator');
    expect(applicationSentence('plates',['Example Drydocks secured a contract for vessel construction.'])).toMatch(/^Why they need steel plates: Ship hulls/);
    expect(capabilityLabel('plates','We build API 650 storage tanks.')).toBe('Storage tank fabricator');
    expect(applicationSentence('plates',['We provide digital marketing.'])).toBeNull();
  });
  it('counts shipbuilding and vessel construction as plate-consuming work',()=>{
    expect(materialEvidenceKind('Example Shipyard specialises in shipbuilding and ship repair for offshore clients.','plates')).not.toBe('none');
  });
  it('does not show a page title as proof',()=>{
    expect(titleOnly('Product & Services – Example Engineering Sdn. Bhd.')).toBe(true);
    expect(titleOnly('Example workshop is equipped to support our pressure vessel manufacturing.')).toBe(false);
  });
});

describe('names that are not buyers',()=>{
  it('rejects platforms, certifiers, site credits, slogans and service phrases',()=>{
    expect(junkFoundName('Google Ads','Google Ads')).toBe('platform');
    expect(junkFoundName('ChatGPT','ChatGPT')).toBe('platform');
    expect(junkFoundName('DNV','Third-party inspections (Lloyds, BV, DNV, TÜV, SGS) on request')).toBe('certifier or standards body');
    expect(junkFoundName('European Committee for Standardization (CEN)',null)).toBe('certifier or standards body');
    expect(junkFoundName('Example Web Solutions','Website designed by Example Web Solutions')).toBe('site credit');
    expect(junkFoundName('We give you a clear solution',null)).toBe('slogan');
    expect(genericServicePhrase('Pressure Vessel Fabrication')).toBe(true);
    expect(genericServicePhrase('Pressure Vessel Manufacturer UAE')).toBe(true);
    expect(genericServicePhrase('Dubai')).toBe(false);
    expect(genericServicePhrase('Example Steel Pressure Vessel Fabrication')).toBe(false);
    expect(junkFoundName('Example Engineering Pvt. Ltd.','Example Engineering is a trusted pressure vessel manufacturer')).toBeNull();
    expect(junkFoundName('Example Institut za materiale',null)).toBe('institution');
    expect(junkFoundName('Pressure Vessel Fabrication',null)).toBe('service phrase, not a name');
    expect(relevantFound('ExampleWeb','ExampleWeb is a digital marketing agency for metal fabricators in Malaysia.',null,false)).toBe(false);
    expect(relevantFound('Example Vessels Sdn Bhd','Example Vessels builds pressure vessels to ASME standards.',null,false)).toBe(true);
  });
  it('marks sellers of the material as suppliers, not buyers',()=>{
    expect(looksLikeSupplier('At Example Steel Corporation, we supply high-strength steel plates')).toBe(true);
    expect(likelyRole('Example Steel Corporation','we supply high-strength steel plates')).toBe('supplier');
    expect(looksLikeSupplier('We fabricate pressure vessels from customer-supplied plate')).toBe(false);
    expect(relevantFound('Example Engineering Pvt. Ltd.','one of the most trusted pressure vessel manufacturers',null,false)).toBe(true);
    // A bare name in a contractor list is judged with the list's title.
    expect(relevantFound('Example Petro','Example Petro',null,false,'Top 10 Oil and Gas EPC Contractors in UAE')).toBe(true);
    expect(relevantFound('Example Petro','Example Petro',null,false,null)).toBe(false);
  });
  it('finds the own website from an acronym name',()=>{
    expect(officialSite('EXKR Engineering Pvt. Ltd.',[{url:'https://www.exkr.example/products/pressure-vessels'}])).toBeTruthy();
    expect(officialSite('E.X.K. Engineering Sdn. Bhd.',[{url:'https://exkengineering.example/'}])).toBeTruthy();
    expect(officialSite('Example Plantation Sdn Bhd',[{url:'https://exkengineering.example/clients'}])).toBeUndefined();
    // The short name in brackets is the brand in the domain.
    expect(officialSite('Saudi Arabian Oil Company (Aramco)',[{url:'https://en.wikipedia.org/wiki/Saudi_Aramco'},{url:'https://www.aramco.com/en'}])?.url).toBe('https://www.aramco.com/en');
    expect(officialSite('East Pipes Integrated Company for Industry (EPIC)',[{url:'https://epic.com.sa/'}])).toBeTruthy();
    expect(officialSite('Example Water Authority (Company)',[{url:'https://company.example/'}])).toBeUndefined();
  });
});

describe('list seeding',()=>{
  it('reads a company named on its own site without a search, and never looks up page furniture',async()=>{
    const id=await createResearchRun(input,db);
    const text='EXKR Engineering Pvt. Ltd. is one of the most trusted pressure vessel manufacturers.\nGoogle Ads\nWebsite designed by Example Web Solutions\nAt Example Steel Corporation, we supply high-strength steel plates.';
    const doc:RawDoc&{text:string}={sourceKey:'test',sourceName:'Example',tier:'B',url:'https://www.exkr.example/pressure-vessels',title:'Pressure vessels',publishedAt:null,text,isSample:false};
    const d=await storeDocument(db,id,doc);
    const companies=[
      {name:'EXKR Engineering Pvt. Ltd.',quote:'EXKR Engineering Pvt. Ltd. is one of the most trusted pressure vessel manufacturers.'},
      {name:'Google Ads',quote:'Google Ads'},
      {name:'Example Web Solutions',quote:'Website designed by Example Web Solutions'},
      {name:'Example Steel Corporation',quote:'At Example Steel Corporation, we supply high-strength steel plates.'},
    ];
    const seeded=await seedRoundup(db,id,input,{companies,dropped:0,warnings:[],found_via:{documentId:d.id,kind:'roundup'}},(await sessionFor(db,id))!.budget);
    expect(seeded).toMatchObject({seeded:4,lookups:0,queued:1});
    const own=(await db.query<{domain_hint:string;document_ids:string[]}>("select domain_hint,document_ids from research_candidates where company like 'EXKR%'")).rows[0];
    expect(own.domain_hint).toBe('exkr.example');expect(own.document_ids).toContain(d.id);
    expect((await db.query("select key from research_jobs where run_id=$1 and key like 'official:%'",[id])).rows).toHaveLength(0);
    const skipped=(await db.query<{company:string;reason:string}>("select company,reason from research_candidates where reason like 'Not looked up%' order by company")).rows;
    expect(skipped.map(s=>s.company)).toEqual(['Example Steel Corporation','Example Web Solutions','Google Ads']);
  });
});

describe('a fabricator\'s own client list',()=>{
  it('reads the fabricator and records its clients without looking them up',async()=>{
    const id=await createResearchRun(input,db);
    const text='Example Tank Metal fabricates storage tanks and pressure vessels.\nOur valued clients\nExample Oil LLC\nExample Diesel Trading LLC';
    const doc:RawDoc&{text:string}={sourceKey:'test',sourceName:'Example',tier:'B',url:'https://www.exampletankmetal.example/',title:'Example Tank Metal',publishedAt:null,text,isSample:false};
    const d=await storeDocument(db,id,doc);
    const companies=[{name:'Example Tank Metal',quote:'Example Tank Metal fabricates storage tanks and pressure vessels.'},{name:'Example Oil LLC',quote:'Example Oil LLC'},{name:'Example Diesel Trading LLC',quote:'Example Diesel Trading LLC'}];
    const seeded=await seedRoundup(db,id,input,{companies,dropped:0,warnings:[],found_via:{documentId:d.id,kind:'roundup'}},(await sessionFor(db,id))!.budget);
    expect(seeded).toMatchObject({seeded:3,lookups:0,queued:1});
    const clients=(await db.query<{reason:string}>("select reason from research_candidates where company like 'Example Oil%' or company like 'Example Diesel%'")).rows;
    expect(clients.every(c=>/client or partner/.test(c.reason))).toBe(true);
  });
});

describe('extra rounds',()=>{
  it('are not blocked by one malformed AI answer, and check found companies first',async()=>{
    vi.stubEnv('TAVILY_API_KEY','');
    const id=await createResearchRun(input,db);
    await db.query("update research_jobs set state='done',result='{}' where run_id=$1",[id]);
    await db.query("insert into research_jobs(run_id,stage,key,state,payload,error) values($1,'analyse','Example-failed','failed','{}'::jsonb,'Buyer response validation failed: companies.')",[id]);
    await db.query(`insert into research_jobs(run_id,stage,key,state,payload,result,priority) values
      ($1,'collect','official:Example','done','{"source":"roundup-website"}'::jsonb,'{"skipped":"Official-site query budget exhausted.","budgetLimited":true}'::jsonb,760),
      ($1,'collect','Example-capability','done','{"source":"tavily","sourcingLane":"capability"}'::jsonb,'{"skipped":"Tavily query budget","budgetLimited":true}'::jsonb,-100),
      ($1,'collect','Example-trigger','done','{"source":"tavily","sourcingLane":"trigger"}'::jsonb,'{"skipped":"Tavily query budget","budgetLimited":true}'::jsonb,2000)`,[id]);
    await finishIdleResearch(db,id);
    expect((await sessionFor(db,id))?.state).toBe('active');
    const order=(await db.query<{key:string}>("select key from research_jobs where run_id=$1 and state='queued' order by priority desc",[id])).rows.map(r=>r.key);
    expect(order).toEqual(['official:Example','Example-capability','Example-trigger']);
  });
});

describe('company websites must carry the distinctive name (web audit, 10 Oct)',()=>{
  it('does not match a short word inside another brand',()=>{
    expect(officialSite('O-GREEN',[{url:'https://www.ugreen.com/ar-sa/pages/about-ugreen'}])).toBeUndefined();
    expect(officialSite('Al Gharbia',[{url:'https://algharbiapipe.com'}])).toBeTruthy();
    expect(officialSite('Saudi Arabia Railways',[{url:'https://www.saudigulfprojects.com/'}])).toBeUndefined();
  });
});
