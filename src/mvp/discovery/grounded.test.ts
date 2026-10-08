// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {groundedCompanyBuyer} from './grounded';
import type {CompanyBundle} from './bundle';
const input={query:'power cables',productId:'cables',markets:['AE'],leadKinds:['supply_subcontract' as const]};
function bundle(work:string,contact=''):CompanyBundle{
  const identity='Atlas Electrical LLC';
  const texts=[identity+'\nElectrical engineering contractor.',work,contact].filter(Boolean);
  const documents=texts.map((text,i)=>({id:String(i),url:'https://atlas.example/'+i,text,tier:'B' as const,content_hash:String(i),is_sample:false}));
  return {candidate:{id:'unit',key:'unit',company:identity,domain_hint:'atlas.example',identity_document_id:'0',identity_quote:null,document_ids:documents.map(d=>d.id),state:'investigating'},documents,text:texts.join('\n\n'),hash:'unit'};
}
describe('grounded first-party consuming companies without a compulsory AI request',()=>{
  it('keeps a real literal short identity and consuming capability with unknown project/date/contact',()=>{
    const result=groundedCompanyBuyer(bundle('We install power cables and electrical distribution systems.'),input);
    expect(result).toMatchObject({company:'Atlas Electrical LLC',role:'subcontractor',country:null,project:null,activityDate:null,confidence:0});
    expect(result?.productQuote).toBe('We install power cables and electrical distribution systems.');
  });
  it('preserves an original office location and excludes a clearly different market',()=>{
    const b=bundle('Our works include power cable installation.','Our office is in Dubai, United Arab Emirates.');
    expect(groundedCompanyBuyer(b,input)?.country).toBe('AE');
    expect(groundedCompanyBuyer(b,{...input,markets:['IN']})).toBeNull();
  });
  it.each(['We install optical fiber cables for telecom.','We sell power cables to contractors.','Our client Beta Engineering installs power cables.','Our services include power cable installation: job vacancy.','Our services fabricate electrical cables.','Our services provide engineering consultancy.'])('does not promote unsupported/sales/third-party work: %s',work=>{
    expect(groundedCompanyBuyer(bundle(work),input)).toBeNull();
  });
  it('still rejects a different named work subject and fabricated quote',()=>{
    expect(groundedCompanyBuyer(bundle('Beta Engineering provides power cable installation services.'),input)).toBeNull();
    const b=bundle('We install power cables for distribution systems.');b.candidate.company='Invented Electrical LLC';
    expect(groundedCompanyBuyer(b,input)).toBeNull();
  });
  it('does not attribute a roundup of other companies to the publishing company',()=>{
    const b=bundle('Our services include installation of power cables.');
    b.documents[1].url='https://atlas.example/electrical-contracting-companies-in-uae/';
    expect(groundedCompanyBuyer(b,input)).toBeNull();
  });
  it('uses the actual company service statement, not a branded article title or generic industry explanation',()=>{
    const b=bundle('Power Cable Installation Services - Atlas Electrical LLC\nProfessional cable installation services are important for power distribution.');
    expect(groundedCompanyBuyer(b,input)).toBeNull();
    b.documents.push({...b.documents[1],id:'service',url:'https://atlas.example/electrical-works',text:'Electrical Services - Atlas Electrical LLC\nOur services include installation of power cables and electrical distribution systems.'});
    b.text=b.documents.map(d=>d.text).join('\n\n');
    expect(groundedCompanyBuyer(b,input)?.productQuote).toBe('Our services include installation of power cables and electrical distribution systems.');
  });
  it('does not borrow a subsidiary office as the investigated company location',()=>{
    expect(groundedCompanyBuyer(bundle('Our works include power cable installation.','Our subsidiary is headquartered in Dubai, United Arab Emirates.'),input)?.country).toBeNull();
    expect(groundedCompanyBuyer(bundle('They offer a range of electrical installation services along with minor plumbing help.'),input)).toBeNull();
  });
});
