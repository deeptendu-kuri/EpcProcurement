import { processCampaignQueue } from "./campaigns";
import { serverlessRuntime } from "@/mvp/runtime";

const state = globalThis as typeof globalThis & { demoOutreachTimer?: ReturnType<typeof setInterval> };
/** Opportunistic local/Node worker. Persistent jobs survive restart, but a sleeping host cannot send. */
export function startOutreachWorker() {
  if(serverlessRuntime())return;
  if (process.env.MVP_OUTREACH_WORKER !== "on" || process.env.VITEST || process.env.NEXT_PHASE === "phase-production-build" || state.demoOutreachTimer) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processCampaignQueue(); }
    catch { console.warn("[outreach] worker unavailable; jobs remain stored. Check demo configuration/database."); }
    finally { running = false; }
  };
  state.demoOutreachTimer = setInterval(() => { void tick(); }, 15_000);
  state.demoOutreachTimer.unref();
}
