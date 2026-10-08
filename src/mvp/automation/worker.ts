import { processFunnelTick } from "./engine";
import { serverlessRuntime } from "@/mvp/runtime";
import { setFunnelEnabled, prospectDemoEnabled } from './config';
const state=globalThis as typeof globalThis & {salesFunnelTimer?:ReturnType<typeof setInterval>};
export function startFunnelWorker() {
  if(serverlessRuntime())return;
  if (process.env.MVP_FUNNEL_WORKER!=="on" || process.env.VITEST || process.env.NEXT_PHASE==="phase-production-build" || state.salesFunnelTimer) return;
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{await processFunnelTick();}catch{console.warn("[sales-funnel] Configuration/provider unavailable; inspect Email automation. Delivery remains approved-inbox-only.");}finally{running=false;}};
  const requested=Number(process.env.MVP_FUNNEL_INTERVAL_MS||60_000);
  const interval=Number.isFinite(requested)?Math.max(15_000,Math.min(60_000,requested)):60_000;
  state.salesFunnelTimer=setInterval(()=>{void tick();},interval);state.salesFunnelTimer.unref();
  void (async()=>{
    try {
      const url=new URL(process.env.APP_URL||'https://invalid.local');
      if(process.env.MVP_LOCAL_AUTO_ENABLE==='approved-inbox' && prospectDemoEnabled() && !process.env.DATABASE_URL
        && url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))await setFunnelEnabled(true);
      await tick();
    }catch{console.warn('[sales-funnel] Local activation failed; inspect automation setup. No historical conversations were resumed.');}
  })();
}
