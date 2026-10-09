'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {apiJson} from '../api-client';
import type {FoundCompany,LikelyRole} from '@/mvp/research/found';
import {RatingBadge} from '../search/results-table';

const EMPTY=<span className="text-[var(--muted)]" aria-label="Not found yet">—</span>;
const statusClass:Record<FoundCompany['status'],string>={saved:'bg-green-50 text-green-900 border-green-200',checking:'bg-blue-50 text-blue-900 border-blue-200',
  not_checked:'bg-[var(--subtle)] text-[var(--text-2)] border-[var(--line)]',no_website:'bg-amber-50 text-amber-900 border-amber-200',
  no_match:'bg-[var(--subtle)] text-[var(--muted)] border-[var(--line)]',unreadable:'bg-amber-50 text-amber-900 border-amber-200'};
const roleLabel:Record<LikelyRole,string>={owner:'Project owner',contractor:'Contractor',pipe_maker:'Pipe maker',supplier:'Supplier · competitor'};
const roleHint:Record<LikelyRole,string>={owner:'Named as the owner of a project; owners often buy material directly.',contractor:'Described as a construction, engineering or EPC company.',pipe_maker:'Makes or supplies pipe; may compete with you for this product.',supplier:'Says it supplies this kind of material; a competitor rather than a buyer.'};
const order:Record<FoundCompany['status'],number>={saved:0,checking:1,not_checked:2,no_website:3,unreadable:4,no_match:5};
const CHECKABLE:FoundCompany['status'][]=['not_checked','no_website','unreadable'];
const host=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}};
type Data={companies:FoundCompany[];active:boolean};

