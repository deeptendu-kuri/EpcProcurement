// @vitest-environment node
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({tick:vi.fn(),enable:vi.fn()}));
vi.mock('./engine',()=>({processFunnelTick:mocks.tick}));
vi.mock('./config',()=>({setFunnelEnabled:mocks.enable,prospectDemoEnabled:()=>process.env.MVP_PROSPECT_DEMO_OUTREACH==='on'}));
import { startFunnelWorker } from './worker';
const state=globalThis as typeof globalThis&{salesFunnelTimer?:ReturnType<typeof setInterval>};
beforeEach(()=>{
  vi.useFakeTimers();mocks.tick.mockReset().mockResolvedValue({processed:false});mocks.enable.mockReset().mockResolvedValue({});
  for(const [k,v] of Object.entries({VERCEL:'',RENDER:'',VITEST:'',NEXT_PHASE:'',DATABASE_URL:'',MVP_FUNNEL_WORKER:'on',MVP_PROSPECT_DEMO_OUTREACH:'on',APP_URL:'http://localhost:3007',MVP_LOCAL_AUTO_ENABLE:'approved-inbox',MVP_FUNNEL_INTERVAL_MS:'15000'}))vi.stubEnv(k,v);
});
afterEach(()=>{if(state.salesFunnelTimer)clearInterval(state.salesFunnelTimer);delete state.salesFunnelTimer;vi.useRealTimers();vi.unstubAllEnvs();});
describe('explicit local-only automatic activation',()=>{
  it('activates once at approved local startup, ticks immediately and prevents duplicate timers',async()=>{
    startFunnelWorker();startFunnelWorker();await vi.advanceTimersByTimeAsync(0);expect(mocks.enable).toHaveBeenCalledExactlyOnceWith(true);expect(mocks.tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);expect(mocks.tick).toHaveBeenCalledTimes(2);
  });
  it.each([{APP_URL:'https://public.example'},{DATABASE_URL:'postgresql://cloud.invalid/db'},{MVP_PROSPECT_DEMO_OUTREACH:'off'},{MVP_LOCAL_AUTO_ENABLE:'off'}])('never auto-enables outside the explicit isolated inbox demo: %s',async overrides=>{
    for(const [k,v] of Object.entries(overrides))vi.stubEnv(k,v);startFunnelWorker();await vi.advanceTimersByTimeAsync(0);expect(mocks.enable).not.toHaveBeenCalled();
  });
  it('does not start a timer or enable automation on Vercel',async()=>{vi.stubEnv('VERCEL','1');startFunnelWorker();await vi.advanceTimersByTimeAsync(60_000);expect(mocks.enable).not.toHaveBeenCalled();expect(mocks.tick).not.toHaveBeenCalled();});
});
