"use client";
import { useState } from 'react';
import type { funnelStatus } from '@/mvp/automation/config';
import { apiJson } from '../api-client';
import { formatDateTime } from '../labels';

export type FunnelSettings=Awaited<ReturnType<typeof funnelStatus>>;
export function DemoFunnelSetup({settings:s,onChange,returnTo='/outreach',calendarResult}:{settings:FunnelSettings;onChange:(settings:FunnelSettings)=>void;returnTo?:string;calendarResult?:string}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const toggle=async()=>{
    setBusy(true);setError(null);
    try{const result=await apiJson<{settings:FunnelSettings}>('/api/mvp/automation',{method:'POST',body:s.enabled?{action:'disable'}:{action:'enable',confirmedRecipient:s.recipient}});onChange(result.settings);}
    catch(e){setError(e instanceof Error?e.message:'Could not update automation.');}finally{setBusy(false);}
  };
  const connect=async()=>{
    setBusy(true);setError(null);
    try{const result=await apiJson<{url:string}>('/api/mvp/automation/calendar/connect',{method:'POST',body:{returnTo}});if(new URL(result.url).origin!=='https://accounts.google.com')throw new Error('Invalid Calendar authorization URL.');window.location.assign(result.url);}
    catch(e){setError(e instanceof Error?e.message:'Calendar connection failed.');setBusy(false);}
  };
  return <section className="rounded-xl border border-[var(--line)] p-4" aria-label="Demo funnel setup">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="font-bold">Demo automation setup</h3><p className="mt-1 break-words text-sm">Emails and invitations go only to <strong>{s.recipient}</strong>. Discovered buyer details remain unchanged.</p></div><button disabled={busy||(!s.enabled&&(!s.ready||!s.worker))} className={`btn ${s.enabled?'btn-secondary':'btn-primary'}`} onClick={()=>void toggle()}>{busy?'Updating…':s.enabled?'Pause all automation':'Enable demo funnel'}</button></div>
    <p className="mt-3 text-sm">Seller: <strong>{s.seller.name}</strong>{s.seller.company?` · ${s.seller.company}`:' · procurement demo; company not supplied'}. Demo customer: <strong>{s.demoCustomer?.name||'the approved inbox owner'}</strong>. The researched company is the potential buyer represented in this demonstration, not the seller.</p>
    <div className="mt-3 flex flex-wrap items-center gap-3"><span className="chip">Automation {s.enabled?'enabled':'paused'}</span><span className="chip">Email worker {s.worker?'enabled':'off'}</span><span className="chip">Calendar {s.calendar?'connected':'not connected'}</span><button disabled={busy||!s.calendarSetup} className="btn btn-secondary btn-sm" onClick={()=>void connect()}>{s.calendar?'Reconnect Google Calendar':'Connect Google Calendar'}</button></div>
    {!s.calendar?<p role="status" className="mt-3 text-sm text-amber-800">You can test email first. Complete Google consent before booking a meeting. A meeting request waits safely until Calendar is connected; then the agent offers available times.</p>:null}
    {calendarResult==='failed'?<p role="alert" className="mt-3 text-sm text-red-700">Calendar connection did not complete. Check the Google test user, consent and redirect URI, then reconnect the approved account.</p>:calendarResult==='connected'&&s.calendar?<p role="status" className="mt-3 text-sm text-green-800">Google Calendar connected. Waiting meeting requests resume automatically.</p>:null}
    {!s.worker?<p role="status" className="mt-3 text-sm text-amber-800">The email worker is off. Start the local app with <code>node scripts/start-local-funnel.mjs --demo</code>; simply opening a page never sends mail.</p>:null}
    {s.configError?<p role="status" className="mt-3 text-sm text-amber-800">Setup required: {s.configError}</p>:null}
    {s.last_error?<p role="alert" className="mt-3 text-sm text-red-700">Worker needs attention: {s.last_error}</p>:null}
    {error?<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>:null}
    <details className="mt-3 text-xs text-[var(--text-2)]"><summary className="cursor-pointer font-semibold">Connection details & safety limits</summary><p className="mt-2">Groq: {s.groq?'configured':'missing'} · Contact verification: {s.emailable||s.hunter?'configured':'missing'} · Resend receiving: {s.receiving||'missing'}</p><p className="mt-2">{s.preferences.duration}-minute meetings · {s.preferences.timeZone} · weekdays {s.preferences.startHour}:00–{s.preferences.endHour}:00. Agree to an offered slot or a specific date/time before booking.</p><p className="mt-2">Up to {s.prospectsPerSearch} prospect demo per search, 10 outgoing email attempts/day across this demo, and at most two no-response follow-ups three days apart. Replies cancel pending chasing; opt-outs stop delivery.</p><p className="mt-2">Last worker check: {s.last_tick_at?formatDateTime(s.last_tick_at):'not yet'}. Status refreshes every 10 seconds.</p></details>
  </section>;
}
