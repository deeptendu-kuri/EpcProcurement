// @vitest-environment node
import {afterAll,beforeAll,beforeEach,describe,it,expect} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {storeDocument} from '@/mvp/pipeline/read';
import pages from '@/mvp/sourcing/fixtures/capability-pages.json';
import {companyEvidence,opportunityEvidence,sourceCards,proofGroups} from './index';
let db:Db,company:string,doc:string,evidence:string;
const page=pages.documents[0];
const quote='Tekzone is among the leading cross-country pipeline contractors in the UAE, managing end-to-end pipeline installations for oil factories pipeline contractors.';
beforeAll(async()=>{db=await createTestDb();},120000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
  await db.exec('truncate runs,companies,source_documents cascade');
  const run=(await db.query<{id:string}>("insert into runs(status) values('done') returning id")).rows[0].id;
  company=(await db.query<{id:string}>("insert into companies(canonical_name,normalized_name,domain,types) values('Tekzone','tekzone','tekzoneme.com',array['epc_contractor']) returning id")).rows[0].id;
  doc=(await storeDocument(db,run,{...page,sourceKey:'fixture',sourceName:'Saved Tekzone original',tier:'B',publishedAt:null,isSample:false})).id;
  evidence=(await db.query<{id:string}>("insert into evidence(document_id,url,quote,extracted_by,quote_verified,tier,publisher_key) values($1,$2,$3,'rule:fixture',true,'B','tekzoneme.com') returning id",[doc,page.url,quote])).rows[0].id;
  await db.query("insert into fact_evidence(entity_type,entity_id,field,evidence_id) values('company',$1,'capability',$2)",[company,evidence]);
});
describe('WP7 verified evidence projection',()=>{
  it('groups quotes from the saved real page, preserving the original sentence and link',async()=>{
    const cards=await sourceCards(db,[evidence]);expect(cards).toHaveLength(1);expect(cards[0]).toMatchObject({url:page.url,domain:'tekzoneme.com',kind:'company_site',publishedAt:null});
    expect(cards[0].quotes[0].sentence).toContain(quote);expect(cards[0].quotes[0].highlight).toBe(quote);expect(cards[0].quotes[0].proves).toBe('material');
  });
  it('drops a quote when the stored original changes despite a previous verified flag',async()=>{
    await db.query("update source_documents set text='Example: original no longer contains this quote' where id=$1",[doc]);expect(await sourceCards(db,[evidence])).toEqual([]);expect(await companyEvidence(company,'all',db)).toBeNull();
  });
  it('does not present snippets, unverified quotes or sample documents as evidence',async()=>{
    await db.query('update evidence set quote_verified=false where id=$1',[evidence]);expect(await sourceCards(db,[evidence])).toEqual([]);
    await db.query('update evidence set quote_verified=true where id=$1',[evidence]);await db.query('update source_documents set is_sample=true where id=$1',[doc]);expect(await sourceCards(db,[evidence])).toEqual([]);
  });
  it('supports a sourced company without inventing an opportunity, award, contacts or HQ',async()=>{
    const view=await companyEvidence(company,'all',db);expect(view?.header).toMatchObject({name:'Tekzone',opportunityId:'',trigger:null,hqCountry:null,contactsFound:0,stage:'early'});
    expect(view?.why).toBe(quote);expect(view?.contacts.every(c=>c.person===null)).toBe(true);expect(view?.related).toEqual({above:[],below:[]});expect(view?.activity).toEqual([]);
  });
  it('returns null for a missing opportunity and classifies proof fields without new claims',async()=>{
    expect(await opportunityEvidence('11111111-1111-4111-8111-111111111111',db)).toBeNull();expect(proofGroups(['project_party.award_date','project_party.award_value','person.full_name'],quote)).toEqual(expect.arrayContaining(['date','value','people']));
  });
});
