// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {GET} from './route';
const read=vi.hoisted(()=>vi.fn(async()=>({rows:[],total:0,facets:{}})));
vi.mock('@/mvp/crm/tables',()=>({crmTables:read}));
describe('WP6 tables route',()=>{
  it('returns no-store results with validated query parameters',async()=>{const r=await GET(new Request('http://localhost/api/mvp/crm/tables?run=all&tab=contacts&size=50'));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(read).toHaveBeenCalledWith(expect.objectContaining({run:'all',tab:'contacts',size:50}));});
  it('rejects unknown recipient parameters and invalid ids before reading',async()=>{read.mockClear();expect((await GET(new Request('http://localhost/api/mvp/crm/tables?recipient=buyer@example.com'))).status).toBe(400);expect((await GET(new Request('http://localhost/api/mvp/crm/tables?run=invalid'))).status).toBe(400);expect(read).not.toHaveBeenCalled();});
});
