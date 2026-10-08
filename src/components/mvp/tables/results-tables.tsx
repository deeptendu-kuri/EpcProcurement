'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import type {TableQuery,TableResult,TableRow,TableContact,TableTab} from '@/mvp/crm/contracts';
import {rowKey,tableParams} from '@/mvp/crm/contracts';
import {marketName} from '@/mvp/config/markets';
import {BUYER_ROLE_LABELS,BUYER_STAGE_LABELS} from '@/mvp/buyers/types';
import {AddToListDialog} from '../search/lead-lists';
import {AddContactModal} from '../buyers/add-contact-modal';
import {addContact} from '../buyers/chain-api';
import {apiJson} from '../api-client';
import {tableCsv} from './export';

const tabs:Record<TableTab,string>={leads:'Leads',contractors:'Contractors',subcontractors:'Subcontractors & suppliers',contacts:'Contacts'};
const columns:Record<TableTab,string[]>={
  leads:['Company','What they do','Trigger','When','Value','Where','What we can sell them','Keyword','Fit','Contacts','Evidence','Status'],
  contractors:['Company','Role','Project','Owner','Value','Date','Country','Sources','Status'],
  subcontractors:['Company','Supplies / does','Linked to','How we know','Country','What we can sell them','Contacts','Sources'],
  contacts:['Person / role','Buying role','Company','Tier','Status','Email / phone','Source','Actions'],
};
export function ResultsTables({data,query,onOpen}: {data:TableResult;query:TableQuery;onOpen?:(row:TableRow)=>void}){
  const router=useRouter();const [selected,setSelected]=useState<string[]>([]);const [list,setList]=useState(false);
  const [adding,setAdding]=useState<TableContact|null>(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const href=(patch:Partial<TableQuery>)=>`/crm?${tableParams({...query,...patch})}`;
  const refFor=(r:TableRow)=>data.facets.workspaces.find(w=>w.companyId===r.companyId&&(!('opportunityId' in r)||!r.opportunityId||w.opportunityId===r.opportunityId));
  const chosen=data.rows.filter(r=>selected.includes(rowKey(r)));
  const leadIds=[...new Set(chosen.flatMap(r=>{const ref=refFor(r);return ref?[ref.leadId]:[]}))];
  const open=(r:TableRow)=>{const ref=refFor(r);if(onOpen)onOpen(r);else if(ref)router.push(`/opportunities/${ref.opportunityId}?returnTo=${encodeURIComponent(href({}))}`);};
  const toggle=(key:string)=>setSelected(old=>old.includes(key)?old.filter(k=>k!==key):[...old,key]);
  const demo=async()=>{
    const ids=[...new Set(chosen.flatMap(r=>{const ref=refFor(r);return ref?[ref.opportunityId]:[]}))];
    if(!ids.length)return;setBusy(true);setMessage('');
    try{
      const config=await apiJson<{settings:{recipient:string}}>(`/api/mvp/automation/conversation/${ids[0]}`);
      if(!window.confirm(`Start ${ids.length} demo conversation(s)? All mail goes ONLY to ${config.settings.recipient}. No buyers will be emailed.`))return;
      let started=0;const errors:string[]=[];
      for(const id of ids){try{await apiJson(`/api/mvp/automation/conversation/${id}`,{method:'POST',body:{action:'start_demo',confirmedRecipient:config.settings.recipient}});started++;}catch(e){errors.push(e instanceof Error?e.message:'Could not start');}}
      setMessage(`${started} demo conversation(s) started.${errors.length?' '+errors.join(' · '):''}`);
    }catch(e){setMessage(e instanceof Error?e.message:'Could not start demo');}finally{setBusy(false);}
  };
  const download=()=>{const url=URL.createObjectURL(new Blob([tableCsv(chosen)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='buyers.csv';a.click();URL.revokeObjectURL(url);};
  const companyButton=(r:TableRow,name:string)=><button type="button" className="text-left font-semibold text-[var(--accent-2)] hover:underline" onClick={()=>open(r)}>{name}</button>;
  function cells(r:TableRow){
    if('slotId' in r)return [companyButton(r,r.person?.name??r.title),r.role.replaceAll('_',' '),r.companyName,r.tier,r.validated?'Validated':r.person?'Likely':'Not found',r.email||r.phone||'',r.source,
      <div key="actions" className="flex gap-2"><a href={r.findLinks[0]?.url} target="_blank" rel="noreferrer" className="underline">Find</a><button onClick={()=>setAdding(r)} className="underline">Add</button>{refFor(r)?<Link href={`/opportunities/${refFor(r)!.opportunityId}?tab=contacts`} className="underline">Validate</Link>:null}</div>];
    if('linkedToCompanyId' in r)return [companyButton(r,r.name),r.supplies,r.linkedToName,<span key="link" className="pill">{r.link.charAt(0).toUpperCase()+r.link.slice(1)}</span>,r.country?marketName(r.country):'',r.sellSummary,`${r.contactsFound} of ${r.contactsTotal}`,`${r.sourceCount} sources`];
    if(query.tab==='contractors'&&'role' in r)return [companyButton(r,r.name),r.role.replaceAll('_',' '),r.projectName??'',r.ownerName??'',r.trigger?.valueText??'',r.trigger?.date??'',r.operatingCountry?marketName(r.operatingCountry):'',`${r.sourceCount} sources`,BUYER_STAGE_LABELS[r.stage]];
    return [companyButton(r,r.name),r.whatTheyDo,<div key="trigger"><span className="pill">{r.trigger?.kind==='capability'?'Capability only':r.trigger?.kind??'Unknown'}</span><p className="mt-1 line-clamp-3 max-w-80 text-xs">{r.trigger?.title??''}</p></div>,r.trigger?.date??'',r.trigger?.valueText??'',r.operatingCountry?marketName(r.operatingCountry):'',r.sellSummary,refFor(r)?.keyword??'',`${r.fitScore} · ${r.howSure}`,`${r.contactsFound} of ${r.contactsTotal}`,`${r.sourceCount} sources`,BUYER_STAGE_LABELS[r.stage]];
  }
  return <section aria-label="Search results tables" className="space-y-4">
    <nav aria-label="Result types" className="flex flex-wrap gap-2">{Object.entries(tabs).map(([tab,label])=><Link key={tab} href={href({tab:tab as TableTab,page:1})} aria-current={query.tab===tab?'page':undefined} className={`btn ${query.tab===tab?'btn-primary':'btn-secondary'}`}>{label} ({data.facets.counts[tab as TableTab]})</Link>)}</nav>
    <form action="/crm" aria-label="Lead filters" className="card grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
      <input type="hidden" name="run" value={query.run}/><input type="hidden" name="tab" value={query.tab}/>
      <label className="text-xs font-semibold">Search companies<input className="input mt-1 w-full" name="q" defaultValue={query.q} placeholder="Company, work or project"/></label>
      <label className="text-xs font-semibold">Keyword<input className="input mt-1 w-full" name="keyword" defaultValue={query.keyword} placeholder="Original search keyword"/></label>
      <label className="text-xs font-semibold">Available contact role<select name="contactRole" className="control mt-1 w-full" defaultValue={query.contactRole??''}><option value="">All companies · contacts optional</option>{['decision_maker','buyer','technical_approver','influencer','approver','vendor_registration'].map(r=><option key={r} value={r}>{r.replaceAll('_',' ')}</option>)}</select></label>
      <label className="text-xs font-semibold">Work country<select name="country" className="control mt-1 w-full" defaultValue={query.country??''}><option value="">All result countries</option>{data.facets.countries.map(c=><option key={c} value={c}>{marketName(c)}</option>)}</select></label>
      <label className="text-xs font-semibold">Buyer role<select name="role" className="control mt-1 w-full" defaultValue={query.role??''}><option value="">All roles</option>{data.facets.roles.map(r=><option key={r} value={r}>{BUYER_ROLE_LABELS[r]}</option>)}</select></label>
      <label className="text-xs font-semibold">Trigger kind<select name="trigger" className="control mt-1 w-full" defaultValue={query.trigger??''}><option value="">All triggers</option>{['award','order','tender','subcontract','capability'].map(t=><option key={t}>{t}</option>)}</select></label>
      <label className="text-xs font-semibold">Trigger age<select name="age" className="control mt-1 w-full" defaultValue={query.age??''}><option value="">Any date</option>{['30','90','365','540'].map(n=><option key={n} value={n}>Last {n} days</option>)}<option value="undated">Date not established</option></select></label>
      <label className="text-xs font-semibold">Searched product<select name="product" className="control mt-1 w-full" defaultValue={query.product??''}><option value="">All searched products</option>{data.facets.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="text-xs font-semibold">Fit<select name="fit" className="control mt-1 w-full" defaultValue={query.fit??''}><option value="">Any fit score</option>{Object.entries(BUYER_STAGE_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold">Contact availability<select name="contacts" className="control mt-1 w-full" defaultValue={query.contacts??''}><option value="">All companies · contacts optional</option><option value="named">Named contact</option><option value="validated">Validated email</option><option value="missing">Contacts not found</option></select></label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="showRejected" value="1" defaultChecked={query.showRejected==='1'}/>Show rejected</label>
      <div className="flex items-end gap-2"><button className="btn btn-primary">Apply</button><Link href={`/crm?run=${query.run}&tab=${query.tab}`} className="btn btn-secondary">Clear</Link></div>
    </form>
    <p className="text-sm text-[var(--muted)]">Source-backed potential companies remain visible even without contacts. Scores prioritise review; they do not prove a purchase. Capability-only companies are Early.</p>
    {selected.length?<div className="card flex flex-wrap items-center gap-3 p-3"><strong>{selected.length} selected</strong><button disabled={!leadIds.length} className="btn btn-secondary btn-sm" onClick={()=>setList(true)}>Add to list</button><button className="btn btn-secondary btn-sm" onClick={download}>Export CSV</button><button disabled={busy||!leadIds.length||chosen.length>5} className="btn btn-primary btn-sm" onClick={demo}>Start demo conversation</button><span className="text-xs">Approved inbox only · maximum 5</span></div>:null}
    {message?<p role="status" className="text-sm">{message}</p>:null}
    <div className="card overflow-hidden"><div className="card-header"><h2 className="card-title">{data.total} {tabs[query.tab].toLowerCase()}</h2><label className="flex items-center gap-2 text-xs">Sort<select aria-label="Sort results" value={query.sort} onChange={e=>router.push(href({sort:e.target.value as TableQuery['sort'],page:1}))} className="control"><option value="date_desc">Newest trigger</option><option value="date_asc">Oldest trigger</option><option value="fit_desc">Highest fit</option><option value="fit_asc">Lowest fit</option><option value="value_desc">Highest value</option><option value="value_asc">Lowest value</option><option value="name">Company name</option></select></label></div>
    {!data.rows.length?<div className="p-6"><h3 className="font-semibold">{query.tab==='contractors'?`No contractors with a verified award/order in this search yet — ${data.facets.capabilityOnly} capability-only companies are under Leads.`:query.tab==='subcontractors'?'No source-backed contractor links yet. Related work alone is not proof of a subcontract.':'No matching results. Clear filters or try another search.'}</h3><Link href={href({tab:'leads',page:1})} className="btn btn-secondary mt-3">View leads</Link></div>:<div className="max-h-[70vh] overflow-auto"><table aria-label={tabs[query.tab]} className="w-full min-w-[1150px] text-left text-sm"><thead className="sticky top-0 z-10 bg-[var(--subtle)] text-xs"><tr><th className="p-3"><input type="checkbox" aria-label="Select this page" checked={data.rows.length>0&&selected.length===data.rows.length} onChange={()=>setSelected(selected.length===data.rows.length?[]:data.rows.map(rowKey))}/></th>{columns[query.tab].map(h=><th key={h} className="p-3">{h}</th>)}<th className="p-3">Workspace</th></tr></thead><tbody>{data.rows.map(r=><tr key={rowKey(r)} className="border-t border-[var(--line)] align-top hover:bg-[var(--subtle)]"><td className="p-3"><input type="checkbox" aria-label={`Select ${'name' in r?r.name:r.companyName+' '+r.title}`} checked={selected.includes(rowKey(r))} onChange={()=>toggle(rowKey(r))}/></td>{cells(r).map((c,i)=><td key={i} className="p-3">{c}</td>)}<td className="p-3">{refFor(r)?<Link className="whitespace-nowrap text-[var(--accent-2)] underline" href={`/opportunities/${refFor(r)!.opportunityId}?returnTo=${encodeURIComponent(href({}))}`}>Open workspace</Link>:<button onClick={()=>open(r)} className="underline">Evidence</button>}</td></tr>)}</tbody></table></div>}
    <footer className="flex items-center justify-between gap-3 border-t border-[var(--line)] p-3 text-sm"><span>Page {query.page} of {Math.max(1,Math.ceil(data.total/query.size))}</span><label>Rows <select className="control" aria-label="Rows per page" value={query.size} onChange={e=>router.push(href({size:Number(e.target.value) as TableQuery['size'],page:1}))}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label><div className="flex gap-3">{query.page>1?<Link href={href({page:query.page-1})}>Previous</Link>:null}{query.page*query.size<data.total?<Link href={href({page:query.page+1})}>Next</Link>:null}</div></footer></div>
    {data.facets.truncated?<p role="status">Newest 2,000 opportunities shown. Select an individual search to narrow results.</p>:null}
    {list?<AddToListDialog leadIds={leadIds} onClose={()=>setList(false)}/>:null}
    {adding?<AddContactModal company={adding.companyName} slotTitle={adding.title} onClose={()=>setAdding(null)} onSubmit={async values=>{await addContact({...values,companyId:adding.companyId,slotId:adding.slotId,leadId:refFor(adding)?.leadId});router.refresh();}}/>:null}
  </section>;
}
