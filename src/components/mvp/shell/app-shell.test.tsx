import type {ReactNode} from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import {AppShell} from './app-shell';
const state=vi.hoisted(()=>({path:'/search'}));
vi.mock('next/navigation',()=>({usePathname:()=>state.path}));
vi.mock('../tour/tour-controller',()=>({TourController:()=>null}));
vi.mock('./global-search',()=>({GLOBAL_SEARCH_ID:'Example-search',GlobalSearch:()=>null}));
vi.mock('./toast',()=>({ToastProvider:({children}:{children:ReactNode})=>children}));
vi.mock('../api-client',()=>({apiJson:()=>Promise.resolve({lastFinishedAt:null,newGenuine:0,queue:{running:false,waiting:0,runId:null}})}));
afterEach(cleanup);
describe('demo navigation restoration',()=>{
  it.each(['/search','/lists'])('keeps SuperSearch visible and uniquely active at %s',path=>{state.path=path;render(<AppShell demoMode={false} initialStatus={{lastFinishedAt:null,newGenuine:0,queue:{running:false,waiting:0,runId:null}}}>Example screen</AppShell>);const nav=within(screen.getByRole('navigation',{name:'Main navigation'}));expect(nav.getByRole('link',{name:'SuperSearch'}).getAttribute('aria-current')).toBe('page');expect(nav.getByRole('link',{name:'Leads'}).getAttribute('aria-current')).toBeNull();});
});
