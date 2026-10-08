import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {ResultsTables} from './results-tables';
import {filterTables} from '@/mvp/crm/tables';
import {exampleDataset} from '@/mvp/crm/fixtures';
import {tableQuerySchema} from '@/mvp/crm/contracts';
const push=vi.hoisted(()=>vi.fn());
vi.mock('next/navigation',()=>({useRouter:()=>({push,refresh:vi.fn()})}));
vi.mock('../search/lead-lists',()=>({AddToListDialog:()=> <div>Add to list dialog</div>}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
function show(tab='leads',n=2){const q=tableQuerySchema.parse({run:'all',tab});const data=filterTables(exampleDataset(n),q);return render(<ResultsTables data={data} query={q}/>);}
describe('WP6 four tables',()=>{
  it('shows one table, four tabs and only result countries',()=>{show();expect(screen.getAllByRole('table')).toHaveLength(1);expect(screen.getByRole('link',{name:'Contacts (14)'})).toBeTruthy();expect(screen.queryByRole('option',{name:'Norway'})).toBeNull();});
  it('preserves unknown date/value and contact cells and searched product',()=>{show();const cells=screen.getByRole('table').querySelectorAll('tbody tr')[0].querySelectorAll('td');expect(cells[4].textContent).toBe('');expect(cells[5].textContent).toBe('');expect(screen.getAllByText('Line pipe').length).toBeGreaterThan(0);});
  it('provides selection actions without starting email implicitly',()=>{show();fireEvent.click(screen.getByLabelText('Select this page'));expect(screen.getByRole('button',{name:'Start demo conversation'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Add to list'}));expect(screen.getByText('Add to list dialog')).toBeTruthy();});
  it('gives a useful Contractors empty state instead of blank results',()=>{show('contractors');expect(screen.getByText(/2 capability-only companies are under Leads/)).toBeTruthy();});
  it('shows honest missing-contact role slots and working Find/Add/Validate entry points',()=>{show('contacts');expect(screen.getAllByText('Not found')).toHaveLength(14);expect(screen.getAllByRole('link',{name:'Validate'})).toHaveLength(14);expect(screen.queryByText(/@example/)).toBeNull();});
  it('navigates sort and page-size changes without losing search context',()=>{show('leads',30);fireEvent.change(screen.getByLabelText('Rows per page'),{target:{value:'50'}});expect(push).toHaveBeenCalledWith(expect.stringContaining('size=50'));expect(push.mock.calls[0][0]).toContain('run=all');expect(screen.getByRole('link',{name:'Next'})).toBeTruthy();});
});
