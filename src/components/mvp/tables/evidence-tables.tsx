'use client';
import {useCallback,useEffect,useState} from 'react';
import type {TableQuery,TableResult,TableRow} from '@/mvp/crm/contracts';
import {tableParams} from '@/mvp/crm/contracts';
import {EvidenceDrawer,drawerKey,parseDrawerTarget,type DrawerTarget} from '../evidence/evidence-drawer';
import {ResultsTables} from './results-tables';
export function EvidenceTables({data,query,initialOpen='',embedded=false}:{data:TableResult;query:TableQuery;initialOpen?:string;embedded?:boolean}){
  const [target,setTarget]=useState<DrawerTarget|null>(()=>parseDrawerTarget(initialOpen,query.run));
  const open=useCallback((next:DrawerTarget|null)=>{setTarget(next);const url=new URL(window.location.href);if(next)url.searchParams.set('open',drawerKey(next));else url.searchParams.delete('open');window.history.replaceState(window.history.state,'',url.pathname+url.search);},[]);
  useEffect(()=>{const pop=()=>setTarget(parseDrawerTarget(new URL(window.location.href).searchParams.get('open')??'',query.run));window.addEventListener('popstate',pop);return ()=>window.removeEventListener('popstate',pop);},[query.run]);
  const targetFor=(r:TableRow):DrawerTarget=>{const ref=data.facets.workspaces.find(w=>w.companyId===r.companyId&&(!('opportunityId'in r)||!r.opportunityId||w.opportunityId===r.opportunityId));return ref?{opportunityId:ref.opportunityId,leadId:ref.leadId,run:query.run}:{companyId:r.companyId,run:query.run};};
  const targets=data.rows.map(targetFor);const at=target?targets.findIndex(t=>drawerKey(t)===drawerKey(target)):-1;
  return <><ResultsTables data={data} query={query} onOpen={r=>open(targetFor(r))} embedded={embedded}/>{target?<EvidenceDrawer key={drawerKey(target)} target={{...targets.find(t=>drawerKey(t)===drawerKey(target)),...target}} onClose={()=>open(null)} onTarget={open} onPrevious={at>0?()=>open(targets[at-1]):undefined} onNext={at>=0&&at<targets.length-1?()=>open(targets[at+1]):undefined} returnTo={`/crm?${tableParams(query)}`}/>:null}</>;
}
