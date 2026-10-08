import { processResearchTick } from './engine';
import { serverlessRuntime } from '@/mvp/runtime';
import { processFunnelWake } from './transport';
const state=globalThis as typeof globalThis & {researchTimer?:ReturnType<typeof setTimeout>;researchWorking?:boolean};
export function startResearchWorker(){
  if(serverlessRuntime()||process.env.VITEST||process.env.NEXT_PHASE==='phase-production-build'||process.env.MVP_DURABLE_RESEARCH==='off'||state.researchTimer||state.researchWorking)return;
  const tick=async()=>{
    state.researchWorking=true;let busy=false;
    try{const wake=await processFunnelWake();busy=(await processResearchTick()).processed||wake.processed;}catch{console.warn('[research] Durable worker temporarily unavailable. Saved jobs remain resumable.');}
    finally{state.researchWorking=false;state.researchTimer=setTimeout(()=>{state.researchTimer=undefined;void tick();},busy?20:3000);state.researchTimer.unref();}
  };
  state.researchTimer=setTimeout(()=>{state.researchTimer=undefined;void tick();},500);state.researchTimer.unref();
}
/** Test/direct callers can drain saved stages; no browser or background promise is required. */
export async function waitForResearchRun(runId:string){
  const {getDb}=await import('@/mvp/db');const db=getDb();
  for(let i=0;i<10000;i++){
    const s=(await db.query<{state:string}>('select state from research_sessions where run_id=$1',[runId])).rows[0];
    if(!s||s.state!=='active')return;
    const result=await processResearchTick(db,undefined,runId);
    if(!result.processed)await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Research remains saved but has not finished.');
}
