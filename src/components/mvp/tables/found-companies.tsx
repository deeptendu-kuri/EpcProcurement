'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {apiJson} from '../api-client';
import type {FoundCompany} from '@/mvp/research/found';

const EMPTY=<span className="text-[var(--muted)]" aria-label="Not found yet">—</span>;
const statusClass:Record<FoundCompany['status'],string>={saved:'bg-green-50 text-green-900 border-green-200',checking:'bg-blue-50 text-blue-900 border-blue-200',
  not_checked:'bg-[var(--subtle)] text-[var(--text-2)] border-[var(--line)]',no_website:'bg-amber-50 text-amber-900 border-amber-200',
  no_match:'bg-[var(--subtle)] text-[var(--muted)] border-[var(--line)]',unreadable:'bg-amber-50 text-amber-900 border-amber-200'};

/** Every company the search named, shown before its details are checked. Empty cells are filled by "Check now". */
export function FoundCompanies({runId}:{runId:string}){
  const router=useRouter();
  const [data,setData]=useState<{companies:FoundCompany[];active:boolean}|null>(null);
  const [error,setError]=useState('');const [busy,setBusy]=useState<string|null>(null);const [note,setNote]=useState('');
  const url=`/api/mvp/research/${encodeURIComponent(runId)}/companies`;
  const [tick,setTick]=useState(0);
  const working=Boolean(data&&(data.active||data.companies.some(c=>c.status==='checking')));
  const savedCount=data?.companies.filter(c=>c.status==='saved').length??0;
  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      try{const next=await apiJson<{companies:FoundCompany[];active:boolean}>(url,{signal:controller.signal});if(!controller.signal.aborted){setData(next);setError('');}}
      catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load found companies.');}
    })();
    return ()=>controller.abort();
  },[url,tick]);
  useEffect(()=>{
    if(!working)return;
    const timer=setInterval(()=>setTick(n=>n+1),5000);return ()=>clearInterval(timer);
  },[working]);
  // New saved buyers also appear in the tables above.
  const lastSaved=useRef<number|null>(null);
  useEffect(()=>{if(!data)return;if(lastSaved.current!==null&&savedCount>lastSaved.current)router.refresh();lastSaved.current=savedCount;},[data,savedCount,router]);
  const check=async(c:FoundCompany)=>{
    setBusy(c.id);setNote('');
    try{const r=await apiJson<{queued:boolean;message:string}>(`/api/mvp/research/${encodeURIComponent(runId)}/companies`,{method:'POST',body:{candidateId:c.id}});setNote(r.message);setTick(n=>n+1);}
    catch(e){setNote(e instanceof Error?e.message:'Could not start the check.');}
    finally{setBusy(null);}
  };
  if(!data&&!error)return null;
  const all=data?.companies??[];
  // Saved buyers first, then companies still to check; names from page furniture are folded away.
  const order:Record<FoundCompany['status'],number>={saved:0,checking:1,not_checked:2,no_website:3,unreadable:4,no_match:5};
  const rows=all.filter(c=>c.relevant).sort((a,b)=>order[a.status]-order[b.status]);
  const other=all.filter(c=>!c.relevant);
  const table=(list:FoundCompany[],actions:boolean)=><div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm">
      <thead className="bg-[var(--subtle)] text-xs"><tr>{['Company','Found in','What the source says','Website','Work match','Contacts','Status',''].map(h=><th key={h} className="p-3 font-semibold">{h}</th>)}</tr></thead>
      <tbody>{list.map(c=><tr key={c.id} className="border-t border-[var(--line)] align-top">
        <td className="p-3 font-semibold">{c.opportunityId?<Link className="text-[var(--accent-2)] hover:underline" href={`/opportunities/${c.opportunityId}?returnTo=${encodeURIComponent(`/crm?run=${runId}`)}`}>{c.name}</Link>:c.name}</td>
        <td className="p-3">{c.source?.url?<a href={c.source.url} target="_blank" rel="noreferrer" className="underline">{(c.source.title??new URL(c.source.url).hostname).slice(0,60)}</a>:EMPTY}</td>
        <td className="max-w-[280px] p-3 text-xs text-[var(--text-2)]">{c.quote?`“${c.quote.slice(0,160)}${c.quote.length>160?'…':''}”`:EMPTY}</td>
        <td className="p-3">{c.website?<a href={`https://${c.website}`} target="_blank" rel="noreferrer" className="underline">{c.website}</a>:EMPTY}</td>
        <td className="p-3">{c.status==='saved'?'Matched':c.status==='no_match'?'Not shown':EMPTY}</td>
        <td className="p-3">{c.opportunityId?<Link className="underline" href={`/opportunities/${c.opportunityId}?tab=contacts&returnTo=${encodeURIComponent(`/crm?run=${runId}`)}`}>Contacts</Link>:EMPTY}</td>
        <td className="p-3"><span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${statusClass[c.status]}`} title={c.statusText}>{c.status==='no_match'?'Checked · no match':c.statusText}</span></td>
        <td className="p-3">{actions&&['not_checked','no_website','unreadable'].includes(c.status)?<button type="button" disabled={busy!==null} onClick={()=>void check(c)} className="btn btn-secondary btn-sm">{busy===c.id?'Starting…':'Check now'}</button>:null}</td>
      </tr>)}</tbody>
    </table></div>;
  return <section className="card overflow-hidden" aria-label="Companies found by this search">
    <div className="card-header flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="card-title">{rows.length} companies found</h2>
        <p className="text-xs text-[var(--muted)]">Named in contractor lists, project references and news. A company becomes a lead only after its own pages show matching work. Empty cells are not checked yet; use Check now to fetch them.</p></div>
      {working?<span role="status" className="pill">Search still running · updates every 5 s</span>:null}
    </div>
    {error?<p role="alert" className="p-4 text-sm">{error}</p>:null}
    {note?<p role="status" className="px-4 pt-3 text-sm">{note}</p>:null}
    {!rows.length&&!error?<p className="p-4 text-sm text-[var(--muted)]">{working?'Reading sources; companies appear here as they are named.':'No work-related companies were named by the sources read so far.'}</p>:null}
    {rows.length?table(rows,true):null}
    {other.length?<details className="border-t border-[var(--line)] p-4 text-sm"><summary className="cursor-pointer text-[var(--muted)]">{other.length} other names on those pages, not related to this work</summary><div className="mt-3">{table(other,false)}</div></details>:null}
  </section>;
}
