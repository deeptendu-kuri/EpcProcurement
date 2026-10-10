'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import type {EvidenceDrawerView} from '@/mvp/buyers/types';
import {BUYER_STAGE_LABELS,triggerKindLabel} from '@/mvp/buyers/types';
import {marketName} from '@/mvp/config/markets';
import {apiJson} from '../api-client';
import {getBuyer} from '../search/buyer-api';
import {AddToListDialog} from '../search/lead-lists';
import {AddContactModal} from '../buyers/add-contact-modal';
import {addContact} from '../buyers/chain-api';
import {SourceCards} from './source-card';
import {LeadIntelligenceSummary} from './lead-intelligence-summary';

const capitalise=(text:string)=>text.charAt(0).toUpperCase()+text.slice(1);
const PROOF_LABEL={verified:'Verified',listing:'Its listed work',likely:'Likely buyer, not verified'} as const;
const PROOF_TONE={verified:'bg-[var(--good-bg)] text-[var(--good)]',listing:'bg-[var(--info-bg)] text-[var(--info)]',likely:'bg-[var(--warn-bg)] text-[var(--warn)]'} as const;
const BUYER_TYPE_WORD:Record<string,string>={end_user:'Uses it',contractor:'Main contractor',subcontractor:'Subcontractor',owner:'Owner / operator',reseller:'Stockist (secondary)',competitor:'Competitor',not_buyer:'Not a buyer'};
export interface DrawerTarget {opportunityId?:string;companyId?:string;leadId?:string;run?:string}
export const drawerKey=(t:DrawerTarget)=>t.opportunityId??(t.companyId?`company:${t.companyId}`:t.leadId??'');
export function parseDrawerTarget(value:string,run?:string):DrawerTarget|null{
  const uuid=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  if(uuid.test(value))return {opportunityId:value,run};
  if(value.startsWith('company:')&&uuid.test(value.slice(8)))return {companyId:value.slice(8),run};
  return null;
}
export function EvidenceDrawer({target,onClose,onTarget,onNext,onPrevious,returnTo='/crm',initial}:{target:DrawerTarget;onClose:()=>void;onTarget?:(target:DrawerTarget)=>void;onNext?:()=>void;onPrevious?:()=>void;returnTo?:string;initial?:EvidenceDrawerView}){
  const key=drawerKey(target),router=useRouter();const panel=useRef<HTMLDivElement>(null);
  const [loaded,setLoaded]=useState<{key:string;view?:EvidenceDrawerView;error?:string}>(initial?{key,view:initial}:{key:''});
  const [list,setList]=useState(false);const [adding,setAdding]=useState<EvidenceDrawerView['contacts'][number]|null>(null);const [actionError,setActionError]=useState('');
  const [retry,setRetry]=useState(0);
  const [verifying,setVerifying]=useState(false);const [verifyNote,setVerifyNote]=useState('');
  // "Verify its website now" (research/found.ts checkFoundCompany): the result appears when the check finishes.
  const verify=async(runId:string,candidateId:string)=>{
    setVerifying(true);setVerifyNote('');
    try{const r=await apiJson<{message:string}>(`/api/mvp/research/${runId}/companies`,{method:'POST',body:{candidateId}});setVerifyNote(r.message);}
    catch(e){setVerifyNote(e instanceof Error?e.message:'Could not start the check.');}
    finally{setVerifying(false);}
  };
  useEffect(()=>{
    if(initial&&retry===0)return;
    const controller=new AbortController();
    void (async()=>{
      try{
        let company=target.companyId;
        if(!target.opportunityId&&!company&&target.leadId)company=(await getBuyer(target.leadId,controller.signal)).companyId;
        const path=target.opportunityId?`/api/mvp/evidence/${encodeURIComponent(target.opportunityId)}`:`/api/mvp/evidence/company/${encodeURIComponent(company??'')}?run=${encodeURIComponent(target.run&&target.run!=='none'?target.run:'all')}`;
        const view=await apiJson<EvidenceDrawerView>(path,{signal:controller.signal});if(!controller.signal.aborted)setLoaded({key,view});
      }catch(e){if(!controller.signal.aborted)setLoaded({key,error:e instanceof Error?e.message:'Could not load verified evidence.'});}
    })();return ()=>controller.abort();
  },[key,target.companyId,target.opportunityId,target.leadId,target.run,initial,retry]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;panel.current?.focus();
    return ()=>{if(previous?.isConnected)previous.focus();};
  },[]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();onClose();return;}
      if(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
      if(e.key==='j'&&onNext){e.preventDefault();onNext();}
      if(e.key==='k'&&onPrevious){e.preventDefault();onPrevious();}
      if(e.key==='Tab'){
        const nodes=Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex="0"]')??[]);
        const first=nodes[0],last=nodes.at(-1);
        if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===panel.current)){e.preventDefault();first?.focus();}
      }
    };window.addEventListener('keydown',onKey);return ()=>window.removeEventListener('keydown',onKey);
  },[onClose,onNext,onPrevious]);
  const view=loaded.key===key?loaded.view:undefined;const error=loaded.key===key?loaded.error:undefined;
  const workspace=view?.header.opportunityId?`/opportunities/${view.header.opportunityId}?returnTo=${encodeURIComponent(/^\/crm(?:\?|$)/.test(returnTo)?returnTo:'/crm')}`:null;
  const reject=async()=>{if(!view?.header.opportunityId)return;try{await apiJson(`/api/mvp/opportunities/${view.header.opportunityId}`,{method:'PATCH',body:{qualification:'rejected'}});router.refresh();onClose();}catch(e){setActionError(e instanceof Error?e.message:'Could not update.');}};
  return <div className="fixed inset-0 z-50 flex justify-end" role="presentation"><button className="absolute inset-0 bg-slate-900/25" aria-label="Close evidence drawer" onClick={onClose}/><div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="hybrid-evidence-title" className="relative h-full w-full max-w-[560px] overflow-y-auto bg-white shadow-2xl outline-none">
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--line)] bg-white px-5 py-4"><h2 id="hybrid-evidence-title" className="font-bold">Company evidence</h2><div className="flex gap-2"><button disabled={!onPrevious} onClick={onPrevious} aria-label="Previous result" className="btn btn-secondary btn-sm">↑ k</button><button disabled={!onNext} onClick={onNext} aria-label="Next result" className="btn btn-secondary btn-sm">↓ j</button><button onClick={onClose} aria-label="Close" className="btn btn-secondary btn-sm">✕</button></div></div>
    {!view&&!error?<p role="status" className="p-5">Checking original sources…</p>:null}{error?<div role="alert" className="p-5"><p>{error}</p><button onClick={()=>setRetry(n=>n+1)} className="btn btn-secondary mt-3">Retry</button></div>:null}
    {view?<div className="space-y-6 p-5"><header><h3 className="text-xl font-bold">{view.header.name}</h3><p className="mt-1 text-sm text-[var(--muted)]">{view.header.whatTheyDo}{view.header.operatingCountry?` · Work in ${marketName(view.header.operatingCountry)}`:''}</p><div className="mt-3 flex flex-wrap gap-2">{view.header.trigger?<span className="pill">{triggerKindLabel(view.header.trigger.kind)}</span>:null}{view.header.trigger?.date?<span className="pill">{view.header.trigger.date}</span>:null}<span className="pill" title={view.header.fitScore>0?'Priority score from the evidence':'No contract or order evidence to score yet'}>{BUYER_STAGE_LABELS[view.header.stage]}{view.header.fitScore>0?` · ${view.header.fitScore}`:' · not scored'}</span></div><div className="mt-4 flex flex-wrap gap-2">{workspace?<Link className="btn btn-primary btn-sm" href={workspace}>Open workspace</Link>:<span className="text-xs">Related company · no saved product opportunity</span>}{target.leadId&&!target.leadId.startsWith('derived:')?<button onClick={()=>setList(true)} className="btn btn-secondary btn-sm">Add to list</button>:null}{workspace?<button onClick={()=>void reject()} className="btn btn-secondary btn-sm">Not relevant</button>:null}</div></header>
      {actionError?<p role="alert">{actionError}</p>:null}
      {view.proof?<p data-testid="proof-level" className={`rounded-lg px-3 py-2 text-sm ${PROOF_TONE[view.proof.level]}`}><strong>{PROOF_LABEL[view.proof.level]}.</strong> {capitalise(view.proof.note.replace(/^[^:]+:\s*/,''))}</p>:null}
      {view.proof?.level==='likely'?null:<LeadIntelligenceSummary lead={view.header} leadId={target.leadId} workspace={workspace}/>}
      {view.rating?<section data-testid="rating"><h3 className="font-bold">Why the search rated it a buyer</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">{view.rating.score!==null?<span className="pill">Rating {view.rating.score}</span>:null}{view.rating.buyerType?<span className="pill">{BUYER_TYPE_WORD[view.rating.buyerType]??view.rating.buyerType}</span>:null}{view.rating.role?<span className="text-[var(--text-2)]">{view.rating.role}</span>:null}</div>
        {view.rating.reason?<p className="mt-2 text-sm leading-6">{view.rating.reason}</p>:null}
        <p className="mt-2 text-xs text-[var(--muted)]">{view.rating.status}. Ratings come from what the source says, not from the company&apos;s own pages.</p>
        {view.rating.checkable?<button className="btn btn-primary btn-sm mt-3" disabled={verifying} onClick={()=>void verify(view.rating!.runId,view.rating!.candidateId)}>{verifying?'Starting…':'Verify its website now'}</button>:null}
        {verifyNote?<p role="status" className="mt-2 text-sm">{verifyNote}</p>:null}</section>:null}
      <section data-testid="recent"><h3 className="font-bold">Recent work and contracts</h3>{view.recent?.length?<ul className="mt-2 space-y-2">{view.recent.slice(0,6).map(t=><li key={t.id} className="rounded-lg bg-[var(--subtle)] p-3 text-sm"><p className="font-medium">{t.title}</p><p className="mt-1 text-xs text-[var(--muted)]">{triggerKindLabel(t.kind)}{t.date?` · ${t.date}`:' · date not stated'}{t.valueText?` · ${t.valueText}`:''}{t.projectName?` · ${t.projectName}`:''}{t.ownerName?` · for ${t.ownerName}`:''}</p></li>)}</ul>
        :<p className="mt-2 text-sm text-[var(--muted)]">No dated contract or order found yet. It is a lead because of the work it does, shown below.</p>}</section>
      {view.proof?.level==='likely'?null:<section><h3 className="font-bold">Why this is a lead</h3><p className="mt-2 text-sm leading-6">{view.why}</p>{view.application?<p className="mt-2 rounded-lg bg-[var(--subtle)] p-3 text-sm leading-6"><strong>{view.application.split(':')[0]}:</strong>{view.application.slice(view.application.indexOf(':')+1)}</p>:<p className="mt-2 text-xs text-[var(--muted)]">The source shows the kind of work, not a stated need for this product. Treat it as a possible buyer.</p>}<p className="mt-2 text-xs text-[var(--muted)]">Potential customer, not a confirmed purchase.</p></section>}
      <section><h3 className="mb-3 font-bold">{view.proof?.level==='likely'?'Where the search found it':`Sources (${view.sources.length})`}</h3>{view.sources.length?<SourceCards sources={view.sources}/>:<p className="text-sm text-[var(--muted)]">The source page is no longer available.</p>}</section>
      <section><h3 className="font-bold">Related companies</h3>{!view.related.above.length&&!view.related.below.length?<p className="mt-2 text-sm text-[var(--muted)]">No source-backed relationship established.</p>:null}{[...view.related.above.map(r=>({r,id:r.linkedToCompanyId,name:r.linkedToName,direction:'Contractor above'})),...view.related.below.map(r=>({r,id:r.companyId,name:r.name,direction:'Supplier / subcontractor below'}))].map(({r,id,name,direction})=><div key={`${direction}:${id}`} className="mt-2 rounded-lg bg-[var(--subtle)] p-3 text-sm"><p>{direction} · {r.link}</p><button disabled={!onTarget} className="mt-1 font-semibold text-[var(--accent-2)] underline" onClick={()=>onTarget?.({companyId:id,run:target.run})}>{name} · show their evidence</button></div>)}</section>
      <section><h3 className="font-bold">Contacts</h3><p className="mt-1 text-xs text-[var(--muted)]">Role review is not email validation. Validated addresses are available in Contacts.</p><ul className="mt-3 space-y-2">{view.contacts.map(s=><li key={s.slotId} className="rounded-lg border border-[var(--line)] p-3 text-sm"><p className="font-semibold">{s.person?.name??s.title}</p><p className="text-xs text-[var(--muted)]">{s.role.replaceAll('_',' ')} · {s.person?s.status==='confirmed'?'Role reviewed':'Likely':'Not found'}</p><div className="mt-2 flex gap-3">{s.findLinks[0]?<a href={s.findLinks[0].url} target="_blank" rel="noreferrer" className="underline">Find</a>:null}<button className="underline" onClick={()=>setAdding(s)}>Add</button>{workspace?<Link href={`${workspace}&tab=contacts`} className="underline">Validate</Link>:null}</div></li>)}</ul></section>
      <section><h3 className="font-bold">Activity</h3><ul className="mt-2 space-y-2 text-sm">{view.activity.map((a,i)=><li key={`${a.at}:${i}`}><p>{a.text}</p><time className="text-xs text-[var(--muted)]">{a.at}</time></li>)}{!view.activity.length?<li className="text-[var(--muted)]">No activity yet.</li>:null}</ul></section>
    </div>:null}
    {list&&target.leadId?<AddToListDialog leadIds={[target.leadId]} onClose={()=>setList(false)}/>:null}
    {adding&&view?<AddContactModal company={view.header.name} slotTitle={adding.title} onClose={()=>setAdding(null)} onSubmit={async values=>{await addContact({...values,companyId:view.header.companyId,slotId:adding.slotId,leadId:target.leadId&&!target.leadId.startsWith('derived:')?target.leadId:undefined});setRetry(n=>n+1);router.refresh();}}/>:null}
  </div></div>;
}
