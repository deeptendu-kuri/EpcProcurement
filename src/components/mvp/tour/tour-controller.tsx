"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { driver, type Driver } from "driver.js";
import { apiJson } from "../api-client";
import { EVENTS, safeStorage } from "../shell/events";
import { useToast } from "../shell/toast";
import { TOUR_STEPS, progressText, stepPath, tourSelector, type TourStep } from "./steps";

interface TourState {version:2;active:boolean;index:number;leadId:string|null;runId:string|null;}
export const TOUR_STATE_KEY="mvp.tour.state";
export const TOUR_SEEN_KEY="mvp.tour.seen";
const INACTIVE:TourState={version:2,active:false,index:0,leadId:null,runId:null};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function context():Pick<TourState,"leadId"|"runId"> {
  const params=new URLSearchParams(window.location.search);
  const row=document.querySelector<HTMLAnchorElement>('[data-tour="overview-searches"] a[href^="/crm?run="]');
  const returnPath=params.get("returnTo");
  const returnParams=returnPath?.startsWith("/crm?")?new URLSearchParams(returnPath.split("?")[1]):null;
  const run=params.get("run")??params.get("search")??returnParams?.get("run")??returnParams?.get("search")??(row?new URL(row.href).searchParams.get("run"):null);
  const lead=window.location.pathname.match(/^\/opportunities\/([^/]+)$/)?.[1]??null;
  return {runId:run&&UUID.test(run)?run:null,leadId:lead&&UUID.test(lead)?lead:null};
}
async function targetFor(step:TourStep,cancelled:()=>boolean) {
  const started=Date.now();
  for(;;){
    if(cancelled())return null;
    const el=step.element?document.querySelector<HTMLElement>(tourSelector(step.element)):null;
    if(el&&el.getClientRects().length)return el;
    if(!step.element||Date.now()-started>2000)return null;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
}
export function TourController(){
  const router=useRouter();const pathname=usePathname()??"/";const toast=useToast();
  const [state,setState]=useState<TourState>(INACTIVE);const [offer,setOffer]=useState(false);
  const stateRef=useRef(state);const driverRef=useRef<Driver|null>(null);const internal=useRef(false);
  const update=useCallback((next:TourState)=>{
    stateRef.current=next;setState(next);
    if(next.active)safeStorage.set(TOUR_STATE_KEY,JSON.stringify(next));else safeStorage.remove(TOUR_STATE_KEY);
  },[]);
  const close=useCallback(()=>{
    const current=driverRef.current;driverRef.current=null;if(!current)return;
    internal.current=true;try{current.destroy();}finally{internal.current=false;}
  },[]);
  const end=useCallback((finished:boolean)=>{
    close();safeStorage.set(TOUR_SEEN_KEY,"1");setOffer(false);update(INACTIVE);
    if(finished)toast.show({message:"Guide complete. Open Guide any time to see it again.",tone:"success"});
  },[close,toast,update]);
  const start=useCallback(()=>{
    close();setOffer(false);safeStorage.set(TOUR_SEEN_KEY,"1");
    update({...INACTIVE,...context(),active:true});
  },[close,update]);
  useEffect(()=>{
    const timer=setTimeout(()=>{
      if(stateRef.current.active)return; // Guide may have been started before hydration restoration.
      try {
        const raw=safeStorage.get(TOUR_STATE_KEY);
        const saved=raw?JSON.parse(raw) as TourState:null;
        if(saved?.version===2&&saved.active&&Number.isInteger(saved.index)&&saved.index>=0&&saved.index<TOUR_STEPS.length){
          update({...saved,leadId:saved.leadId&&UUID.test(saved.leadId)?saved.leadId:null,runId:saved.runId&&UUID.test(saved.runId)?saved.runId:null});return;
        }
      }catch{/* A damaged or old guide state is not an error for the app. */}
      setOffer(!safeStorage.get(TOUR_SEEN_KEY));
    },0);
    return()=>clearTimeout(timer);
  },[update]);
  useEffect(()=>{window.addEventListener(EVENTS.startTour,start);return()=>window.removeEventListener(EVENTS.startTour,start);},[start]);
  useEffect(()=>()=>close(),[close]);
  useEffect(()=>{
    if(!state.active){close();return;}
    const step=TOUR_STEPS[state.index];let cancelled=false;
    void(async()=>{
      let leadId=state.leadId;
      if(step.page==="lead"&&!leadId&&state.runId){
        try{
          const data=await apiJson<{facets:{workspaces:{opportunityId:string}[]}}>(`/api/mvp/crm/tables?run=${state.runId}&tab=leads&size=25`);
          leadId=data.facets.workspaces[0]?.opportunityId??null;
        }catch{/* Explain the empty state; never create sample data. */}
        if(cancelled)return;
        if(leadId){update({...stateRef.current,leadId});return;}
      }
      const path=stepPath(step,leadId,state.runId);
      const scopedSearch=step.page==="/crm"&&state.runId&&new URLSearchParams(window.location.search).get("run")!==state.runId;
      if(path&&(pathname!==path.split("?")[0]||scopedSearch)){close();router.push(path);return;}
      const target=step.page==="lead"&&!leadId?null:await targetFor(step,()=>cancelled);
      if(cancelled)return;
      const last=state.index===TOUR_STEPS.length-1;
      close();
      const instance=driver({
        animate:true,allowClose:true,overlayOpacity:0.4,stagePadding:6,stageRadius:10,smoothScroll:true,popoverClass:"mvp-tour",showProgress:true,
        steps:[{element:target??undefined,popover:{
          title:step.title,description:step.needsLeads&&!leadId?step.emptyDescription:step.description,
          side:step.side,align:"start",progressText:progressText(state.index),showButtons:["next","previous","close"],
          disableButtons:state.index===0?["previous"]:[],prevBtnText:"Back",nextBtnText:last?"Finish":"Next",doneBtnText:last?"Finish":"Next",
          onPopoverRender:popover=>{
            const skip=document.createElement("button");skip.type="button";skip.className="tour-skip-btn";skip.textContent="Skip guide";
            skip.addEventListener("click",()=>end(false));popover.footerButtons.prepend(skip);
          }
        }}],
        onNextClick:()=>last?end(true):update({...stateRef.current,index:state.index+1}),
        onPrevClick:()=>{if(state.index>0)update({...stateRef.current,index:state.index-1});},
        onCloseClick:()=>end(false),onDestroyStarted:()=>{if(!internal.current)end(false);}
      });
      driverRef.current=instance;instance.drive(0);
    })();
    return()=>{cancelled=true;};
  },[state,pathname,router,update,close,end]);
  if(!offer)return null;
  return <aside aria-label="Quick guide invitation" className="fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-32px))] rounded-xl border border-[var(--line)] bg-white p-5 shadow-xl">
    <p className="font-bold">Need a quick walkthrough?</p><p className="mt-2 text-sm text-[var(--muted)]">See how a material search becomes leads, a conversation and a meeting. No searches or emails are started by the guide.</p>
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" className="btn btn-primary btn-sm" onClick={start}>Start quick guide</button><button type="button" className="btn btn-secondary btn-sm" onClick={()=>end(false)}>Skip guide</button></div>
  </aside>;
}
