import Link from 'next/link';
import {recentSearches} from '@/mvp/opportunities';
import {crmTables} from '@/mvp/crm/tables';
import {tableQuerySchema,tableParams} from '@/mvp/crm/contracts';
import {ResultsTables} from '@/components/mvp/tables/results-tables';
import {formatDate} from '@/components/mvp/labels';
export const dynamic='force-dynamic';
export default async function CrmPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams;const searches=await recentSearches();
  const raw=Object.fromEntries(Object.entries(params).filter(([k,v])=>typeof v==='string'&&v!==''&&k!=='search'&&k!=='open'&&k!=='view'));
  raw.run=String(params.run??params.search??searches.find(s=>s.adhoc_query?.productId)?.id??'none');
  const parsed=tableQuerySchema.safeParse(raw);
  if(!parsed.success)return <div className="p-6"><h1 className="page-title">Invalid lead filters</h1><Link href="/crm">Reset filters</Link></div>;
  const query=parsed.data;const data=await crmTables(query);
  const selected=searches.find(r=>r.id===query.run);
  return <div className="flex flex-col gap-5 p-5 lg:p-7">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="page-title">Leads</h1><p className="page-desc">Select a search. Explore companies, their work, contacts and evidence.</p></div><Link href="/find" className="btn btn-primary">New search</Link></header>
    <form action="/crm" className="card flex flex-wrap items-end gap-4 p-4" aria-label="Select search"><label className="min-w-64 flex-1 text-sm font-semibold">Search<select name="run" defaultValue={query.run} className="control mt-1 w-full p-2"><option value="none">Choose a search</option>{searches.filter(s=>s.adhoc_query?.productId).map(s=><option key={s.id} value={s.id}>{s.adhoc_query?.query} · {formatDate(s.created_at)}</option>)}<option value="all">All searches (explicit)</option></select></label><input type="hidden" name="tab" value={query.tab}/><button className="btn btn-secondary">Show results</button><div className="text-xs text-[var(--muted)]">{selected?.adhoc_query?.markets?.join(', ')}{selected?<p>Updated {formatDate(selected.finished_at??selected.created_at)}</p>:null}</div></form>
    <ResultsTables key={tableParams(query).toString()} data={data} query={query}/>
    <Link href="/search" className="text-sm text-[var(--muted)] underline">SuperSearch · explore across searches</Link>
  </div>;
}
