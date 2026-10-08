// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({begin:vi.fn(),finish:vi.fn()}));
vi.mock('@/mvp/automation/calendar',async original=>({...await original<typeof import('@/mvp/automation/calendar')>(),beginCalendarConnection:mocks.begin,finishCalendarConnection:mocks.finish}));
import {POST} from './connect/route';
import {GET} from './callback/route';
const path='/opportunities/00000000-0000-0000-0000-000000000007?tab=conversation';
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('APP_URL','http://localhost:3007');mocks.begin.mockResolvedValue({url:'https://accounts.google.com/o/oauth2/v2/auth',state:'unit-state-'.repeat(4)});mocks.finish.mockResolvedValue(undefined);});
describe('Calendar consent returns to the same lead workspace',()=>{
  it('stores only a safe return path and rejects cross-origin consent initiation',async()=>{
    const request=(origin:string)=>new Request('http://localhost:3007/api/mvp/automation/calendar/connect',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({returnTo:path})});
    expect((await POST(request('https://evil.example'))).status).toBe(403);expect(mocks.begin).not.toHaveBeenCalled();
    const response=await POST(request('http://localhost:3007'));expect(response.status).toBe(200);expect(response.cookies.get('funnel_return')?.value).toBe(path);expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });
  it('returns to the conversation after successful consent, clearing the one-time cookies',async()=>{
    const request=new NextRequest('http://localhost:3007/api/mvp/automation/calendar/callback?code=unit-code&state=unit-state');request.cookies.set('funnel_return',path);request.cookies.set('funnel_oauth','unit-state');
    const response=await GET(request);expect(response.headers.get('location')).toBe('http://localhost:3007'+path+'&calendar=connected');expect(mocks.finish).toHaveBeenCalledWith('unit-code','unit-state','unit-state');expect(response.cookies.get('funnel_return')?.value).toBe('');
  });
  it('rejects external return paths and visibly reports declined consent',async()=>{
    const request=new NextRequest('http://localhost:3007/api/mvp/automation/calendar/callback?error=access_denied');request.cookies.set('funnel_return','//evil.example');const response=await GET(request);expect(response.headers.get('location')).toBe('http://localhost:3007/outreach?calendar=failed');expect(mocks.finish).not.toHaveBeenCalled();
  });
});
