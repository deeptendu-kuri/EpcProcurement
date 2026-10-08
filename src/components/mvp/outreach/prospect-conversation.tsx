"use client";
import Link from 'next/link';
import { useCallback,useEffect,useRef,useState } from 'react';
import { apiJson } from '../api-client';
import { formatDateTime } from '../labels';
import type { listFunnelThreads,listThreadMessages,reviewedProspectStatus } from '@/mvp/automation/engine';
import type { FunnelSettings } from './demo-funnel-setup';

type Data={threads:Awaited<ReturnType<typeof listFunnelThreads>>;messages:Awaited<ReturnType<typeof listThreadMessages>>;
  settings?:FunnelSettings;eligibility?:Awaited<ReturnType<typeof reviewedProspectStatus>>};
const LABELS:Record<string,string>={qualifying:'Checking reviewed prospect',needs_contact:'Waiting for contact validation',active:'Waiting for your Gmail reply',engaged:'Sales conversation',awaiting_calendar:'Meeting requested — Calendar consent needed',awaiting_time:'Waiting for your chosen slot',meeting_pending:'Creating Calendar event & Meet link',meeting_booked:'Calendar meeting booked',review:'Needs review',stopped:'Conversation stopped'};

export function ProspectConversation({opportunityId,testThreadId,onChange,calendarResult}:{opportunityId?:string;testThreadId?:string;onChange?:()=>void;calendarResult?:string}) {
  const [data,setData]=useState<Data|null>(null);const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);
  const changed=useRef(onChange);const fingerprint=useRef('');
  useEffect(()=>{changed.current=onChange;},[onChange]);
  const endpoint=testThreadId?`/api/mvp/automation/test/${testThreadId}`:`/api/mvp/automation/conversation/${opportunityId}`;
  const load=useCallback(async()=>apiJson<Data>(endpoint),[endpoint]);
  useEffect(()=>{let cancelled=false;const poll=async()=>{try{const result=await load();if(!cancelled){setData(result);setError(null);const next=JSON.stringify([result.threads.map(t=>[t.id,t.updated_at,t.state,t.summary]),result.messages.map(m=>[m.id,m.state])]);if(fingerprint.current!==next){fingerprint.current=next;changed.current?.();}}}catch{if(!cancelled)setError('Conversation could not refresh. Check the local server.');}};const first=setTimeout(()=>{void poll();},0);const timer=setInterval(()=>{void poll();},10_000);return()=>{cancelled=true;clearTimeout(first);clearInterval(timer);};},[load]);
  const act=async(action:'start_demo'|'confirm_fit'|'pause'|'resume'|'stop'|'retry')=>{
    if(!data)return;setBusy(true);setError(null);
    try {
      if(action==='confirm_fit')await apiJson(`/api/mvp/opportunities/${opportunityId}`,{method:'PATCH',body:{qualification:'approved'}});
      else if(action==='start_demo')await apiJson(endpoint,{method:'POST',body:{action,confirmedRecipient:data.settings!.recipient}});
      else await apiJson('/api/mvp/automation',{method:'POST',body:{action,threadId:data.threads[0].id}});
      setData(await load());onChange?.();
    }catch(e){setError(e instanceof Error?e.message:'Could not update this conversation.');}finally{setBusy(false);}
  };
  const thread=data?.threads[0];const s=data?.settings;const eligibility=data?.eligibility;
  const introduced=Boolean(data?.messages.some(m=>m.direction==='out'&&m.kind==='initial'&&m.state==='accepted'));
  const received=Boolean(data?.messages.some(m=>m.direction==='in'));
  const meetingState=Boolean(thread&&['awaiting_calendar','awaiting_time','meeting_pending','meeting_booked'].includes(thread.state));
  const steps=[{name:'Prospect selected',done:Boolean(thread)},{name:'Introduction accepted',done:introduced},{name:'Reply received',done:received},{name:'Meeting time agreed',done:Boolean(thread?.meeting_start)},{name:'Calendar & Meet ready',done:Boolean(thread?.meet_url&&thread.state==='meeting_booked')}];
  return <section className="mt-4" aria-label="Automatic email conversation">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Email automation timeline</h3><Link href="/outreach" className="text-sm font-semibold text-[var(--accent-2)]">All conversations</Link></div>
    {!data&&!error?<p className="mt-2 text-sm text-[var(--text-2)]">Loading conversation…</p>:null}
    {s&&opportunityId?<div className="mt-4 rounded-lg bg-[var(--subtle)] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p>Automatic demo: <strong>{s.enabled?'on':'paused'}</strong> · Calendar: {s.calendar?'connected':'one-time connection needed'}</p><Link className="font-semibold text-[var(--accent-2)]" href="/settings?tab=automation">Email & Calendar setup</Link></div><p className="mt-1 text-xs text-[var(--text-2)]">Salesperson: {s.seller.name}. Buyer: the researched company. Demo delivery only to {s.recipient}; no real buyer is emailed.</p>{calendarResult==='failed'?<p role="alert" className="mt-2 text-red-700">Google consent did not complete. Reconnect in Settings.</p>:null}{s.last_error?<p role="alert" className="mt-2 text-red-700">{s.last_error}</p>:null}</div>:null}
    {data?<ol aria-label="Sales workflow progress" className="mt-4 grid gap-2 text-xs sm:grid-cols-5">{steps.map((step,i)=><li key={step.name} className={`rounded-lg border p-3 ${step.done?'border-green-200 bg-green-50 text-green-900':'border-[var(--line)] bg-[var(--subtle)] text-[var(--text-2)]'}`}><span className="font-semibold">{step.done?'✓':i+1}. {step.name}</span><p className="mt-1">{step.done?'Recorded':'Pending'}</p></li>)}</ol>:null}
    {data&&!thread?<div className="mt-4 rounded-xl bg-[var(--subtle)] p-4">
      <h4 className="font-semibold">{eligibility?.automaticEligible?'Automatic buyer-fit check pending':'Automatic email status'}</h4>
      <p className="mt-2 text-sm">{eligibility?.automaticReason||'Source-backed companies from new settled searches are checked automatically. One qualifying company per search starts a demo conversation; you do not need to click Send.'}</p>
      {eligibility?.researchPaused?<p className="mt-2 text-xs text-[var(--text-2)]">Research is paused; saved companies remain available. A partial search can still produce an eligible demo conversation without claiming complete coverage.</p>:null}
      {eligibility?.existingOpportunityId?<Link href={`/opportunities/${eligibility.existingOpportunityId}?tab=conversation`} className="btn btn-secondary mt-3">Open existing company conversation</Link>:null}
      {!eligibility?.existingOpportunityId?<details className="mt-3 text-xs"><summary className="cursor-pointer text-[var(--text-2)]">Advanced: manually select a historical saved prospect</summary>
      {eligibility?.reason?<p className="mt-2 text-[var(--text-2)]">{eligibility.reason}</p>:null}
      {eligibility?.reason?.startsWith('Confirm potential buyer fit')?<button disabled={busy} className="btn btn-secondary mt-3" onClick={()=>void act('confirm_fit')}>Confirm potential buyer fit</button>:null}
      {s&&eligibility?<button disabled={busy||!eligibility.canStart||!s.enabled||!s.ready||!s.worker} className="btn btn-secondary mt-3" onClick={()=>void act('start_demo')}>{busy?'Starting…':'Start this prospect’s demo workflow'}</button>:null}
      {s?<p className="mt-2 text-xs text-[var(--text-2)]">Queues one introduction to {s.recipient}. After that, replies, bounded follow-ups and agreed meeting scheduling run automatically. No verification credits are used by this action.</p>:null}
      </details>:null}
    </div>:null}
    {thread?<div className="mt-4 rounded-xl border border-[var(--line)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-bold">{thread.paused?'Paused · ':''}{LABELS[thread.state]||thread.state}</h4><p className="mt-1 text-sm text-[var(--text-2)]">{thread.reason}</p></div>{!['stopped','meeting_booked'].includes(thread.state)?<div className="flex flex-wrap gap-2"><button disabled={busy} className="btn btn-secondary btn-sm" onClick={()=>void act(thread.paused?'resume':'pause')}>{thread.paused?'Resume conversation':'Pause conversation'}</button>{['review','needs_contact'].includes(thread.state)?<button disabled={busy||!s?.enabled} className="btn btn-secondary btn-sm" onClick={()=>void act('retry')}>Retry checked step</button>:null}<button disabled={busy} className="btn btn-secondary btn-sm" onClick={()=>void act('stop')}>Stop conversation</button></div>:null}</div>
      {thread.paused?<p className="mt-2 text-sm">Resume this conversation to allow its next action. Global automation must also be enabled.</p>:thread.state==='active'?<p className="mt-2 text-sm">Open Gmail and reply to the introduction. To test sales qualification, describe your material requirements. To test scheduling, reply “Can we arrange a meeting?”</p>:null}
      {thread.state==='awaiting_time'?<p className="mt-2 text-sm">Reply in Gmail with your preferred date and time, including AM/PM, or “the second one works” for an offered slot. The system rechecks availability and asks about ambiguous times before booking.</p>:null}
      {meetingState&&thread.offered_slots?.length?<ul className="mt-3 space-y-1 text-sm">{thread.offered_slots.map((slot,i)=><li key={slot}>Slot {i+1}: {new Intl.DateTimeFormat('en-GB',{timeZone:s?.preferences.timeZone||'Asia/Kolkata',dateStyle:'full',timeStyle:'short'}).format(new Date(slot))}</li>)}</ul>:null}
      {thread.summary?<div className="mt-3 rounded-lg bg-[var(--subtle)] p-3 text-sm"><p className="font-semibold">Conversation summary · saved in {testThreadId?'this test conversation':'this CRM'}</p><p className="mt-1 whitespace-pre-wrap">{thread.summary}</p></div>:null}
      {thread.meet_url?<a href={thread.meet_url} target="_blank" rel="noreferrer" className="btn btn-primary mt-3">Open booked Google Meet</a>:null}
      {thread.meet_url&&!data?.messages.some(m=>m.kind==='meeting'&&m.state==='accepted')?<p className="mt-2 text-sm text-amber-800">Calendar event is booked; the confirmation email has not yet been accepted. Check delivery progress below.</p>:null}
    </div>:null}
    {error?<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>:null}
    {data?.messages.length?<ol className="mt-4 space-y-3">{data.messages.map(m=><li key={m.id} className={`rounded-xl border border-[var(--line)] p-4 ${m.direction==='in'?'bg-[var(--accent-soft)]':'bg-white'}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{m.direction==='in'?'Your actual reply':'Sales agent email'} · {m.subject}</p><span className="text-xs text-[var(--text-2)]">{m.state==='accepted'?'Provider accepted — delivery not yet verified':m.state} · {formatDateTime(m.created_at)}</span></div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{m.body}</p>{m.error?<p className="mt-2 text-xs text-red-700">{m.error}</p>:null}</li>)}</ol>:null}
  </section>;
}
