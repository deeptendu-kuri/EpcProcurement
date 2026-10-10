// @vitest-environment node
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {htmlToText} from '@/mvp/pipeline/read';
import {directorySeeds,pageCompany,companyPageLinks,queueRead,candidatePageIdentity} from './investigation';
import {readLaneLimits,sourceSeeds} from './registry';
import type {RawDoc} from '@/mvp/pipeline/contracts';
let db:Db;
beforeAll(async()=>{
  db=await createTestDb();
  // Load the lazy DOM parser during setup, not inside the first assertion's
  // timeout. Cold module loading on OneDrive can dominate fixture parsing.
  await htmlToText('<html><body>Parser setup</body></html>','https://setup.example',true);
},120000);afterAll(async()=>db.close());
describe('source-aware company investigations',()=>{
  it('keeps all directory rows beyond five, excluding consultants and unrelated specialisations',async()=>{
    const header='<tr><th>Company Name</th><th>Trade License</th><th>Email</th><th>Builder Category</th><th>Builder Type</th></tr>';
    const rows=Array.from({length:11},(_,i)=>`<tr><td>Test ${i} Electrical Contracting LLC</td><td>${100+i}</td><td>info@company${i}.example</td><td>Contractor</td><td>Electrical</td></tr>`).join('');
    const other='<tr><td>Other Consultants LLC</td><td>123</td><td>info@other.example</td><td>Consultant</td><td>Electrical</td></tr>';
    const page=await htmlToText(`<html><body><table>${header}${rows}${other}</table></body></html>`,'https://directory.example',true);
    const seeds=directorySeeds(page.text,'cables');expect(seeds).toHaveLength(11);
    expect(seeds[9]).toMatchObject({company:'Test 9 Electrical Contracting LLC',domain:'company9.example'});
    expect(seeds[9].quote).not.toContain('company8.example');expect(seeds[9].quote).not.toContain('company10.example');
  },15000);
  it('does not guess company websites from personal inboxes or count seeds as buyers',()=>{
    const text='Company Name | Builder Category | Builder Type\nReal Electrical LLC | Contractor | Electrical | person@gmail.com';
    expect(directorySeeds(text,'cables')[0].domain).toBeNull();
    expect(directorySeeds(text,'cables')[0]).not.toHaveProperty('qualified');
  });
  it('uses page-brand names, not provider titles or a news publisher as company identity',()=>{
    const text='Atlas Electrical Contracting LLC\nWe install power cables.';
    expect(pageCompany(text,'Services | Atlas Electrical Contracting LLC','https://atlas.example/services')).toBe('Atlas Electrical Contracting LLC');
    // A title naming another company is never used; the name written on the site's own page is.
    expect(pageCompany(text,'Beta Engineering LLC','https://atlas.example')).toBe('Atlas Electrical Contracting LLC');
    expect(pageCompany(text,'Atlas Electrical Contracting LLC','https://economictimes.indiatimes.com/news')).toBeNull();
  });
  it('does not turn service headings into company names and recognises literal short brands on their own domain',()=>{
    expect(pageCompany('Electrical engineering services | Applus+ UAE\nWe provide engineering services.','Electrical engineering services | Applus+ UAE','https://www.applus.com/ae/services')).toBe('Applus+ UAE');
    expect(pageCompany('Third-Party Electrical Inspection Services in UAE and GCC | Cornerstone','Third-Party Electrical Inspection Services in UAE and GCC | Cornerstone','https://www.cornerstonemiddleeast.com/solutions')).toBe('Cornerstone');
    expect(pageCompany('Electrical Design up to 33 kV | Khabir MEP, RAK','Electrical Design up to 33 kV | Khabir MEP, RAK','https://khabirconsultant.ae/services')).toBe('Khabir MEP, RAK');
    expect(pageCompany('Electrical engineering services','Electrical engineering services','https://unrelated.example')).toBeNull();
    expect(pageCompany('Third-Party Electrical Inspection Services in UAE and GCC','Third-Party Electrical Inspection Services in UAE and GCC','https://unrelated.example')).toBeNull();
    expect(pageCompany('Cable Laying in UAE: Essential Services for a Reliable Power Infrastructure - Sama Al Shahba','Cable Laying in UAE: Essential Services for a Reliable Power Infrastructure - Sama Al Shahba','https://sasts.ae/cable-laying-in-uae/')).toBe('Sama Al Shahba');
    expect(pageCompany('Cable Laying in UAE: Essential Services for a Reliable Power Infrastructure','Cable Laying in UAE: Essential Services for a Reliable Power Infrastructure','https://sasts.ae/cable-laying-in-uae/')).toBeNull();
    expect(pageCompany('HVDC project | Jan De Nul','HVDC project | Jan De Nul','https://jandenul.com/our-projects/hvdc')).toBe('Jan De Nul');
  });
  it('restricts follow-ups to useful same-domain pages, without files, queries or login routes',()=>{
    const links=[{url:'https://atlas.example/services',text:'Services'},{url:'https://atlas.example/contact',text:'Contact'},
      {url:'https://other.example/services',text:'Services'},{url:'https://atlas.example/x.zip',text:'Projects'},
      {url:'https://atlas.example/projects?token=1',text:'Projects'}];
    expect(companyPageLinks(links,'atlas.example').map(l=>l.url)).toEqual(['https://atlas.example/services','https://atlas.example/contact']);
  });
  it('does not corroborate a different subsidiary or invented acronym',()=>{
    const candidate={company:'Atlas Electrical Contracting LLC'} as Parameters<typeof candidatePageIdentity>[0];
    expect(candidatePageIdentity(candidate,'Atlas Electrical Contracting installs cables.')).toBe(true);
    expect(candidatePageIdentity(candidate,'Atlas Mechanical Contracting LLC installs cables.')).toBe(false);
    expect(candidatePageIdentity(candidate,'AEC installs cables.')).toBe(false);
  });
  it('reserves official investigation capacity instead of filling every slot with general results',async()=>{
    const run=(await db.query<{id:string}>("insert into runs(status) values('queued') returning id")).rows[0].id;
    await db.query("insert into research_sessions(run_id,budget) values($1,'{}')",[run]);
    const raw=(i:number,lane:'company'|'investigation'):RawDoc=>({sourceKey:'test',sourceName:'Test',tier:'C',url:`https://company${i}.example/`,title:null,publishedAt:null,text:null,isSample:false,research:{lane}});
    const limits=readLaneLimits(60);expect(limits.investigation).toBe(30);
    for(let i=0;i<30;i++)await db.tx(tx=>queueRead(tx,run,raw(i,'company'),{maxPages:60}));
    expect((await db.query('select id from research_jobs where run_id=$1',[run])).rows).toHaveLength(limits.discovery);
    expect(await db.tx(tx=>queueRead(tx,run,raw(99,'investigation'),{maxPages:60}))).toBe(true);
    expect(await db.tx(tx=>queueRead(tx,run,raw(99,'investigation'),{maxPages:60}))).toBe(true);
    expect((await db.query('select id from research_jobs where run_id=$1',[run])).rows).toHaveLength(limits.discovery+1);
  });
  it('selects relevant permitted sources, not a cables directory for unrelated markets',()=>{
    const base={query:'cables',productId:'cables',leadKinds:['supply_subcontract' as const]};
    expect(sourceSeeds({...base,markets:['AE']}).some(s=>s.research?.registryId==='dewa-contractor-list')).toBe(true);
    const india=sourceSeeds({...base,markets:['IN']});expect(india).toHaveLength(3);expect(india.some(s=>s.research?.registryId==='dewa-contractor-list')).toBe(false);
  });
});

