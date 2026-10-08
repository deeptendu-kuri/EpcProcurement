// @vitest-environment node
import {createHmac} from 'node:crypto';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({tick:vi.fn(),dispatch:vi.fn(),receipt:vi.fn(),start:vi.fn()}));
vi.mock('@/mvp/research/engine',()=>({processResearchTick:mocks.tick}));
vi.mock('@/mvp/research/transport',()=>({dispatchResearchOutbox:mocks.dispatch,recordResendReceipt:mocks.receipt}));
vi.mock('@/mvp/research/worker',()=>({startResearchWorker:mocks.start}));
import {POST as worker} from '@/app/api/mvp/research/worker/route';
import {POST as webhook} from '@/app/api/mvp/webhooks/resend/route';
const secret='machine-test-secret-at-least-32-characters',id='00000000-0000-4000-8000-000000000001';
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('RESEARCH_WORKER_SECRET',secret);vi.stubEnv('VERCEL','0');vi.stubEnv('APP_URL','http://localhost:3007');mocks.tick.mockResolvedValue({processed:true});mocks.receipt.mockResolvedValue(true);});
afterEach(()=>vi.unstubAllEnvs());
const req=(body:string,auth?:string)=>new Request('http://localhost:3007/api/mvp/research/worker',{method:'POST',headers:{...(auth?{authorization:auth}:{}),cookie:'session=pretend'},body});
describe('durable worker and receipt routes',()=>{
  it('does not accept a browser cookie instead of machine authorization',async()=>{expect((await worker(req('{}'))).status).toBe(401);expect(mocks.tick).not.toHaveBeenCalled();});
  it('rejects malformed payload before claiming a job',async()=>{expect((await worker(req('not-json',`Bearer ${secret}`))).status).toBe(400);expect(mocks.tick).not.toHaveBeenCalled();});
  it('processes only authenticated valid IDs',async()=>{
    expect((await worker(req(JSON.stringify({runId:id,jobId:id}),`Bearer ${secret}`))).status).toBe(200);
    expect(mocks.tick).toHaveBeenCalledWith(undefined,undefined,id,id);expect(mocks.dispatch).toHaveBeenCalledOnce();
  });
  it('retains Vercel fail-closed behavior rather than claiming background integration',async()=>{
    vi.stubEnv('VERCEL','1');expect((await worker(req('{}',`Bearer ${secret}`))).status).toBe(503);expect(mocks.tick).not.toHaveBeenCalled();
  });
  it('rejects forged inbound webhook without persisting or waking',async()=>{
    expect((await webhook(new Request('http://localhost:3007/api/mvp/webhooks/resend',{method:'POST',body:'{}'}))).status).toBe(401);
    expect(mocks.receipt).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();
  });
  it('persists a valid signed receipt before acknowledging and does not wake duplicates',async()=>{
    const key='signing-key-only-for-unit-tests-123456';vi.stubEnv('RESEND_WEBHOOK_SECRET',`whsec_${Buffer.from(key).toString('base64')}`);
    const body=JSON.stringify({type:'email.received',data:{email_id:id}}),timestamp=String(Math.floor(Date.now()/1000)),event='msg_unit';
    const signature=createHmac('sha256',key).update(`${event}.${timestamp}.${body}`).digest('base64');
    const make=()=>new Request('http://localhost:3007/api/mvp/webhooks/resend',{method:'POST',headers:{'svix-id':event,'svix-timestamp':timestamp,'svix-signature':`v1,${signature}`},body});
    expect((await webhook(make())).status).toBe(200);expect(mocks.receipt).toHaveBeenCalledWith(event,'email.received',id);expect(mocks.start).toHaveBeenCalledOnce();
    mocks.receipt.mockResolvedValue(false);await webhook(make());expect(mocks.start).toHaveBeenCalledOnce();
  });
});