/** Every company the search named, shown before its details are checked. Empty cells are filled by "Check now". */
export function FoundCompanies({runId}:{runId:string}){
  const router=useRouter();
  const [data,setData]=useState<Data|null>(null);
  const [error,setError]=useState('');const [busy,setBusy]=useState<string|null>(null);const [note,setNote]=useState('');
  const url=`/api/mvp/research/${encodeURIComponent(runId)}/companies`;
  const [tick,setTick]=useState(0);
  const working=Boolean(data&&(data.active||data.companies.some(c=>c.status==='checking')));
  const savedCount=data?.companies.filter(c=>c.status==='saved').length??0;
  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      try{const next=await apiJson<Data>(url,{signal:controller.signal});if(!controller.signal.aborted){setData(next);setError('');}}
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
  const check=async(ids:string[],key:string)=>{
    setBusy(key);setNote('');
    try{const r=await apiJson<{message:string}>(url,{method:'POST',body:ids.length===1?{candidateId:ids[0]}:{candidateIds:ids}});setNote(r.message);setTick(n=>n+1);}
    catch(e){setNote(e instanceof Error?e.message:'Could not start the check.');}
    finally{setBusy(null);}
  };
  if(!data&&!error)return null;
  const all=data?.companies??[];
  // The server orders saved buyers first, then by rating; unrated companies keep the status order.
  const rows=all.filter(c=>c.relevant).sort((a,b)=>Number(Boolean(b.opportunityId))-Number(Boolean(a.opportunityId))||(b.rating??-1)-(a.rating??-1)||order[a.status]-order[b.status]);
  const other=all.filter(c=>!c.relevant);
  const next=rows.filter(c=>CHECKABLE.includes(c.status)).slice(0,5);
  const waiting=rows.filter(c=>CHECKABLE.includes(c.status)).length;
  const name=(c:FoundCompany)=>c.opportunityId?<Link className="text-[var(--accent-2)] hover:underline" href={`/opportunities/${c.opportunityId}?returnTo=${encodeURIComponent(`/crm?run=${runId}`)}`}>{c.name}</Link>:c.name;
  const source=(c:FoundCompany)=>c.source?.url?<a href={c.source.url} target="_blank" rel="noreferrer" className="underline">{(c.source.title??host(c.source.url)).slice(0,60)}</a>:EMPTY;
  const sourceHost=(c:FoundCompany)=>c.source?.url&&c.source.title?<span className="block text-xs text-[var(--muted)]">{host(c.source.url)}</span>:null;
  const role=(c:FoundCompany)=>c.ratingRole?<span className="text-[13px] text-[var(--text-2)]" title="From what the source says; not verified.">{c.ratingRole}</span>
    :c.likelyRole?<span className="pill" title={`${roleHint[c.likelyRole]} From the source wording; not verified.`}>{roleLabel[c.likelyRole]}</span>:EMPTY;
  const rating=(c:FoundCompany)=>c.rating!==null?<RatingBadge score={c.rating}/>:<span className="text-xs text-[var(--muted)]">Not rated</span>;
  const status=(c:FoundCompany)=><span className={`inline-block shrink-0 rounded-full border px-2 py-0.5 text-xs ${statusClass[c.status]}`} title={c.statusText}>{c.status==='no_match'?'Checked · no match':c.statusText}</span>;
  const action=(c:FoundCompany,actions:boolean)=>actions&&CHECKABLE.includes(c.status)?<button type="button" disabled={busy!==null} onClick={()=>void check([c.id],c.id)} className="btn btn-secondary btn-sm shrink-0" aria-label={`Check ${c.name} now`}>{busy===c.id?'Starting…':'Check now'}</button>:null;
  const contacts=(c:FoundCompany)=>c.opportunityId?<Link className="underline" href={`/opportunities/${c.opportunityId}?tab=contacts&returnTo=${encodeURIComponent(`/crm?run=${runId}`)}`}>Contacts</Link>:EMPTY;
  const quote=(c:FoundCompany)=>c.ratingReason?<>{c.ratingReason}{c.alsoBuys.length?<span className="mt-1 block text-[var(--muted)]">Also buys: {c.alsoBuys.join(', ')}</span>:null}</>
    :c.quote?`“${c.quote.slice(0,160)}${c.quote.length>160?'…':''}”`:EMPTY;
  const list=(items:FoundCompany[],actions:boolean)=><>
    <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[960px] text-left text-sm">
      <thead className="border-b border-[var(--line)] text-xs text-[var(--muted)]"><tr>{['Company','Rating','Likely role','Why they would buy','Found in','Website','Status',''].map(h=><th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead>
      <tbody>{items.map(c=><tr key={c.id} className="border-t border-[var(--line)] align-top">
        <td className="p-3 font-semibold">{name(c)}{c.opportunityId?<span className="mt-1 block text-xs font-normal">{contacts(c)}</span>:null}</td>
        <td className="p-3">{rating(c)}</td>
        <td className="p-3">{role(c)}</td>
        <td className="max-w-[300px] p-3 text-xs text-[var(--text-2)]">{quote(c)}</td>
        <td className="p-3">{source(c)}{sourceHost(c)}</td>
        <td className="p-3">{c.website?<a href={`https://${c.website}`} target="_blank" rel="noreferrer" className="underline">{c.website}</a>:EMPTY}</td>
        <td className="p-3">{status(c)}</td>
        <td className="p-3">{action(c,actions)}</td>
      </tr>)}</tbody>
    </table></div>
    <ul className="divide-y divide-[var(--line)] md:hidden">{items.map(c=><li key={c.id} className="space-y-2 p-4 text-sm">
      <div className="flex items-start justify-between gap-3"><p className="min-w-0 font-semibold">{name(c)}</p>{rating(c)}</div>
      <div>{status(c)}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs">{c.likelyRole?role(c):null}{c.website?<a href={`https://${c.website}`} target="_blank" rel="noreferrer" className="underline">{c.website}</a>:<span className="text-[var(--muted)]">Website not checked yet</span>}</div>
      {c.quote?<p className="text-xs text-[var(--text-2)]">{quote(c)}</p>:null}
      <div className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate">{c.source?.url?<>Found in: {source(c)}</>:null}</span>{action(c,actions)}{c.opportunityId?contacts(c):null}</div>
    </li>)}</ul>
  </>;
  return <section id="found-companies" className="card scroll-mt-4 overflow-hidden" aria-label="Companies found by this search">
    <div className="card-header flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="card-title">{rows.length} companies found</h2>
        <p className="text-xs text-[var(--muted)]">Named in contractor lists, project references and news, best rated buyers first. A rating comes from what the source says; a company becomes a lead only after its own pages show matching work. <Link href={`/find?run=${runId}`} className="text-[var(--accent)] hover:underline">Open the search workspace</Link></p></div>
      <div className="flex flex-wrap items-center gap-2">
        {working?<span role="status" className="pill">Search running · updates every 5 s</span>:null}
        {next.length>1?<button type="button" disabled={busy!==null} onClick={()=>void check(next.map(c=>c.id),'bulk')} className="btn btn-primary btn-sm">{busy==='bulk'?'Starting…':`Check next ${next.length}`}</button>:null}
      </div>
    </div>
    {waiting?<p className="px-4 pt-3 text-xs text-[var(--muted)]">{waiting} not checked yet. Checking reads each company&apos;s own website for matching work and contacts; only matches become leads.</p>:null}
    {error?<p role="alert" className="p-4 text-sm">{error}</p>:null}
    {note?<p role="status" className="px-4 pt-3 text-sm">{note}</p>:null}
    {!rows.length&&!error?<p className="p-4 text-sm text-[var(--muted)]">{working?'Reading sources; companies appear here as they are named.':'No work-related companies were named by the sources read so far.'}</p>:null}
    {rows.length?list(rows,true):null}
    {other.length?<details className="border-t border-[var(--line)] p-4 text-sm"><summary className="cursor-pointer text-[var(--muted)]">{other.length} other names on those pages, not related to this work</summary><div className="mt-3">{list(other,false)}</div></details>:null}
  </section>;
}
