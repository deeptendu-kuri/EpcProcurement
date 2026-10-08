import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {EvidenceDrawer,parseDrawerTarget} from './evidence-drawer';
import {EvidenceTables} from '../tables/evidence-tables';
import {SourceCard} from './source-card';
import {exampleDataset} from '@/mvp/crm/fixtures';
import {filterTables} from '@/mvp/crm/tables';
import {tableQuerySchema} from '@/mvp/crm/contracts';
import type {EvidenceDrawerView} from '@/mvp/buyers/types';
const api=vi.hoisted(()=>vi.fn());
vi.mock('../api-client',()=>({apiJson:api}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
vi.mock('../search/lead-lists',()=>({AddToListDialog:()=>null}));
const data=exampleDataset(2);const example:EvidenceDrawerView={header:data.companies[0].row,why:'Example: verified source sentence.',sources:[{documentId:'Example-doc',url:'https://example.com/Example',domain:'example.com',title:'Example saved source',publishedAt:null,kind:'company_site',quotes:[{evidenceId:'Example-proof',sentence:'Example: verified source sentence.',highlight:'verified source',proves:'material'}]}],related:{above:[],below:[]},contacts:data.companies[0].team,activity:[]};
afterEach(()=>{cleanup();vi.clearAllMocks();window.history.replaceState({},'','/');});
describe('WP7 universal evidence drawer',()=>{
  it('shows the source sentence with a highlight, workspace and honest role slots',()=>{render(<EvidenceDrawer target={{opportunityId:example.header.opportunityId}} initial={example} onClose={()=>{}}/>);expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByText('verified source',{selector:'mark'})).toBeTruthy();expect(screen.getByRole('link',{name:'Open workspace'})).toBeTruthy();expect(screen.getAllByText(/Not found/)).toHaveLength(7);expect(api).not.toHaveBeenCalled();});
  it('supports j/k/Esc but does not navigate while typing',()=>{const next=vi.fn(),prev=vi.fn(),close=vi.fn();render(<><input aria-label="Example note"/><EvidenceDrawer target={{opportunityId:example.header.opportunityId}} initial={example} onClose={close} onNext={next} onPrevious={prev}/></>);fireEvent.keyDown(window,{key:'j'});fireEvent.keyDown(window,{key:'k'});fireEvent.keyDown(screen.getByLabelText('Example note'),{key:'j'});fireEvent.keyDown(window,{key:'Escape'});expect(next).toHaveBeenCalledOnce();expect(prev).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();});
  it('validates shared drawer URL state and rejects executable or malformed targets',()=>{expect(parseDrawerTarget(example.header.opportunityId)).toEqual({opportunityId:example.header.opportunityId,run:undefined});expect(parseDrawerTarget('javascript:alert(1)')).toBeNull();expect(parseDrawerTarget('company:bad')).toBeNull();});
  it('does not render unmatched highlights or executable source links',()=>{render(<SourceCard source={{...example.sources[0],url:'javascript:alert(1)',quotes:[{...example.sources[0].quotes[0],highlight:'Not in the original sentence'}]}}/>);expect(screen.queryByRole('link')).toBeNull();expect(screen.queryByText('Not in the original sentence')).toBeNull();});
  it.each(['leads','contractors','subcontractors','contacts'] as const)('opens the same drawer from %s and persists the URL without starting mail',async tab=>{
    api.mockResolvedValue(example);const q=tableQuerySchema.parse({run:'all',tab}),fixture=exampleDataset(2);
    fixture.companies[0].row.trigger={...fixture.companies[0].row.trigger!,kind:'award'};
    fixture.chain=[{row:{companyId:fixture.companies[1].row.companyId,name:fixture.companies[1].row.name,supplies:'Example pipeline work',linkedToCompanyId:fixture.companies[0].row.companyId,linkedToName:fixture.companies[0].row.name,link:'possible',country:'AE',sellSummary:'Line pipe',contactsFound:0,contactsTotal:7,sourceCount:1},contacts:[],opportunityId:fixture.companies[1].row.opportunityId}];
    render(<EvidenceTables data={filterTables(fixture,q)} query={q}/>);const row=screen.getByRole('table').querySelector('tbody tr')!;fireEvent.click(row.querySelector('button')!);await waitFor(()=>expect(screen.getByRole('dialog')).toBeTruthy());expect(window.location.search).toContain('open=');expect(api.mock.calls.every(([url])=>String(url).startsWith('/api/mvp/evidence/'))).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(window.location.search).not.toContain('open=');
  });
});
