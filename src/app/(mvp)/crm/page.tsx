import Link from 'next/link';
import {recentSearches} from '@/mvp/opportunities';
import {crmTables} from '@/mvp/crm/tables';
import {tableQuerySchema,tableParams} from '@/mvp/crm/contracts';
import {EvidenceTables} from '@/components/mvp/tables/evidence-tables';
import {formatDate} from '@/components/mvp/labels';
import {marketName} from '@/mvp/config/markets';
import {SearchSwitcher} from '@/components/mvp/tables/search-switcher';
export const dynamic='force-dynamic';
export default async function CrmPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams;const searches=await recentSearches();
  const raw=Object.fromEntries(Object.entries(params).filter(([k,v])=>typeof v==='string'&&v!==''&&k!=='search'&&k!=='open'&&k!=='view'));
  raw.run=String(params.run??params.search??searches.find(s=>s.adhoc_query?.productId)?.id??'none');
  if(params.view==='verified'){raw.tab='contacts';raw.contacts='validated';}
  const parsed=tableQuerySchema.safeParse(raw);
  if(!parsed.success)return <div className="p-6"><h1 className="page-title">Invalid lead filters</h1><Link href="/crm">Reset filters</Link></div>;
  const query=parsed.data;const data=await crmTables(query);
  const selected=searches.find(r=>r.id===query.run);
  return <div className="flex flex-col gap-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="page-title">Leads</h1><p className="page-desc">Results for your selected search. Click a company for its evidence, contacts, supply chain and email progress.</p></div><div className="flex gap-2"><Link href="/search" className="btn btn-secondary">SuperSearch · all companies</Link><Link href="/find" className="btn btn-primary">New search</Link></div></header>
    {searches.some(s=>s.adhoc_query?.productId)?<section className="card flex flex-wrap items-end gap-4 p-4" aria-label="Select search"><SearchSwitcher value={query.run} tab={query.tab} options={searches.filter(s=>s.adhoc_query?.productId).map(s=>({id:s.id,label:`${s.adhoc_query?.query} · ${formatDate(s.created_at)}`}))}/><div className="pb-1 text-xs text-[var(--muted)]">{selected?.adhoc_query?.markets?.map(marketName).join(', ')}{selected?<p className="mt-1">Updated {formatDate(selected.finished_at??selected.created_at)} · <Link className="underline" href={`/find?run=${selected.id}`}>Research details</Link></p>:null}{query.run==='all'?<p>Combined saved results. Select a search above for product-specific leads.</p>:null}</div></section>:null}
    {query.run==='none'?<section className="card p-8"><h2 className="text-lg font-bold">Your leads will appear here</h2><p className="mt-2 text-sm text-[var(--muted)]">Start a material search. Its companies, contractors, supply chain and available contacts will be kept together.</p><Link href="/find" className="btn btn-secondary mt-4">Start your first search</Link></section>:<EvidenceTables key={tableParams(query).toString()} data={data} query={query} initialOpen={typeof params.open==='string'?params.open:''}/>}
  </div>;
}
