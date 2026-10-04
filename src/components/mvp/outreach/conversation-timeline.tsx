"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import { apiJson } from "../api-client";
import { formatDateTime } from "../labels";
import type { listFunnelThreads,listThreadMessages } from "@/mvp/automation/engine";
type Data={threads:Awaited<ReturnType<typeof listFunnelThreads>>;messages:Awaited<ReturnType<typeof listThreadMessages>>};
export function ConversationTimeline({opportunityId,testThreadId}:{opportunityId?:string;testThreadId?:string}) {
  const [data,setData]=useState<Data|null>(null);const [error,setError]=useState(false);
  useEffect(()=>{let cancelled=false;const endpoint=testThreadId?`/api/mvp/automation/test/${testThreadId}`:`/api/mvp/automation/conversation/${opportunityId}`;const load=async()=>{try{const result=await apiJson<Data>(endpoint);if(!cancelled){setData(result);setError(false);}}catch{if(!cancelled)setError(true);}};const first=setTimeout(()=>{void load();},0);const timer=setInterval(()=>{void load();},10_000);return()=>{cancelled=true;clearTimeout(first);clearInterval(timer);};},[opportunityId,testThreadId]);
  const thread=data?.threads[0];
  return <section className="mt-4" aria-label="Automatic email conversation"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Email automation timeline</h3><Link href="/outreach" className="btn btn-secondary btn-sm">Setup / pause automation</Link></div>
    {error?<p role="status" className="mt-2 text-sm text-red-700">Conversation could not refresh. No email was requested from this page.</p>:null}
    {!data&&!error?<p className="mt-2 text-sm text-[var(--text-2)]">Loading conversation…</p>:null}
    {data&&!thread?<p className="mt-2 text-sm text-[var(--text-2)]">Not enrolled in the automatic funnel. Enable it before a new real search. Legacy drafts below are separate and do not receive replies automatically.</p>:null}
    {thread?<><p className="mt-2 text-sm">{thread.paused?"Paused · ":""}{thread.state.replaceAll("_"," ")} — {thread.reason}</p>{thread.summary?<p className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--subtle)] p-3 text-sm">{thread.summary}</p>:null}{thread.meet_url?<a href={thread.meet_url} target="_blank" rel="noreferrer" className="btn btn-primary mt-3">Open booked meeting</a>:null}</>:null}
    {data?.messages.length?<ol className="mt-3 space-y-3">{data.messages.map(m=><li key={m.id} className={`rounded-xl border border-[var(--line)] p-4 ${m.direction==="in"?"bg-[var(--accent-soft)]":"bg-white"}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{m.direction==="in"?"Your actual reply":"Sales agent email"} · {m.subject}</p><span className="text-xs text-[var(--text-2)]">{m.state==="accepted"?"Provider accepted — delivery not yet verified":m.state} · {formatDateTime(m.created_at)}</span></div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{m.body}</p>{m.error?<p className="mt-2 text-xs text-red-700">{m.error}</p>:null}</li>)}</ol>:null}
  </section>;
}
