// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({continue:vi.fn(),wait:vi.fn(),after:vi.fn(),replay:vi.fn(),worker:vi.fn(),serverless:vi.fn(()=>false)}));
vi.mock("next/server",async original=>({...await original<typeof import("next/server")>(),after:mocks.after}));
vi.mock("@/mvp/pipeline",()=>({continueBuyerRun:mocks.continue,waitForRun:mocks.wait}));
vi.mock('@/mvp/research/store',()=>({replayCachedCompanyAnalyses:mocks.replay}));
vi.mock('@/mvp/research/worker',()=>({startResearchWorker:mocks.worker}));
vi.mock('@/mvp/runtime',()=>({serverlessRuntime:mocks.serverless}));
import {POST} from "./route";
const id="00000000-0000-0000-0000-000000000007";
const params={params:Promise.resolve({id})};
const request=(data:unknown,origin="http://localhost:3007")=>new Request(`http://localhost:3007/api/mvp/runs/${id}`,{method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify(data)});
beforeEach(()=>{vi.clearAllMocks();mocks.continue.mockResolvedValue(id);mocks.replay.mockResolvedValue(2);mocks.serverless.mockReturnValue(false);});
describe("bounded saved-page continuation endpoint",()=>{
  it("rejects cross-origin requests and invalid actions before any processing",async()=>{
    expect((await POST(request({action:"continue_analysis"},"https://other.example"),params)).status).toBe(403);
    expect((await POST(request({action:"send_any_email"}),params)).status).toBe(400);expect(mocks.continue).not.toHaveBeenCalled();
  });
  it("claims one existing search and retains its background work after responding",async()=>{
    const response=await POST(request({action:"continue_analysis"}),params);expect(response.status).toBe(202);expect(mocks.continue).toHaveBeenCalledWith(id);expect(mocks.after).toHaveBeenCalledOnce();
    await mocks.after.mock.calls[0][0]();expect(mocks.wait).toHaveBeenCalledWith(id);
  });
  it("returns a conflict for duplicate/busy continuation without starting other research",async()=>{
    mocks.continue.mockRejectedValue(new Error("This search is already processing"));expect((await POST(request({action:"continue_analysis"}),params)).status).toBe(409);expect(mocks.after).not.toHaveBeenCalled();
  });
  it('replays only cached responses on a persistent worker without paid continuation',async()=>{
    const r=await POST(request({action:'replay_cached'}),params);expect(r.status).toBe(202);
    expect(await r.json()).toMatchObject({cachedAnalyses:2});expect(mocks.replay).toHaveBeenCalledWith(id);
    expect(mocks.worker).toHaveBeenCalledOnce();expect(mocks.continue).not.toHaveBeenCalled();
    mocks.serverless.mockReturnValue(true);mocks.replay.mockClear();
    expect((await POST(request({action:'replay_cached'}),params)).status).toBe(409);expect(mocks.replay).not.toHaveBeenCalled();
  });
});
