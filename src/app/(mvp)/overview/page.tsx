import Link from "next/link";
import { ArrowRight, Search, Layers, Mail, CalendarCheck } from "lucide-react";
import { PageHeader } from "@/components/mvp/page-header";
import { GuideButton } from "@/components/mvp/tour/guide-button";
import { recentSearches } from "@/mvp/opportunities";
import { searchWorkflowCounts } from "@/mvp/opportunities/workspace-stats";
import { marketName } from "@/mvp/config/markets";
import { formatDateTime } from "@/components/mvp/labels";
import { runStatusText } from "@/components/mvp/run-steps";

const journey = [{icon:Search,label:"Search a material"},{icon:Layers,label:"Review companies & contacts"},{icon:Mail,label:"Follow the conversation"},{icon:CalendarCheck,label:"Confirm a meeting"}];

export default async function OverviewPage() {
  const searches = await recentSearches();
  const productSearches = searches.filter(r => r.adhoc_query?.productId);
  const workflowCounts = await searchWorkflowCounts(productSearches.map(r=>r.id));
  return <div className="flex flex-col gap-6">
    <PageHeader title="Your sales workspace" subtitle={productSearches.length ? "Pick a search to continue with its companies, contacts and conversations." : "Find companies that could buy the materials you sell."} actions={productSearches.length ? <Link href="/find" className="btn btn-primary"><Search size={16} aria-hidden />Find buyers</Link> : undefined} />
    {!productSearches.length ? <section className="card overflow-hidden" aria-label="Getting started" data-tour="overview-searches">
      <div className="max-w-3xl p-6 sm:p-10">
        <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Search size={24} aria-hidden /></span>
        <h2 className="text-2xl font-bold tracking-tight">Start with what you sell.</h2>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-[var(--muted)]">Choose a material and the countries you want to sell in. We’ll organise source-backed companies and projects into a dedicated lead workspace for that search.</p>
        <div className="mt-6 flex flex-wrap gap-3"><Link href="/find" className="btn btn-primary">Find buyers<ArrowRight size={16} aria-hidden /></Link><GuideButton /></div>
      </div>
      <ol className="grid gap-4 border-t border-[var(--line)] bg-[var(--subtle)] p-6 text-sm sm:grid-cols-4 sm:px-10">{journey.map(({icon:Icon,label},index) => <li key={label} className="flex items-center gap-2"><Icon size={16} className="shrink-0 text-[var(--accent)]" aria-hidden /><span><span className="text-[var(--muted)]">{index+1}. </span>{label}</span></li>)}</ol>
    </section> : <section className="card overflow-hidden" aria-label="Your searches" data-tour="overview-searches">
      <div className="card-header"><div><h2 className="card-title">Your searches</h2><p className="mt-1 text-sm text-[var(--muted)]">Each search keeps its own leads. Results are never mixed here.</p></div><span className="pill">{productSearches.length} {productSearches.length===1?'search':'searches'}</span></div>
      <ul className="divide-y divide-[var(--line)]">{productSearches.map(r => {
        const workflows = workflowCounts.find(t=>t.run_id===r.id)?.workflow_count ?? 0;
        const meetings = workflowCounts.find(t=>t.run_id===r.id)?.meeting_count ?? 0;
        const partial = r.counters.researchState === "partial";
        return <li key={r.id} className="grid items-center gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(220px,1fr)_150px_90px_170px_auto]">
          <div className="min-w-0"><Link href={`/crm?run=${r.id}`} className="text-base font-bold text-[var(--foreground)] hover:text-[var(--accent)] hover:underline">{r.adhoc_query?.query || "Product search"}</Link><p className="mt-1 text-sm text-[var(--muted)]">{r.adhoc_query?.markets.map(marketName).join(", ")}</p><p className="mt-1 text-xs text-[var(--muted)]">{formatDateTime(r.created_at)}</p></div>
          <div><span className={`pill ${partial ? "bg-amber-50 text-amber-800" : ""}`}>{runStatusText(r.status,r.counters)}</span><Link href={`/find?run=${r.id}`} className="mt-2 block text-xs text-[var(--muted)] underline">Research details</Link></div>
          <div><p className="text-xl font-bold">{r.result_count}</p><p className="text-xs text-[var(--muted)]">saved leads</p></div>
          <div className="text-sm"><p>{workflows ? `${workflows} email workflow${workflows===1?"":"s"}` : "No email workflow yet"}</p><p className="mt-1 text-xs text-[var(--muted)]">{meetings ? `${meetings} meeting${meetings===1?"":"s"} booked` : "No meeting booked"}</p></div>
          <Link href={`/crm?run=${r.id}`} className="btn btn-secondary justify-self-start">View leads<ArrowRight size={15} aria-hidden /></Link>
          {partial ? <p className="text-xs text-amber-800 xl:col-span-5">Partial coverage: {r.counters.researchStopReason || "Some sources could not be completed."} Saved leads remain available.</p> : null}
        </li>;
      })}</ul>
    </section>}
    <p className="text-xs leading-relaxed text-[var(--muted)]">Missing contact details stay blank. A saved company is a potential buyer, not a confirmed purchase. <Link href="/outreach" className="underline">Email automation</Link> shows actual conversation progress; demo emails go only to the configured approved inbox.</p>
    {searches.some(r => !r.adhoc_query?.productId) ? <details className="text-sm text-[var(--muted)]"><summary className="cursor-pointer">Earlier searches without product grouping</summary><ul className="mt-3 space-y-2">{searches.filter(r=>!r.adhoc_query?.productId).map(r=><li key={r.id}><Link className="underline" href={`/find?run=${r.id}`}>{r.adhoc_query?.query || "Earlier search"} · {formatDateTime(r.created_at)}</Link></li>)}</ul><p className="mt-2">These searches are preserved. Explore their saved companies in <Link className="underline" href="/search">SuperSearch</Link>.</p></details> : null}
  </div>;
}
