import type {ReactNode} from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {AppShell} from './app-shell';
const state=vi.hoisted(()=>({path:'/search'}));
vi.mock('next/navigation',()=>({usePathname:()=>state.path}));
vi.mock('../tour/tour-controller',()=>({TourController:()=>null}));
vi.mock('./global-search',()=>({GLOBAL_SEARCH_ID:'Example-search',GlobalSearch:()=>null}));
vi.mock('./toast',()=>({ToastProvider:({children}:{children:ReactNode})=>children}));
vi.mock('../api-client',()=>({apiJson:()=>Promise.resolve({lastFinishedAt:null,newGenuine:0,queue:{running:false,waiting:0,runId:null}})}));
afterEach(cleanup);
describe('demo navigation restoration',()=>{
  it.each(['/dashboard','/find','/crm','/outreach','/search'])('provides a guide without a duplicate global search action at %s',path=>{
    state.path=path;render(<AppShell demoMode={false} initialStatus={{lastFinishedAt:null,newGenuine:0,queue:{running:false,waiting:0,runId:null}}}>Example screen</AppShell>);
    const header=within(screen.getByRole('banner',{name:'Workspace header'}));
    expect(header.getByRole('button',{name:'Guide'})).toBeTruthy();
    expect(header.queryByRole('textbox')).toBeNull();expect(header.queryByRole('link',{name:'New search'})).toBeNull();
  });
  it('focuses the page-specific filter with slash',()=>{
    state.path='/crm';render(<AppShell demoMode={false} initialStatus={{lastFinishedAt:null,newGenuine:0,queue:{running:false,waiting:0,runId:null}}}><input aria-label="Example page filter" data-main-search /></AppShell>);
    fireEvent.keyDown(window,{key:'/'});expect(document.activeElement).toBe(screen.getByLabelText('Example page filter'));
  });
  it.each(['/crm','/search','/lists'])('shows Leads as the one active item for the SuperSearch layout at %s',path=>{state.path=path;render(<AppShell demoMode={false} initialStatus={{lastFinishedAt:null,newGenuine:0,queue:{running:false,waiting:0,runId:null}}}>Example screen</AppShell>);const nav=within(screen.getByRole('navigation',{name:'Main navigation'}));expect(nav.getByRole('link',{name:/Leads/}).getAttribute('aria-current')).toBe('page');expect(nav.queryByRole('link',{name:'SuperSearch'})).toBeNull();expect(nav.getByRole('link',{name:'Dashboard'}).getAttribute('aria-current')).toBeNull();});
  it('names the first screen Dashboard and keeps old Overview links active on it',()=>{state.path='/overview';render(<AppShell demoMode={false} initialStatus={{lastFinishedAt:null,newGenuine:0,queue:{running:false,waiting:0,runId:null}}}>Example screen</AppShell>);
    const nav=within(screen.getByRole('navigation',{name:'Main navigation'}));expect(nav.getByRole('link',{name:'Dashboard'}).getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('link',{name:'Find buyers'})).toBeTruthy();expect(nav.getByRole('link',{name:'Email & meetings'})).toBeTruthy();});
});
