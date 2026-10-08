// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({status:vi.fn(),threads:vi.fn(),messages:vi.fn(),start:vi.fn(),settings:vi.fn()}));
vi.mock('@/mvp/automation/engine',()=>({reviewedProspectStatus:mocks.status,listFunnelThreads:mocks.threads,listThreadMessages:mocks.messages,startReviewedProspectDemo:mocks.start}));
vi.mock('@/mvp/automation/config',()=>({AUTOMATION_RECIPIENT:'approved@gmail.com',funnelStatus:mocks.settings}));
import {GET,POST} from './route';
const id='00000000-0000-0000-0000-000000000007';const ctx={params:Promise.resolve({id})};
const request=(body:unknown,origin='http://localhost:3007')=>new Request(`http://localhost:3007/api/mvp/automation/conversation/${id}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('APP_URL','http://localhost:3007');mocks.status.mockResolvedValue({canStart:true,researchPaused:true});mocks.threads.mockResolvedValue([]);mocks.messages.mockResolvedValue([]);mocks.settings.mockResolvedValue({recipient:'approved@gmail.com'});mocks.start.mockResolvedValue({id:'thread'});});
describe('explicit reviewed prospect conversation API',()=>{
  it('reads setup and eligibility without executing research, AI or delivery',async()=>{const response=await GET(new Request('http://localhost:3007'),ctx);expect(response.status).toBe(200);expect((await response.json()).eligibility.researchPaused).toBe(true);expect(mocks.start).not.toHaveBeenCalled();});
  it('rejects other recipients, arbitrary fields, actions and cross-origin starts',async()=>{
    for(const body of [{action:'start_demo',confirmedRecipient:'buyer@example.com'},{action:'start_demo',confirmedRecipient:'approved@gmail.com',email:'buyer@example.com'},{action:'send_all'}])expect((await POST(request(body),ctx)).status).toBe(400);
    expect((await POST(request({action:'start_demo',confirmedRecipient:'approved@gmail.com'},'https://other.example'),ctx)).status).toBe(403);expect(mocks.start).not.toHaveBeenCalled();
  });
  it('queues only the selected prospect and returns its current conversation',async()=>{const response=await POST(request({action:'start_demo',confirmedRecipient:'approved@gmail.com'}),ctx);expect(response.status).toBe(200);expect(mocks.start).toHaveBeenCalledExactlyOnceWith(id);});
  it('reports blockers and missing prospects without pretending to send',async()=>{mocks.start.mockRejectedValue(new Error('Confirm potential buyer fit'));expect((await POST(request({action:'start_demo',confirmedRecipient:'approved@gmail.com'}),ctx)).status).toBe(409);mocks.status.mockResolvedValue(null);expect((await GET(new Request('http://localhost:3007'),ctx)).status).toBe(404);});
});
