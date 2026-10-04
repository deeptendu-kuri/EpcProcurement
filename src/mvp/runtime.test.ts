// @vitest-environment node
import { afterEach,describe,it,expect,vi } from "vitest";
import { requirePersistentWorker,serverlessRuntime } from "./runtime";
import { startFunnelWorker } from "./automation/worker";
import { startOutreachWorker } from "./email/worker";
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("serverless deployment safety",()=>{
  it("does not advertise in-memory queues as durable cloud execution",()=>{
    vi.stubEnv("VERCEL","1");expect(serverlessRuntime()).toBe(true);expect(()=>requirePersistentWorker()).toThrow("durable job queue");
    vi.stubEnv("VERCEL","");expect(()=>requirePersistentWorker()).not.toThrow();
  });
  it("never starts timer-based outreach workers on Vercel, even when local flags are on",()=>{
    vi.stubEnv("VERCEL","1");vi.stubEnv("MVP_FUNNEL_WORKER","on");vi.stubEnv("MVP_OUTREACH_WORKER","on");
    const timer=vi.spyOn(globalThis,"setInterval");startFunnelWorker();startOutreachWorker();expect(timer).not.toHaveBeenCalled();
  });
});
