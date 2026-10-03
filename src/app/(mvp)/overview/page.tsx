import Link from "next/link";
import { PageHeader } from "@/components/mvp/page-header";
import { listOpportunities, recentSearches, isVerified } from "@/mvp/opportunities";
import { marketName } from "@/mvp/config/markets";
import { formatDateTime } from "@/components/mvp/labels";
import { isUuid } from "@/mvp/repo";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const searches = await recentSearches();
  const selected = typeof params.search === "string" && isUuid(params.search) ? searches.find(r => r.id === params.search) : searches.find(r => r.adhoc_query?.productId);
  const results = selected ? await listOpportunities(selected.id) : [];
  const verified = results.filter(isVerified);
  const pending = results.filter(r => r.qualification === "pending");
  return <div className="flex flex-col gap-5">
    <PageHeader title="Your buyer workspace" subtitle="One search at a time. Review fit, find the right contact, then prepare outreach." actions={<Link href="/find" className="btn btn-primary">Find buyers</Link>} />
    <section className="card p-5" aria-label="Getting started">
      <h2 className="text-lg font-bold">Start with the product you want to sell</h2>
      <p className="mt-1 text-sm text-[#6b7280]">Choose a product, country and contact role. We save potential buying companies with evidence; you review the fit before outreach.</p>
      <ol className="mt-4 grid gap-3 text-sm sm:grid-cols-4">{["1. Find buyers", "2. Review buyer fit", "3. Validate contact", "4. Review email"].map(t => <li key={t} className="rounded-lg bg-[var(--subtle)] p-3 font-semibold">{t}</li>)}</ol>
    </section>
    <section className="card p-5" data-tour="overview-kpis" aria-label="Selected search">
      <div className="flex flex-wrap items-center justify-between gap-3"><div>
        <p className="text-xs font-semibold uppercase text-[#6b7280]">Selected search — no mixed results</p>
        <h2 className="mt-1 text-xl font-bold">{selected?.adhoc_query?.query ?? "No product search yet"}</h2>
        <p className="text-sm text-[#6b7280]">{selected ? `${selected.adhoc_query?.markets.map(marketName).join(", ")} · ${selected.status} · ${formatDateTime(selected.created_at)}` : "Run a new search to create a product-specific CRM."}</p>
      </div>{selected ? <Link className="btn btn-primary" href={`/crm?search=${selected.id}`}>Open search results</Link> : <Link className="btn btn-primary" href="/find">Start your first search</Link>}</div>
      <div className="mt-4 grid grid-cols-3 gap-3">{[[results.length, "Saved prospects"], [pending.length, "Need fit review"], [verified.length, "Verified prospects"]].map(([n, label]) => <div key={label} className="rounded-lg border border-[var(--line)] p-3"><p className="text-2xl font-bold">{n}</p><p className="text-xs text-[#6b7280]">{label}</p></div>)}</div>
      <p className="mt-3 text-xs text-[#6b7280]">Verified = reviewed buyer fit + provider-validated email for the requested role. Samples never count as verified.</p>
    </section>
    <section className="card" aria-label="Recent searches"><div className="card-header"><h2 className="card-title">Recent searches</h2><Link href="/crm?search=all" className="btn btn-secondary btn-sm">All searches CRM</Link></div>
      {!searches.length ? <p className="p-5 text-sm text-[#6b7280]">No searches yet. Use Find buyers to begin.</p> : <ul className="divide-y divide-[var(--line)]">{searches.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0"><p className="font-semibold">{r.adhoc_query?.query || "Earlier search"}</p><p className="text-xs text-[#6b7280]">{r.adhoc_query?.markets.map(marketName).join(", ")} · {formatDateTime(r.created_at)} · {r.status} · {r.result_count} product-scoped prospects</p>{!r.adhoc_query?.productId ? <p className="text-xs text-[#b54708]">Legacy search: product provenance unavailable. Existing leads are preserved in Advanced search.</p> : null}</div>
        {r.adhoc_query?.productId ? <div className="flex flex-wrap gap-2"><Link href={`/overview?search=${r.id}`} className="btn btn-secondary btn-sm">Select search</Link><Link href={`/crm?search=${r.id}`} className="btn btn-primary btn-sm">Open results</Link></div> : <Link href={`/find?run=${r.id}`} className="btn btn-secondary btn-sm">View search log</Link>}
      </li>)}</ul>}
    </section>
  </div>;
}
