import {afterEach,describe,it,expect,vi} from 'vitest';
const deps=vi.hoisted(()=>({create:vi.fn().mockResolvedValue('Example-run'),start:vi.fn(),queue:vi.fn()}));
vi.mock('@/mvp/research/store',()=>({createResearchRun:deps.create}));
vi.mock('@/mvp/research/worker',()=>({startResearchWorker:deps.start}));
vi.mock('@/mvp/scheduler',()=>({getRunQueue:deps.queue}));
vi.mock('@/mvp/config/env',()=>({mvpEnv:{offline:()=>false}}));
vi.mock('@/mvp/discovery/material-catalogue',()=>({resolveMaterial:()=>({status:'resolved'})}));
import {enqueueResponse} from './queue';
const job={input:{query:'line pipe',productId:'line-pipe',markets:['IN'],leadKinds:['supply_subcontract' as const]}};
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe('WP10 manual benchmark driver',()=>{
  it('creates the real durable run with all research timers disabled',async()=>{vi.stubEnv('MVP_DURABLE_RESEARCH','off');vi.stubEnv('MVP_RESEARCH_MANUAL_DRIVER','1');vi.stubEnv('RENDER','');vi.stubEnv('VERCEL','');expect((await enqueueResponse(job)).status).toBe(202);expect(deps.create).toHaveBeenCalledWith(job.input);expect(deps.start).not.toHaveBeenCalled();expect(deps.queue).not.toHaveBeenCalled();});
  it('cannot override the serverless safety gate',async()=>{vi.stubEnv('VERCEL','1');vi.stubEnv('MVP_RESEARCH_MANUAL_DRIVER','1');expect((await enqueueResponse(job)).status).toBe(503);expect(deps.create).not.toHaveBeenCalled();});
  it('retains the normal persistent cloud worker',async()=>{vi.stubEnv('RENDER','true');vi.stubEnv('VERCEL','');vi.stubEnv('MVP_DURABLE_RESEARCH','on');vi.stubEnv('MVP_RESEARCH_MANUAL_DRIVER','1');await enqueueResponse(job);expect(deps.start).toHaveBeenCalledOnce();});
});
