import { processFunnelTick } from "./engine";
import { serverlessRuntime } from "@/mvp/runtime";
const state=globalThis as typeof globalThis & {salesFunnelTimer?:ReturnType<typeof setInterval>};
export function startFunnelWorker() {
  if(serverlessRuntime())return;
  if (process.env.MVP_FUNNEL_WORKER!=="on" || process.env.VITEST || process.env.NEXT_PHASE==="phase-production-build" || state.salesFunnelTimer) return;
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{await processFunnelTick();}catch{console.warn("[sales-funnel] Configuration/provider unavailable; inspect Outreach. No buyer delivery is enabled.");}finally{running=false;}};
  state.salesFunnelTimer=setInterval(()=>{void tick();},60_000);state.salesFunnelTimer.unref();
}
