import { processResearchTick, productionResearchDeps } from './engine';
import { serverlessRuntime } from '@/mvp/runtime';
import { processFunnelWake } from './transport';
import { getDb } from '@/mvp/db';

/**
 * Steps run at the same time (doc 19 Phase 4): searches and page reads of different countries proceed in
 * parallel; AI analysis stays one at a time per search (see claimJob). MVP_RESEARCH_CONCURRENCY=1 restores
 * the old one-step-at-a-time worker.
 */
export function researchConcurrency(): number {
  const n = Number(process.env.MVP_RESEARCH_CONCURRENCY ?? 4);
  return Number.isInteger(n) ? Math.max(1, Math.min(8, n)) : 4;
}

const state = globalThis as typeof globalThis & { researchSlots?: boolean[]; researchStarted?: boolean };
export function startResearchWorker(){
  if(serverlessRuntime()||process.env.VITEST||process.env.NEXT_PHASE==='phase-production-build'||process.env.MVP_DURABLE_RESEARCH==='off'||state.researchStarted)return;
  state.researchStarted = true;
  const slots = researchConcurrency();
  state.researchSlots = Array.from({ length: slots }, () => false);
  const loop = (slot: number) => {
    const tick = async () => {
      state.researchSlots![slot] = true; let busy = false;
      try {
        // Email replies and calendar wake-ups are handled by the first slot only.
        const wake = slot === 0 ? await processFunnelWake() : { processed: false };
        busy = (await processResearchTick(getDb(), productionResearchDeps, undefined, undefined, slots)).processed || wake.processed;
      } catch { console.warn('[research] Durable worker temporarily unavailable. Saved jobs remain resumable.'); }
      finally { state.researchSlots![slot] = false; const t = setTimeout(() => void tick(), busy ? 20 : 3000 + slot * 250); t.unref(); }
    };
    const start = setTimeout(() => void tick(), 500 + slot * 150); start.unref();
  };
  for (let slot = 0; slot < slots; slot++) loop(slot);
}
/** Test/direct callers can drain saved stages; no browser or background promise is required. */
export async function waitForResearchRun(runId:string){
  const db=getDb();
  for(let i=0;i<10000;i++){
    const s=(await db.query<{state:string}>('select state from research_sessions where run_id=$1',[runId])).rows[0];
    if(!s||s.state!=='active')return;
    const result=await processResearchTick(db,undefined,runId);
    if(!result.processed)await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Research remains saved but has not finished.');
}
