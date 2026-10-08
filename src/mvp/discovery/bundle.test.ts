// @vitest-environment node
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {storeDocument} from '@/mvp/pipeline/read';
import {registerCandidate} from '@/mvp/research/investigation';
import {buyerEvidence,saveBuyer,type DiscoveredBuyer} from '.';
import {loadCompanyBundle,bundleScope} from './bundle';
import type {RunInput} from '@/mvp/types';
const identity='Atlas Electrical Contracting LLC is a specialist engineering contractor.';
const work='We install power cables and electrical distribution systems.';
const location='Our office is in Dubai, United Arab Emirates.';
const input:RunInput={query:'Power and control cables',productId:'cables',markets:['AE'],leadKinds:['supply_subcontract']};
const buyer:DiscoveredBuyer={company:'Atlas Electrical Contracting LLC',role:'subcontractor',country:'AE',companyQuote:identity,productQuote:work,countryQuote:location,confidence:.1,project:null,projectQuote:null};
let db:Db;beforeAll(async()=>{db=await createTestDb();},120000);afterAll(async()=>db.close());
async function fixture() {
  const run=(await db.query<{id:string}>("insert into runs(adhoc_query,status) values($1::jsonb,'running') returning id",[JSON.stringify(input)])).rows[0].id;
  await db.query("insert into research_sessions(run_id,budget) values($1,'{}')",[run]);
  const raw={sourceKey:'test',sourceName:'Synthetic',tier:'B' as const,url:'https://atlas.example/',title:null,publishedAt:null,text:identity,isSample:false};
  const home=await storeDocument(db,run,raw);const services=await storeDocument(db,run,{...raw,url:'https://atlas.example/services',text:work});
  const contact=await storeDocument(db,run,{...raw,url:'https://atlas.example/contact',text:location+'\nEmail: info@atlas.example\nTelephone: +971 4 555 0123'});
  for(const id of [home.id,services.id,contact.id])await db.query('insert into run_documents(run_id,document_id) values($1,$2)',[run,id]);
  const c=await registerCandidate(db,run,buyer.company,'atlas.example',home.id,identity);
  await db.query('update research_candidates set document_ids=$2::uuid[] where id=$1',[c.id,[home.id,services.id,contact.id]]);
  return {run,raw,home,bundle:(await loadCompanyBundle(db,run,c.id))!};
}
describe('company evidence bundles retain individual provenance',()=>{
  it('combines corroborated pages, preserves low-score companies and stores contacts as unvalidated',async()=>{
    const f=await fixture();expect(buyerEvidence(buyer,f.bundle.text,input,f.bundle).buyer).toBeTruthy();
    expect(await saveBuyer(db,f.run,input,f.home.id,f.raw,buyer,f.bundle)).toBe(true);
    const e=(await db.query<{url:string;quote:string}>('select e.url,e.quote from evidence e join fact_evidence f on f.evidence_id=e.id join search_opportunities o on o.company_id=f.entity_id where o.run_id=$1',[f.run])).rows;
    expect(e.find(x=>x.quote===work)?.url).toBe('https://atlas.example/services');
    expect(e.find(x=>x.quote===location)?.url).toBe('https://atlas.example/contact');
    expect((await db.query('select kind,value from public_company_contacts')).rows).toContainEqual({kind:'email',value:'info@atlas.example'});
    expect((await db.query('select id from contact_points')).rows).toEqual([]);
  });
  it('does not borrow named clients, another domain, project names or stitched quotes',async()=>{
    const f=await fixture();const other='Beta Engineering installs power cables in Dubai.';
    const foreign={...f.bundle.documents[1],text:other,url:'https://beta.example/services'};
    const bundle={...f.bundle,documents:[...f.bundle.documents,foreign],text:f.bundle.text+'\n'+other};
    expect(buyerEvidence({...buyer,productQuote:other},bundle.text,input,bundle).buyer).toBeNull();
    expect(bundleScope(bundle,other,[buyer.company])).toBeNull();
    expect(buyerEvidence({...buyer,productQuote:identity+'\n'+work},bundle.text,input,bundle).buyer).toBeNull();
    expect(buyerEvidence({...buyer,project:'Invented power project',projectQuote:'Not in sources'},f.bundle.text,input,f.bundle).buyer?.project).toBeNull();
  });
});
