import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import CrmPage from './page';
import {filterTables} from '@/mvp/crm/tables';
import {exampleDataset,EXAMPLE_RUN} from '@/mvp/crm/fixtures';
const fixtures=vi.hoisted(()=>({data:undefined as unknown}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
vi.mock('@/mvp/opportunities',()=>({recentSearches:async()=>[{id:'11111111-1111-4111-8111-111111111111',created_at:'2026-10-08',adhoc_query:{productId:'line-pipe',query:'line pipe',markets:['AE']}}]}));
vi.mock('@/mvp/crm/tables',async original=>{const mod=await original<typeof import('@/mvp/crm/tables')>();return {...mod,crmTables:async(q:import('@/mvp/crm/contracts').TableQuery)=>mod.filterTables(fixtures.data as import('@/mvp/crm/tables').TableDataset,q)};});
vi.mock('@/components/mvp/search/lead-lists',()=>({AddToListDialog:()=>null}));
afterEach(()=>{cleanup();fixtures.data=undefined;});
async function show(params:Record<string,string>={}){fixtures.data??=exampleDataset(2);return render(await CrmPage({searchParams:Promise.resolve({search:EXAMPLE_RUN,...params})}));}
describe('search-scoped table CRM',()=>{
  it('defaults to the selected search and gives one clear results surface',async()=>{await show();expect((screen.getByLabelText('Search') as HTMLSelectElement).value).toBe(EXAMPLE_RUN);expect(screen.getAllByRole('table')).toHaveLength(1);expect(screen.getByRole('heading',{name:'Leads'})).toBeTruthy();});
  it('keeps missing contacts and blank optional fields without inventing a summary',async()=>{await show();expect(screen.getAllByText('Example Engineering 1 Limited')).toHaveLength(1);const cells=screen.getByRole('table').querySelectorAll('tbody tr')[0].querySelectorAll('td');expect(cells[4].textContent).toBe('');expect(cells[5].textContent).toBe('');expect(screen.getByText(/Missing contacts never hide a company/)).toBeTruthy();});
  it('hides rejected buyers except in explicit review history',async()=>{const data=exampleDataset();data.companies[0].qualification='rejected';fixtures.data=data;await show();expect(screen.queryByText('Example Engineering 1 Limited')).toBeNull();cleanup();await show({showRejected:'1'});expect(screen.getByText('Example Engineering 1 Limited')).toBeTruthy();});
  it('supports direct contacts/contractors links and does not confuse capability with active work',async()=>{await show({tab:'contractors'});expect(screen.getByText(/2 capability-only companies are under Leads/)).toBeTruthy();cleanup();await show({activity:'active'});expect(screen.queryByRole('table')).toBeNull();});
  it('rejects invalid filters and gives an escape route without querying arbitrary inputs',async()=>{await show({sort:'SQL injection'});expect(screen.getByRole('heading',{name:'Invalid lead filters'})).toBeTruthy();expect(screen.getByRole('link',{name:'Reset filters'})).toBeTruthy();expect(filterTables(exampleDataset(),(await import('@/mvp/crm/contracts')).tableQuerySchema.parse({})).total).toBe(1);});
});
