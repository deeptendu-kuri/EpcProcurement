// @vitest-environment node
import {describe,it,expect} from 'vitest';
import type {RawDoc} from '@/mvp/pipeline/contracts';
import type {RunInput} from '@/mvp/types';
import {discoveryReadPriority,prioritiseDiscoveryDocs} from './routing';
const input:RunInput={query:'power cables',productId:'cables',markets:['AE'],leadKinds:['supply_subcontract']};
const doc=(url:string,title:string,preview=''):RawDoc=>({url,title,sourceKey:'tavily',sourceName:'test',tier:'C',publishedAt:null,text:null,isSample:false,research:{lane:'company',searchPreview:preview}});
describe('source routing without treating hints as facts',()=>{
  it('prioritises material-consuming contractor work over consulting, tenders and social posts',()=>{
    const buyer=doc('https://atlas.example/services','Atlas Contracting','Power cable installation and EPC construction');
    const consulting=doc('https://consult.example/services','Electrical services','Engineering consultancy and inspection services');
    const tender=doc('https://gov.example/tender','Invitation to bid','Power cable installation open tender');
    const social=doc('https://facebook.com/atlas','Power cable installation contractors');
    expect([consulting,tender,social].every(d=>discoveryReadPriority(buyer,input)>discoveryReadPriority(d,input))).toBe(true);
    expect(prioritiseDiscoveryDocs([social,tender,consulting,buyer],input)[0]).toBe(buyer);
    expect(buyer.text).toBeNull();
  });
  it('visits distinct companies before multiple URLs belonging to one company',()=>{
    const first=doc('https://atlas.example/services','Atlas contractor','Power cable installation');
    const duplicateDomain=doc('https://www.atlas.example/projects','Atlas contractor projects','Power cables');
    const other=doc('https://beta.example/','Beta electrical contracting');
    const ranked=prioritiseDiscoveryDocs([first,duplicateDomain,other,first],input);
    expect(ranked).toHaveLength(3);expect(new URL(ranked[1].url).hostname).toBe('beta.example');
  });
});
