// @vitest-environment node
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {storeDocument} from '@/mvp/pipeline/read';
import {persistRoundupAwards} from '@/mvp/sourcing/roundup-triggers';
import {verifyRoundup} from '@/mvp/sourcing/roundup';
import {crmTables,filterTables} from './tables';
import {tableQuerySchema} from './contracts';
import {exampleCompany,exampleDataset,EXAMPLE_RUN} from './fixtures';
import {csvCell} from '@/components/mvp/tables/export';
let db:Db,run:string;
beforeAll(async()=>{db=await createTestDb();},120000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{await db.exec('truncate runs,companies,source_documents cascade');run=(await db.query<{id:string}>("insert into runs(status) values('running') returning id")).rows[0].id;});
const query=(q:Record<string,unknown>={})=>tableQuerySchema.parse({run:EXAMPLE_RUN,...q});
async function seed(){
  const text='Example Engineering Limited won a gas pipeline contract in UAE on 28 September 2026 for USD 20 million.';
  const doc=await storeDocument(db,run,{sourceKey:'fixture',sourceName:'Example saved page',tier:'B',url:'https://example.com/Example-award',title:'Example award',text,publishedAt:null,isSample:false});
  const roundup=verifyRoundup({companies:[{name:'Example Engineering Limited',quote:text,role:'contractor',date:{text:'28 September 2026',quote:text},value:{text:'USD 20 million',quote:text}}]},text,doc.id);
  await persistRoundupAwards(db,run,{query:'line pipe',productId:'line-pipe',markets:['AE'],leadKinds:['supply_subcontract'],contactRole:'buyer'},roundup);
  return doc;
}
describe('WP6 table read model',()=>{
  it('traverses two source-proven chain hops, dedupes contacts and does not follow cycles',async()=>{
    const doc=await seed();const parent=(await db.query<{company_id:string}>('select company_id from search_opportunities')).rows[0].company_id;
    const child=(await db.query<{id:string}>("insert into companies(canonical_name,normalized_name,types) values('Example Subcontractor Limited','example subcontractor',array['subcontractor']) returning id")).rows[0].id;
    const supplier=(await db.query<{id:string}>("insert into companies(canonical_name,normalized_name,types) values('Example Supplies Limited','example supplies',array['supplier']) returning id")).rows[0].id;
    for(const [from,to,quote] of [[parent,child,'Example Subcontractor Limited received a pipeline subcontract from Example Engineering Limited in UAE.'],[child,supplier,'Example Supplies Limited supplied Example Subcontractor Limited in UAE.'],[supplier,parent,'Example Engineering Limited supplied Example Supplies Limited in UAE.']]){
      await db.query('update source_documents set text=text||$2 where id=$1',[doc.id,'\n'+quote]);
      const proof=(await db.query<{id:string}>("insert into evidence(document_id,url,quote,extracted_by,quote_verified,tier,publisher_key) values($1,'https://example.com/Example-award',$2,'rule:Example',true,'B','example.com') returning id",[doc.id,quote])).rows[0].id;
      await db.query("insert into chain_links(parent_company_id,supplier_type,company_id,action,strength,evidence_ids) values($1,'subcontractor',$2,'set','confirmed',$3::uuid[])",[from,to,[proof]]);
    }
    const result=await crmTables(query({run,tab:'subcontractors',company:parent}),db);
    expect(result.total).toBe(2);expect(result.rows).toEqual(expect.arrayContaining([expect.objectContaining({name:'Example Supplies Limited',linkedToName:'Example Subcontractor Limited'})]));
    const contacts=await crmTables(query({run,tab:'contacts',company:parent}),db);expect(contacts.rows.some(r=>'tier' in r&&r.tier===3)).toBe(true);
  });
  it('returns one product-scoped award row with verified value/date/country and empty contacts',async()=>{
    await seed();const result=await crmTables(query({run}),db,new Date('2026-10-08'));
    expect(result.total).toBe(1);expect(result.rows[0]).toMatchObject({name:'Example Engineering Limited',operatingCountry:'AE',hqCountry:null,sellSummary:'line pipe',contactsFound:0,sourceCount:1,trigger:{kind:'award',date:'2026-09-28',valueUsd:20e6}});
    expect(result.facets.countries).toEqual(['AE']);expect(result.facets.counts.contractors).toBe(1);
  });
  it('exposes at least ten honest role slots across two companies, never invented people',()=>{
    const result=filterTables(exampleDataset(2),query({tab:'contacts'}));
    expect(result.total).toBeGreaterThanOrEqual(10);expect(result.rows.every(r=>'person' in r&&r.person===null)).toBe(true);
  });
  it('does not expose stored emails without fresh provider checks or current role confirmation',async()=>{
    await seed();const company=(await db.query<{company_id:string}>('select company_id from search_opportunities')).rows[0].company_id;
    const p=(await db.query<{id:string}>("insert into people(full_name,normalized_name,current_company_id,title) values('Example Person','example person',$1,'Procurement Manager') returning id",[company])).rows[0].id;
    await db.query("insert into contact_points(person_id,kind,value,source) values($1,'email','example@example.com','manual')",[p]);
    const result=await crmTables(query({run,tab:'contacts'}),db);
    expect(JSON.stringify(result)).not.toContain('example@example.com');expect(result.rows.every(r=>'email' in r&&r.email===null)).toBe(true);
  });
  it('rechecks original text even if quote_verified was previously true',async()=>{
    const doc=await seed();await db.query("update source_documents set text='Example: removed original' where id=$1",[doc.id]);
    expect((await crmTables(query({run}),db)).total).toBe(0);
  });
  it('reveals an email only for a source-backed person, valid provider check and current reviewed role',async()=>{
    const doc=await seed();const company=(await db.query<{company_id:string}>('select company_id from search_opportunities')).rows[0].company_id;
    const quote='Example Person is Procurement Manager at Example Engineering Limited.';
    await db.query('update source_documents set text=text||$2 where id=$1',[doc.id,'\n'+quote]);
    const person=(await db.query<{id:string}>("insert into people(full_name,normalized_name,current_company_id,title,confirmed_at) values('Example Person','example person',$1,'Procurement Manager',now()) returning id",[company])).rows[0].id;
    const evidence=(await db.query<{id:string}>("insert into evidence(document_id,url,quote,extracted_by,quote_verified,tier,publisher_key) values($1,'https://example.com/Example-award',$2,'rule:Example',true,'B','example.com') returning id",[doc.id,quote])).rows[0].id;
    await db.query("insert into fact_evidence(entity_type,entity_id,field,evidence_id) values('person',$1,'full_name',$2)",[person,evidence]);
    await db.query("insert into person_roles(person_id,company_id,buying_role) values($1,$2,'procurement_lead')",[person,company]);
    await db.query("insert into contact_points(person_id,kind,value,source,validation_status,verified_at) values($1,'email','example@example.com','provider:emailable:verifier','valid',now())",[person]);
    expect(JSON.stringify(await crmTables(query({run,tab:'contacts'}),db))).toContain('example@example.com');
    await db.query('update person_roles set end_date=current_date where person_id=$1',[person]);
    expect(JSON.stringify(await crmTables(query({run,tab:'contacts'}),db))).not.toContain('example@example.com');
  });
  it('scopes by search, permits an explicit all view and rejects arbitrary SQL sort/recipient inputs',async()=>{
    await seed();expect((await crmTables(query(),db)).total).toBe(0);expect((await crmTables(query({run:'all'}),db)).total).toBe(1);
    expect(tableQuerySchema.safeParse({sort:'value;drop table companies'}).success).toBe(false);
    expect(tableQuerySchema.safeParse({recipient:'example@example.com'}).success).toBe(false);
    expect(tableQuerySchema.safeParse({size:1000}).success).toBe(false);
  });
  it('reads sourced stored chain links, preserves work geography and honours their removal',async()=>{
    const doc=await seed();const parent=(await db.query<{company_id:string}>('select company_id from search_opportunities')).rows[0].company_id;
    const child=(await db.query<{id:string}>("insert into companies(canonical_name,normalized_name,types) values('Example Subcontractor Limited','example subcontractor',array['subcontractor']) returning id")).rows[0].id;
    const quote='Example Subcontractor Limited received a gas pipeline subcontract from Example Engineering Limited in UAE.';
    await db.query('update source_documents set text=text||$2 where id=$1',[doc.id,'\n'+quote]);
    const evidence=(await db.query<{id:string}>("insert into evidence(document_id,url,quote,extracted_by,quote_verified,tier,publisher_key) values($1,'https://example.com/Example-award',$2,'rule:Example',true,'B','example.com') returning id",[doc.id,quote])).rows[0].id;
    const link=(await db.query<{id:string}>("insert into chain_links(parent_company_id,supplier_type,company_id,action,strength,evidence_ids) values($1,'pipeline_builder',$2,'set','confirmed',$3::uuid[]) returning id",[parent,child,[evidence]])).rows[0].id;
    const result=await crmTables(query({run,tab:'subcontractors'}),db);expect(result.total).toBe(1);expect(result.rows[0]).toMatchObject({name:'Example Subcontractor Limited',link:'confirmed',country:'AE',contactsFound:0,sourceCount:1});
    await db.query("update chain_links set action='removed' where id=$1",[link]);expect((await crmTables(query({run,tab:'subcontractors'}),db)).total).toBe(0);
  });
  it('hides rejected records by default, preserves explicit history and does not gate on contacts',()=>{
    const data=exampleDataset(2);data.companies[1].qualification='rejected';
    expect(filterTables(data,query()).total).toBe(1);expect(filterTables(data,query({showRejected:'1'})).total).toBe(2);
    expect(filterTables(data,query({contacts:'named'})).total).toBe(0);
  });
  it('uses actual contact roles and documented active work, not requested search role or score',()=>{
    const data=exampleDataset(2);data.companies[0].row.fitScore=100;data.companies[1].activity='ongoing';
    data.companies[1].contacts[0].person={id:'Example-person',name:'Example Person',title:'Example director',evidenceIds:[]};
    expect(filterTables(data,query({activity:'active'})).rows[0]).toMatchObject({name:data.companies[1].row.name});
    expect(filterTables(data,query({contactRole:'decision_maker'})).total).toBe(1);
    expect(filterTables(data,query({contactRole:'buyer'})).total).toBe(0);
  });
  it('filters operating country/product/trigger/age and sorts/paginates deterministically',()=>{
    const data=exampleDataset(30);data.companies[0].row.operatingCountry='IN';
    expect(filterTables(data,query({country:'IN'})).total).toBe(1);
    expect(filterTables(data,query({product:'cables'})).total).toBe(0);
    expect(filterTables(data,query({trigger:'award'})).total).toBe(0);
    expect(filterTables(data,query({age:'undated',page:2,size:25})).rows).toHaveLength(5);
    const c=exampleCompany(50);c.row.fitScore=99;data.companies.push(c);
    expect(filterTables(data,query({sort:'fit_desc'})).rows[0]).toMatchObject({fitScore:99});
  });
  it('keeps capability-only companies out of Contractors and does not manufacture supply-chain links',()=>{
    const result=filterTables(exampleDataset(3),query({tab:'contractors'}));expect(result.total).toBe(0);expect(result.facets.capabilityOnly).toBe(3);expect(result.facets.counts.subcontractors).toBe(0);
  });
  it('neutralises CSV formulas and escapes quotes without inventing blanks',()=>{
    expect(csvCell('=cmd()')).toBe('"\'=cmd()"');expect(csvCell('a"b')).toBe('"a""b"');expect(csvCell(null)).toBe('""');
  });
});
