// @vitest-environment node
import {describe,it,expect,vi,afterEach} from 'vitest';
import type {BuyerRecord} from './view';
import type {Queryable} from '@/mvp/db';
import {matches,buildFacets} from './search';
import {parseBuyerSearch} from './schema';
import {hybridSearchRecords} from './hybrid';
import {exampleCompany} from '@/mvp/crm/fixtures';
const provider=vi.hoisted(()=>vi.fn());
vi.mock('@/mvp/sourcing/triggers',async original=>({...await original<object>(),triggersForCompany:provider}));
afterEach(()=>vi.resetAllMocks());
function record():BuyerRecord{
  const c=exampleCompany();return {row:{...c.row},view:{leadId:c.row.opportunityId,companyId:c.row.companyId,stage:'early',sellItems:[{itemId:'line-pipe'}]},competitorForAll:false,leadStatus:'new',createdAt:'2026-10-08',groupKey:'Example',hqCountry:'BE',siteCountry:'AE'} as unknown as BuyerRecord;
}
describe('WP8 hybrid SuperSearch projections',()=>{
  it('never casts a derived lead key as a database UUID and scopes it through its root',async()=>{
    const r=record();const root=r.view.leadId;r.view.leadId='derived:Example';r.derived={key:'Example',rootLeadId:root,link:'possible'};
    provider.mockResolvedValue([]);const query=vi.fn().mockResolvedValue({rows:[{id:root,client_product_ids:['line-pipe']}]});
    await hybridSearchRecords([r],{query} as unknown as Queryable);
    expect(query.mock.calls[0][1]).toEqual([[root]]);expect(provider).toHaveBeenCalledWith(expect.anything(),r.view.companyId,undefined,'line-pipe');
  });
  it('never uses fetch/created date to pass a dated trigger filter',()=>{
    const r=record();expect(matches(r,{triggers:{withinDays:90}},new Date('2026-10-08'))).toBe(false);
    expect(matches(r,{triggers:{undated:true}},new Date('2026-10-08'))).toBe(true);
    r.row.trigger={...exampleCompany().row.trigger!,kind:'award',date:'2026-09-28'};
    expect(matches(r,{triggers:{kinds:['award'],withinDays:90}},new Date('2026-10-08'))).toBe(true);
    r.row.trigger.date='2027-01-01';expect(matches(r,{triggers:{withinDays:90}},new Date('2026-10-08'))).toBe(false);
  });
  it('counts actual trigger facets and rejects arbitrary kinds/recipient parameters',()=>{
    const r=record();r.view.sellItems=[];r.view.team=[];r.view.howSure='low';r.view.reach={email:'allowed'} as never;r.view.role='epc_contractor';r.signals=[];
    expect(buildFacets([r],{},new Date('2026-10-08')).triggers).toEqual([{value:'capability',label:'Capability only',count:1}]);
    expect(parseBuyerSearch({triggers:{kinds:['made-up']}}).ok).toBe(false);
    expect(parseBuyerSearch({triggers:{recipient:'example@example.com'}}).ok).toBe(false);
  });
  it('hydrates only the products attached to the lead, preserving HQ geography',async()=>{
    const r=record();provider.mockResolvedValue([exampleCompany().row.trigger]);
    const db={query:vi.fn().mockResolvedValue({rows:[{id:r.view.leadId,client_product_ids:['line-pipe']}]})} as unknown as Queryable;
    const [result]=await hybridSearchRecords([r],db);
    expect(provider).toHaveBeenCalledWith(db,r.view.companyId,undefined,'line-pipe');expect(provider).toHaveBeenCalledTimes(1);
    expect(result.row.trigger?.kind).toBe('capability');expect(result.hqCountry).toBe('BE');expect(result.siteCountry).toBe('AE');
  });
});
