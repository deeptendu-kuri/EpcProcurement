import {describe,it,expect} from 'vitest';
import {classifyPage} from './classify';
import {companyIdentityReason} from './entities';
import {pageCompany} from '@/mvp/research/investigation';
import {groundedCompanyBuyer} from '@/mvp/discovery/grounded';
import type {CompanyBundle} from '@/mvp/discovery/bundle';
const url='https://www.hindustantimes.com/cities/gurugram-news/gmda-awards-contract-for-200mld-water-pipeline-for-areas-along-dwarka-eway-101779325960661.html';
const title='GMDA awards contract for 200mld water pipeline for areas along Dwarka E-way | Hindustan Times';
// Exact source excerpt observed in live benchmark A; the speaker is not the publisher.
const quote='“We have also completed laying the missing pipeline under Dwarka Expressway, which will complete the network from Chandu Budhera plant to Sector 72 boosting station. The pipeline will be soon made operational and this will ensure water supply is made available in sectors 76 to 80,” said Verma.';
describe('live benchmark publisher-attribution regression',()=>{
  it('routes the real news URL to award extraction, never company capabilities',()=>{expect(classifyPage({url,title,text:quote})).toBe('article');expect(pageCompany('Hindustan Times\n'+quote,title,url)).toBeNull();});
  it('does not treat topic archives as original sources or company services',()=>{expect(classifyPage({url:'https://www.hindustantimes.com/topic/pipeline',title:'Pipeline: Get Latest News, Photos and Videos along with latest updates on Pipeline | Hindustan Times',text:quote})).toBe('junk');});
  it('never attributes a quoted official’s first-person work to the news publisher',()=>{
    const text='Hindustan Times\n'+quote;
    const bundle:CompanyBundle={candidate:{id:'Example-replay',key:'Example-replay',company:'Hindustan Times',domain_hint:'hindustantimes.com',identity_document_id:'Example-doc',identity_quote:'Hindustan Times',document_ids:['Example-doc'],state:'investigating'},documents:[{id:'Example-doc',url,text,tier:'B',content_hash:'Example-replay',is_sample:false}],hash:'Example-replay',text};
    expect(groundedCompanyBuyer(bundle,{query:'line pipe',productId:'line-pipe',markets:['IN'],leadKinds:['supply_subcontract']})).toBeNull();
  });
  it.each(['hindustantimes.com','www.hindustantimes.com','livemint.com','www.zawya.com'])('blocks publisher identities even with a corroborated domain or registry flag: %s',domain=>{expect(companyIdentityReason('Hindustan Times',{confirmedDomain:domain,registryRow:true})).toBe('publisher or personal/free-host domain');});
  it('keeps a real company’s own news page eligible as an award source, not a globally blocked host',()=>{expect(companyIdentityReason('KEC International',{confirmedDomain:'kecrpg.com'})).toBeNull();expect(classifyPage({url:'https://kecrpg.com/news/award',title:'KEC wins pipeline EPC contract',text:'KEC International won the pipeline EPC contract.'})).toBe('article');});
});
