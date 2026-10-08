'use client';
import {useEffect,useState} from 'react';
import {apiJson} from '../api-client';
import {EvidenceTables} from './evidence-tables';
import {tableQuerySchema,tableParams,type TableResult} from '@/mvp/crm/contracts';
export function WorkspaceChainTables({run,company}:{run:string;company:string}){
  const [tab,setTab]=useState<'contractors'|'subcontractors'>('subcontractors');const [result,setResult]=useState<{tab:string;data?:TableResult;error?:string}>({tab:''});
  const query=tableQuerySchema.parse({run,company,tab});
  useEffect(()=>{const controller=new AbortController();void apiJson<TableResult>(`/api/mvp/crm/tables?${tableParams(tableQuerySchema.parse({run,company,tab}))}`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setResult({tab,data});}).catch(e=>{if(!controller.signal.aborted)setResult({tab,error:e instanceof Error?e.message:'Could not load chain evidence.'});});return ()=>controller.abort();},[run,company,tab]);
  return <section className="card p-4" aria-label="Source-backed chain tables"><h2 className="font-bold">Source-backed contractor relationships</h2><div className="my-3 flex gap-2">{(['contractors','subcontractors'] as const).map(t=><button key={t} className={`btn btn-sm ${tab===t?'btn-primary':'btn-secondary'}`} onClick={()=>setTab(t)}>{t==='contractors'?'Contractors':'Subcontractors & suppliers'}</button>)}</div>{result.tab===tab&&result.data?<EvidenceTables data={result.data} query={query} embedded/>:result.tab===tab&&result.error?<p role="alert">{result.error}</p>:<p role="status">Loading stored relationships…</p>}<p className="mt-3 text-xs text-[var(--muted)]">Only stored, quoted links appear here. The explorer below retains editable research slots and possible partners.</p></section>;
}
