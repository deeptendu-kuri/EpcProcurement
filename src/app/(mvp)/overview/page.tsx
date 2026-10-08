import Link from "next/link";
import { PageHeader } from "@/components/mvp/page-header";
import { listOpportunities, recentSearches, isVerified } from "@/mvp/opportunities";
import { marketName } from "@/mvp/config/markets";
import { formatDateTime } from "@/components/mvp/labels";
import { runStatusText } from "@/components/mvp/run-steps";
import { isUuid } from "@/mvp/repo";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const searches = await recentSearches();
  const selected = typeof params.search === "string" && isUuid(params.search) ? searches.find(r => r.id === params.search) : searches.find(r => r.adhoc_query?.productId);
  const results = selected ? (await listOpportunities(selected.id)).filter(o=>o.qualification!=='rejected') : [];
  const verified = results.filter(isVerified);
  const active = results.filter(r => r.activity_status === "recent" || r.activity_status === "ongoing");
  const withContacts = results.filter(r => (r.named_contact_count ?? 0) > 0 || Boolean(r.public_contacts?.length));
  return <div className="flex flex-col gap-5">
    <PageHeader title="Your sales workspace" subtitle="Choose a search to see its projects and leads. Track each conversation through to a meeting." actions={<Link href="/find" className="btn btn-primary">New search</Link>} />
    <section className="card p-5" aria-label="Getting started">
      <h2 className="text-lg font-bold">Start with the product you want to sell</h2>
      <p className="mt-1 text-sm text-[#6b7280]">Search a material and country. We save source-backed companies, projects and available contacts; missing details stay blank. Qualified companies can start the approved-inbox email demo automatically. <Link href="/settings?tab=automation" className="font-semibold underline">Email & Calendar setup</Link> is needed only once.</p>
      <ol className="mt-4 grid gap-3 text-sm sm:grid-cols-4">{["1. New search", "2. Projects & contacts", "3. Email conversation", "4. Booked meeting"].map(t => <li key={t} className="rounded-lg bg-[var(--subtle)] p-3 font-semibold">{t}</li>)}</ol>
    </section>
    <section className="card p-5" data-tour="overview-kpis" aria-label="Selected search">
      <form action="/overview" className="mb-4 flex flex-wrap items-end gap-2"><label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">Which search would you like to view?<select name="search" defaultValue={selected?.id || ""} className="control h-11 min-w-0 px-3"><option value="" disabled>Select your product search</option>{searches.filter(s=>s.adhoc_query?.productId).map(s=><option value={s.id} key={s.id}>{s.adhoc_query?.query} · {s.adhoc_query?.markets.map(marketName).join(", ")} · {formatDateTime(s.created_at)}</option>)}</select></label><button disabled={!searches.some(s=>s.adhoc_query?.productId)} className="btn btn-primary h-11">View this search</button></form>
      <div className="flex flex-wrap items-center justify-between gap-3"><div>
        <p className="text-xs font-semibold uppercase text-[#6b7280]">Selected search — no mixed results</p>
        <h2 className="mt-1 text-xl font-bold">{selected?.adhoc_query?.query ?? "No product search yet"}</h2>
        <p className="text-sm text-[#6b7280]">{selected ? `${selected.adhoc_query?.markets.map(marketName).join(", ")} · ${runStatusText(selected.status,selected.counters)} · ${formatDateTime(selected.created_at)}` : "Run a new search to create a product-specific CRM."}</p>
      </div>{selected ? <Link className="btn btn-primary" href={`/crm?search=${selected.id}`}>Open search results</Link> : <Link className="btn btn-primary" href="/find">Start your first search</Link>}</div>
      {selected?.counters.researchState==='partial' ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-[#b54708]">Research paused; saved companies remain available. {selected.counters.researchStopReason || 'Coverage is incomplete.'} <Link href={`/find?run=${selected.id}`} className="font-semibold underline">View research progress</Link></p> : null}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[[results.length, "Saved prospects"], [active.length, "Recent / ongoing work"], [withContacts.length, "With published / named contacts"], [verified.length, "Validated contacts ready"]].map(([n, label]) => <div key={label} className="rounded-lg border border-[var(--line)] p-3"><p className="text-2xl font-bold">{n}</p><p className="text-xs text-[#6b7280]">{label}</p></div>)}</div>
      <p className="mt-3 text-xs text-[#6b7280]">Counts refer to opportunities in this selected search, not pages or confirmed orders. Companies without contacts remain visible. Validated = reviewed buyer fit + reviewed current role + provider-validated email. Samples never count as validated.</p>
    </section>
    <section className="card" aria-label="Recent searches"><div className="card-header"><h2 className="card-title">Recent searches</h2><Link href="/crm?search=all" className="btn btn-secondary btn-sm">All searches CRM</Link></div>
      {!searches.length ? <p className="p-5 text-sm text-[#6b7280]">No searches yet. Use Find buyers to begin.</p> : <ul className="divide-y divide-[var(--line)]">{searches.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0"><p className="font-semibold">{r.adhoc_query?.query || "Earlier search"}</p><p className="text-xs text-[#6b7280]">{r.adhoc_query?.markets.map(marketName).join(", ")} · {formatDateTime(r.created_at)} · {runStatusText(r.status,r.counters)} · {r.result_count} product-scoped prospects</p>{!r.adhoc_query?.productId ? <p className="text-xs text-[#b54708]">Legacy search: product provenance unavailable. Existing leads are preserved in Advanced search.</p> : null}</div>
        {r.adhoc_query?.productId ? <div className="flex flex-wrap gap-2"><Link href={`/overview?search=${r.id}`} className="btn btn-secondary btn-sm">Select search</Link><Link href={`/crm?search=${r.id}`} className="btn btn-primary btn-sm">Open results</Link></div> : <Link href={`/find?run=${r.id}`} className="btn btn-secondary btn-sm">View search log</Link>}
      </li>)}</ul>}
    </section>
  </div>;
}
