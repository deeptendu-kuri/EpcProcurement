// @vitest-environment node
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {groundedCompanyBuyer} from '@/mvp/discovery/grounded';
import {buyerEvidence,saveBuyer} from '@/mvp/discovery';
import {capabilityLabel,countriesInQuote} from '@/mvp/discovery/locations';
import {storeDocument} from '@/mvp/pipeline/read';
import {loadBuyerRecords} from '@/mvp/buyers/load';
import type {CompanyBundle} from '@/mvp/discovery/bundle';
import {companyIdentityReason} from './entities';
import pages from './fixtures/capability-pages.json';
const names:Record<string,string>={'tekzoneme.com':'Tekzone','kecrpg.com':'KEC International','jandenul.com':'Jan De Nul','emc-global.com':'EMC Global','sasts.ae':'Sama Al Shahba','altawsa.com':'Al Tawsa Electrical Contracting','primeeleuae.com':'Prime Electrical'};
const host=(url:string)=>new URL(url).hostname.replace(/^www\./,'');
function bundle(domain:string):CompanyBundle {
  const documents=pages.documents.filter(d=>host(d.url)===domain).map(d=>({...d,tier:'B' as const,content_hash:d.id,is_sample:false}));
  return {candidate:{id:'fixture',key:'fixture',company:names[domain],domain_hint:domain,identity_document_id:documents[0].id,identity_quote:null,document_ids:documents.map(d=>d.id),state:'investigating'},documents,text:documents.map(d=>d.text).join('\n\n'),hash:'fixture'};
}
const input=(domain:string)=>({query:/tekzoneme|kecrpg/.test(domain)?'line pipe':'power and control cables',productId:/tekzoneme|kecrpg/.test(domain)?'line-pipe':'cables',markets:domain==='kecrpg.com'?['IN']:['AE'],leadKinds:['supply_subcontract' as const]});
let db:Db;
beforeAll(async()=>{db=await createTestDb();},120000);
afterAll(async()=>db.close());
describe('WP4 original A/B capability regressions (20 stored pages, not 20 invented buyers)',()=>{
  it.each(pages.documents)('$url remains original, and bundle facts have an original source',page=>{
    const domain=host(page.url);
    if(domain==='world-nuclear.org'){expect(companyIdentityReason('World Nuclear Association',{confirmedDomain:domain})).toBeTruthy();return;}
    const b=bundle(domain);const result=groundedCompanyBuyer(b,input(domain));
    expect(result,domain).not.toBeNull();
    expect(b.documents.some(d=>d.text.includes(result!.companyQuote))).toBe(true);
    expect(b.documents.some(d=>d.text.includes(result!.productQuote))).toBe(true);
    for(const c of result!.operatingCountries??[])expect(b.documents.some(d=>d.text.includes(c.quote))).toBe(true);
    expect(result!.activityDate).toBeNull();expect(result!.project).toBeNull();
  });
  it('KEC oil & gas pipeline EPC is positive; no invented HQ or award date',()=>{
    expect(groundedCompanyBuyer(bundle('kecrpg.com'),input('kecrpg.com'))).toMatchObject({company:'KEC International',country:null,operatingCountries:[{country:'IN'}],activityDate:null});
  });
  it('Jan De Nul qualifies for UAE work, without replacing a Belgian HQ',()=>{
    const b=bundle('jandenul.com');const result=groundedCompanyBuyer(b,input('jandenul.com'))!;
    expect(result?.operatingCountries).toEqual(expect.arrayContaining([expect.objectContaining({country:'AE'})]));
    expect(result?.country).not.toBe('AE');
    // Example HQ statement added ONLY to this explicitly synthetic scenario.
    const hq='Jan De Nul is headquartered in Belgium.';
    const exampleBundle={...b,text:b.text+'\n'+hq,documents:[...b.documents,{...b.documents[0],id:'Example-HQ',text:hq}]};
    const checked=buyerEvidence({...result,country:'BE',countryQuote:hq},exampleBundle.text,input('jandenul.com'),exampleBundle);
    expect(checked.buyer).toMatchObject({country:'BE',operatingCountries:expect.arrayContaining([expect.objectContaining({country:'AE'})])});
  });
  it.each(['United Arab Emirates','Key Players & More','World Nuclear Association','Norconsult','VALDEL EC','Cable Laying in UAE: Essential Services'])('rejects junk identity %s',name=>{
    expect(companyIdentityReason(name,{confirmedDomain:'example.com'})).toBeTruthy();
  });
  it('brands, queries and a country in the company name cannot create work geography',()=>{
    expect(countriesInQuote('Example India Works installs power cables for ADNOC.',['Example India Works'])).toEqual([]);
    expect(countriesInQuote('We install power cables in Abu Dhabi.')).toEqual(['AE']);
  });
  it('Tekzone and EMC labels come only from their verified activity quotes',()=>{
    const tek=groundedCompanyBuyer(bundle('tekzoneme.com'),input('tekzoneme.com'))!;
    const emc=groundedCompanyBuyer(bundle('emc-global.com'),input('emc-global.com'))!;
    expect(capabilityLabel('line-pipe',tek.productQuote)).toBe('Pipeline contractor');
    expect(capabilityLabel('cables',emc.productQuote)).toBe('HV cable installer');
  });
  it('persists literal work locations and activity labels, never fabricated validated contacts',async()=>{
    const b=bundle('tekzoneme.com');const i=input('tekzoneme.com');const buyer=groundedCompanyBuyer(b,i)!;
    const run=(await db.query<{id:string}>("insert into runs(status,adhoc_query) values('running',$1::jsonb) returning id",[JSON.stringify(i)])).rows[0].id;
    const raw={url:b.documents[0].url,title:pages.documents[0].title,text:b.documents[0].text,sourceKey:'saved-evaluation',sourceName:'Tekzone',tier:'B' as const,isSample:false,publishedAt:null};
    const doc=await storeDocument(db,run,raw);await db.query('insert into run_documents(run_id,document_id) values($1,$2)',[run,doc.id]);
    await saveBuyer(db,run,i,doc.id,raw,buyer,{...b,documents:[{...b.documents[0],id:doc.id}],text:raw.text});
    expect((await loadBuyerRecords({db}))[0].row.whatTheyDo).toBe('Pipeline contractor');
    expect((await db.query("select field from fact_evidence where field like 'operating_country:%'")).rows).toContainEqual({field:'operating_country:AE'});
    expect((await db.query('select text from source_documents where id=$1',[doc.id])).rows[0].text).toBe(raw.text);
    expect((await db.query("select id from contact_points where validation_status='valid'")).rows).toEqual([]);
  },30000);
});
