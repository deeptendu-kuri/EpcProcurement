"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import { apiJson } from "../api-client";
import type { funnelStatus } from "@/mvp/automation/config";
import type { listFunnelThreads } from "@/mvp/automation/engine";

type Data={settings:Awaited<ReturnType<typeof funnelStatus>>;threads:Awaited<ReturnType<typeof listFunnelThreads>>};
const LABELS:Record<string,string>={qualifying:"Checking product fit",needs_contact:"Contact check needed",active:"Waiting for reply",engaged:"Sales conversation",awaiting_time:"Waiting for chosen time",meeting_pending:"Creating meeting",meeting_booked:"Meeting booked",stopped:"Stopped",review:"Needs review"};
export function FunnelWorkbench({initial}:{initial:Data}) {
  const [data,setData]=useState(initial);const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);
  useEffect(()=>{let cancelled=false;const poll=async()=>{try{const next=await apiJson<Data>("/api/mvp/automation");if(!cancelled)setData(next);}catch{if(!cancelled)setError("Status refresh failed. Check the local server; no new action was requested.");}};const timer=setInterval(()=>{void poll();},10_000);return()=>{cancelled=true;clearInterval(timer);};},[]);
  const act=async(body:object)=>{setBusy(true);setError(null);try{setData(await apiJson<Data>("/api/mvp/automation",{method:"POST",body}));}catch(e){setError(e instanceof Error?e.message:"Could not update automation.");}finally{setBusy(false);}};
  const connect=async()=>{setBusy(true);setError(null);try{const c=await apiJson<{url:string}>("/api/mvp/automation/calendar/connect",{method:"POST",body:{}});const url=new URL(c.url);if(url.origin!=="https://accounts.google.com")throw new Error("Invalid Google connection URL.");window.location.assign(c.url);}catch(e){setError(e instanceof Error?e.message:"Calendar connection failed.");setBusy(false);}};
  const s=data.settings;
  return <div className="flex flex-col gap-4">
    <section className="card p-5" aria-label="Demo automation setup">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Research → email → reply → meeting</h2><p className="mt-1 text-sm text-[var(--text-2)]">Every outgoing email and calendar invitation is restricted to <strong>{s.recipient}</strong>. Real scraped contacts are evidence, not delivery recipients.</p></div>
        <button disabled={busy || (!s.enabled&&!s.ready)} className={`btn ${s.enabled?"btn-secondary":"btn-primary"}`} onClick={()=>act(s.enabled?{action:"disable"}:{action:"enable",confirmedRecipient:s.recipient})}>{s.enabled?"Pause all automation":"Enable demo funnel"}</button>
      </div>
      <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-4">{["1. Research & qualify","2. Validate named contact","3. Email & understand replies","4. Agree time & book meeting"].map(step=><li key={step} className="rounded-lg bg-[var(--subtle)] p-3 font-semibold">{step}</li>)}</ol>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">{[["Groq AI",s.groq?"Configured":"Key needed"],["Hunter contacts",s.hunter?"Configured":"Key needed"],["Resend receiving",s.receiving||"Receiving domain needed"],["Google Calendar",s.calendar||"Not connected"]].map(([label,value])=><div key={label} className="rounded-lg border border-[var(--line)] p-3"><p className="font-semibold">{label}</p><p className="mt-1 break-words text-xs text-[var(--text-2)]">{value}</p></div>)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-3"><button disabled={busy||!s.calendarSetup} className="btn btn-secondary" onClick={connect}>{s.calendar?"Reconnect Google Calendar":"Connect Google Calendar"}</button><p className="text-xs text-[var(--text-2)]">{s.preferences.duration} minutes · {s.preferences.timeZone} · weekdays {s.preferences.startHour}:00–{s.preferences.endHour}:00 (demo defaults)</p></div>
      {s.configError?<p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Setup required: {s.configError}</p>:null}
      {!s.worker?<p className="mt-3 text-sm text-amber-800">Background worker is off. Enable MVP_FUNNEL_WORKER=on and restart the local server after setup; opening this page does not send mail.</p>:null}
      <p className="mt-3 text-xs text-[var(--text-2)]">Enable once before a new search. Only subsequent completed real searches are enrolled. No per-email Send button. Official company website and current employee role must be reviewed when evidence is uncertain. Maximum two follow-ups, three days apart during working hours; no chasing after a reply or rejection.</p>
      {s.last_error?<p role="alert" className="mt-3 text-sm text-red-700">Worker needs attention: {s.last_error}</p>:null}
      {error?<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>:null}
    </section>
    <section className="card p-5" aria-label="Automated conversations"><h2 className="text-lg font-bold">Conversations ({data.threads.length})</h2>
      {!data.threads.length?<div className="mt-3 text-sm text-[var(--text-2)]"><p>No automated conversations yet. Complete setup, enable the funnel and run a new product search. Zero verified buyers means zero emails.</p><Link href="/find" className="btn btn-primary mt-3">Start a new search</Link></div>:<ul className="mt-3 divide-y divide-[var(--line)]">{data.threads.map(t=><li key={t.id} className="py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><Link href={`/opportunities/${t.opportunity_id}`} className="font-bold text-[var(--accent-2)]">{t.company} · {t.product}</Link><p className="mt-1 text-sm">{t.paused?"Paused · ":""}{LABELS[t.state]||t.state}</p><p className="mt-1 text-xs text-[var(--text-2)]">Search: {t.keyword} · {t.reason}</p></div><div className="flex flex-wrap gap-2"><Link className="btn btn-primary btn-sm" href={`/opportunities/${t.opportunity_id}`}>Open lead & conversation</Link>{!["stopped","meeting_booked"].includes(t.state)?<><button disabled={busy} className="btn btn-secondary btn-sm" onClick={()=>act({action:t.paused?"resume":"pause",threadId:t.id})}>{t.paused?"Resume":"Pause"}</button>{["needs_contact","review"].includes(t.state)?<button disabled={busy} className="btn btn-secondary btn-sm" onClick={()=>act({action:"retry",threadId:t.id})}>Retry checked step</button>:null}<button disabled={busy} className="btn btn-secondary btn-sm" onClick={()=>act({action:"stop",threadId:t.id})}>Stop</button></>:null}</div></div>{t.summary?<p className="mt-2 whitespace-pre-wrap text-sm">{t.summary}</p>:null}{t.meet_url?<a href={t.meet_url} className="mt-2 inline-block text-sm font-semibold text-[var(--accent-2)] underline" target="_blank" rel="noreferrer">Open confirmed Google Meet</a>:null}</li>)}</ul>}
    </section>
  </div>;
}
