import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import LeadsPage from './page';
import type {SearchWorkspaceProps} from '@/components/mvp/search/search-workspace';

const LATEST='11111111-1111-4111-8111-111111111111';
const OLDER='22222222-2222-4222-8222-222222222222';
const seen=vi.hoisted(()=>({props:null as unknown}));
vi.mock('@/components/mvp/search/search-workspace',()=>({SearchWorkspace:(props:SearchWorkspaceProps)=>{seen.props=props;return <div data-testid="workspace">{props.foundCompanies}</div>;}}));
vi.mock('@/components/mvp/tables/found-companies',()=>({FoundCompanies:({runId}:{runId:string})=><p>found companies for {runId}</p>}));
vi.mock('@/components/mvp/search/page-data',()=>({catalogueOptions:()=>[],marketOptions:()=>[]}));
vi.mock('@/mvp/email/config',()=>({demoEmailEnabled:()=>true}));
vi.mock('@/mvp/opportunities',()=>({recentSearches:async()=>[
  {id:LATEST,status:'running',created_at:'2026-10-08T10:00:00Z',adhoc_query:{productId:'line-pipe',query:'steel pipe',markets:['AE','SA']}},
  {id:'33333333-3333-4333-8333-333333333333',status:'done',created_at:'2026-10-07T10:00:00Z',adhoc_query:null},
  {id:OLDER,status:'done',created_at:'2026-10-01T10:00:00Z',adhoc_query:{productId:'valves',query:'gate valves',markets:['AE','SA','QA','OM']}},
]}));
afterEach(()=>{cleanup();seen.props=null;});
async function show(params:Record<string,string>={}){render(await LeadsPage({searchParams:Promise.resolve(params)}));return seen.props as SearchWorkspaceProps;}

describe('Leads page (SuperSearch scoped to the user\'s searches)',()=>{
  it('opens on the latest search with its companies found in their own tab',async()=>{
    const props=await show();
    expect(props.basePath).toBe('/crm');
    expect(props.tab).toBe('search');
    expect(props.state.run).toBe(LATEST);
    expect(screen.getByText(`found companies for ${LATEST}`)).toBeTruthy();
  });
  it('labels each material search with its words, countries and date and skips searches without a product',async()=>{
    const props=await show();
    expect(props.runs?.map(r=>r.id)).toEqual([LATEST,OLDER]);
    expect(props.runs?.[0].label).toBe('steel pipe · UAE, Saudi Arabia · 8 Oct');
    expect(props.runs?.[1].label).toMatch(/^gate valves · .+… · 1 Oct$/);
  });
  it('keeps old ?search= links and explicit runs',async()=>{
    expect((await show({search:OLDER})).state.run).toBe(OLDER);
    cleanup();
    expect((await show({run:OLDER})).state.run).toBe(OLDER);
  });
  it('shows all searches without a found-companies panel',async()=>{
    const props=await show({run:'all'});
    expect(props.state.run).toBe('all');
    expect(props.foundCompanies).toBeNull();
  });
});
