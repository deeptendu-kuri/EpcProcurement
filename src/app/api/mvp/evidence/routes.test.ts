// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {GET as opportunity} from './[opportunityId]/route';
import {GET as company} from './company/[companyId]/route';
const read=vi.hoisted(()=>({opportunity:vi.fn(),company:vi.fn()}));
vi.mock('@/mvp/evidence',()=>({opportunityEvidence:read.opportunity,companyEvidence:read.company}));
const id='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{vi.clearAllMocks();read.opportunity.mockResolvedValue({sources:[]});read.company.mockResolvedValue({sources:[]});});
describe('WP7 session-proxy evidence routes',()=>{
  it('awaits Next16 params and returns uncached opportunity evidence',async()=>{const r=await opportunity(new Request('http://localhost/api/mvp/evidence/'+id),{params:Promise.resolve({opportunityId:id})});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(read.opportunity).toHaveBeenCalledWith(id);});
  it('validates company run scope and returns uncached evidence',async()=>{const r=await company(new Request('http://localhost/api/mvp/evidence/company/'+id+'?run='+id),{params:Promise.resolve({companyId:id})});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(read.company).toHaveBeenCalledWith(id,id);});
  it('rejects invalid ids and any recipient/unknown parameters before DB access',async()=>{expect((await opportunity(new Request('http://localhost/?recipient=Example'),{params:Promise.resolve({opportunityId:id})})).status).toBe(400);expect((await company(new Request('http://localhost/?run=invalid'),{params:Promise.resolve({companyId:id})})).status).toBe(400);expect(read.company).not.toHaveBeenCalled();expect(read.opportunity).not.toHaveBeenCalled();});
  it('reports absent verified evidence as 404 rather than empty success',async()=>{read.opportunity.mockResolvedValue(null);expect((await opportunity(new Request('http://localhost/'),{params:Promise.resolve({opportunityId:id})})).status).toBe(404);});
});