describe('company names from company pages (elbow search, 10 Oct)',()=>{
  it('takes the company, not the service, from a page title',()=>{
    expect(pageCompany('ESC Group provides general fabrication and welding in the UAE.','General Fabrication & Welding | ESC Group | United Arab Emirates','https://www.escpiling.com/general-fabrication-welding')).toBe('ESC Group');
    expect(pageCompany('SJS Enersol carries out piping fabrication for oil and gas plants.','Piping Fabrication - UAE','https://sjsenersol.com/piping-fabrication/')).toBe('SJS Enersol');
    expect(pageCompany('We process and fabricate custom wear parts.','Processing and fabrication of custom wear parts in UAE - SSAB','https://www.ssab.com/en/services/processing')).toBeNull();
  });
  it('never takes a company from a job advert or a recruitment site',()=>{
    expect(pageCompany('Progressive is hiring a Project Manager Fabrication in Saudi Arabia.','Project Manager Fabrication (4069395) | Progressive','https://www.progressiverecruitment.com/en-sa/job/project-manager-fabrication/4069395/')).toBeNull();
    expect(pageCompany('Example Steel Works LLC is hiring welders.','Welder | Example Steel Works LLC','https://examplesteel.example/careers/welder')).toBeNull();
  });
  it('keeps real company titles working',()=>{
    expect(pageCompany('Embark Contracting Est provides piping and structural fabrication.','Piping and Structural Fabrication Company in Saudi Arabia| Embark Contracting Est','https://embarkgroups.com/services/3134')).toBe('Embark Contracting Est');
    expect(pageCompany('DONEM Steel Saudi Arabia offers industrial fabrication.','Industrial Fabrication & Engineering Services | DONEM Steel Saudi Arabia','https://www.donem-steel.com/services')).toBe('DONEM Steel Saudi Arabia');
  });
});
