// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({recover:vi.fn(),settings:vi.fn(),threads:vi.fn()}));
vi.mock('@/mvp/automation/engine',()=>({recoverMeetingSelection:mocks.recover,listFunnelThreads:mocks.threads,controlThread:vi.fn(),startEmailTest:vi.fn(),sendSellerTestIntroduction:vi.fn()}));
vi.mock('@/mvp/automation/config',()=>({AUTOMATION_RECIPIENT:'approved@gmail.com',funnelStatus:mocks.settings,setFunnelEnabled:vi.fn()}));
import {POST} from './route';
const threadId='00000000-0000-4000-8000-000000000001',messageId='00000000-0000-4000-8000-000000000002';
const body={action:'recover_meeting_selection',threadId,messageId};
const request=(data:unknown,origin='http://localhost:3007')=>new Request('http://localhost:3007/api/mvp/automation',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('APP_URL','http://localhost:3007');mocks.settings.mockResolvedValue({recipient:'approved@gmail.com'});mocks.threads.mockResolvedValue([]);mocks.recover.mockResolvedValue({threadId,messageId});});
afterEach(()=>vi.unstubAllEnvs());
describe('bounded scheduling parser recovery API',()=>{
  it('recovers only the explicitly named real reply',async()=>{
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(threadId,messageId);
  });
  it('rejects missing/invalid IDs, extra fields and cross-origin writes',async()=>{
    for(const data of [{action:body.action,threadId},{...body,messageId:'any'},{...body,recipient:'buyer@example.com'}])expect((await POST(request(data))).status).toBe(400);
    expect((await POST(request(body,'https://other.example'))).status).toBe(403);
    expect(mocks.recover).not.toHaveBeenCalled();
  });
  it('reports rejected recovery without claiming a booking',async()=>{
    mocks.recover.mockRejectedValue(new Error('Only the latest real reply can be recovered'));
    const response=await POST(request(body));expect(response.status).toBe(409);
    expect(await response.text()).toContain('latest real reply');
  });
});
