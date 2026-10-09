import Link from "next/link";
import type { ComponentType } from "react";
import { Activity, ArrowRight, Building2, CalendarCheck, ClipboardCheck, Layers, Mail, MessagesSquare, Search, UserPlus, CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/mvp/page-header";
import { GuideButton } from "@/components/mvp/tour/guide-button";
import { dashboardData } from "@/mvp/dashboard";
import { marketName } from "@/mvp/config/markets";
import { getCatalogueItem } from "@/mvp/config/buyers-config";
import { formatDateTime } from "@/components/mvp/labels";
import { runStatusText } from "@/components/mvp/run-steps";

export const dynamic = "force-dynamic";
const journey = [{icon:Search,label:"Search a material"},{icon:Layers,label:"Review buyers and proof"},{icon:Mail,label:"Automatic email and replies"},{icon:CalendarCheck,label:"Meeting booked"}];

function ActionCard({icon:Icon,count,title,text,href,cta}:{icon:ComponentType<{size?:number;className?:string;"aria-hidden"?:boolean}>;count:number;title:string;text:string;href:string;cta:string}) {
  const quiet = count === 0;
  return <Link href={href} className={`card group flex flex-col gap-3 p-5 transition hover:border-[var(--accent)] ${quiet ? "opacity-80" : ""}`}>
    <div className="flex items-center justify-between gap-3"><span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${quiet ? "bg-[var(--subtle)] text-[var(--muted)]" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}><Icon size={20} aria-hidden /></span><span className="text-3xl font-bold tabular-nums">{count}</span></div>
    <div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{text}</p></div>
    <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-2)] group-hover:underline">{cta}<ArrowRight size={14} aria-hidden /></span>
  </Link>;
}

export default async function DashboardPage() {
  const data = await dashboardData();
  const { actions, searches, pipeline } = data;
  const next = actions.nextMeeting;
  const latestLeads = data.latestSearchId ? `/crm?run=${data.latestSearchId}` : "/crm";
  return <div className="flex flex-col gap-6">
    <PageHeader title="Dashboard" subtitle={searches.length ? "Your action plan, every search and its progress, in one place." : "Find companies that buy the materials you supply."}
      actions={searches.length ? <Link href="/find" className="btn btn-primary"><Search size={16} aria-hidden />Find buyers</Link> : undefined} />
    {!searches.length ? <section className="card overflow-hidden" aria-label="Getting started" data-tour="overview-searches">
      <div className="max-w-3xl p-6 sm:p-10">
        <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Search size={24} aria-hidden /></span>
        <h2 className="text-2xl font-bold tracking-tight">Start with what you sell.</h2>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-[var(--muted)]">Type a material the way you would in Google and choose the countries. We find the contractors, subcontractors and fabrication shops that buy it, with the source that shows why.</p>
        <div className="mt-6 flex flex-wrap gap-3"><Link href="/find" className="btn btn-primary">Find buyers<ArrowRight size={16} aria-hidden /></Link><GuideButton /></div>
      </div>
      <ol className="grid gap-4 border-t border-[var(--line)] bg-[var(--subtle)] p-6 text-sm sm:grid-cols-4 sm:px-10">{journey.map(({icon:Icon,label},index) => <li key={label} className="flex items-center gap-2"><Icon size={16} className="shrink-0 text-[var(--accent)]" aria-hidden /><span><span className="text-[var(--muted)]">{index+1}. </span>{label}</span></li>)}</ol>
    </section> : <>
      <section aria-labelledby="action-plan" className="flex flex-col gap-3">
        <h2 id="action-plan" className="text-lg font-bold">Action plan</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ActionCard icon={ClipboardCheck} count={actions.review} title="Emails to review" text={actions.review ? "The AI check held these before sending. Approve or stop them." : "Nothing is waiting for your approval."} href="/outreach" cta="Open Email & meetings" />
          <ActionCard icon={CalendarCheck} count={actions.meetings.length} title="Meetings booked" text={next?.start ? `Next: ${next.company}, ${formatDateTime(next.start)}.` : actions.meetings.length ? "All booked meetings are in the past." : "No meeting booked yet."} href="/outreach" cta="See meetings" />
          <ActionCard icon={MessagesSquare} count={actions.inProgress} title="Conversations in progress" text="Intro emails sent and replies being handled automatically." href="/outreach" cta="Follow conversations" />
          <ActionCard icon={UserPlus} count={actions.newBuyers} title="New buyers this week" text="Companies saved with proof in the last 7 days." href={latestLeads} cta="Review leads" />
          <ActionCard icon={Building2} count={actions.toCheck} title="Companies to check" text="Named by your searches; their own websites are not checked yet." href={`${latestLeads}#found-companies`} cta="Check companies" />
          <ActionCard icon={Activity} count={actions.running.length} title="Searches running" text={actions.running.length ? `Now: ${actions.running.map((r) => r.label).join(", ")}.` : "No search is running."} href={actions.running[0] ? `/find?run=${actions.running[0].id}` : "/find"} cta={actions.running.length ? "See progress" : "Start a search"} />
        </div>
      </section>

      <section className="card overflow-hidden" aria-label="Your searches" data-tour="overview-searches">
        <div className="card-header"><div><h2 className="card-title">Your searches</h2><p className="mt-1 text-sm text-[var(--muted)]">Open any search to see its progress, or go straight to its leads.</p></div><span className="pill">{searches.length} {searches.length === 1 ? "search" : "searches"}</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-[var(--subtle)] text-xs text-[var(--text-2)]"><tr>{["Search","Status","Buyers saved","Companies found","Email","" ].map((h, i) => <th key={i} className="p-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{searches.map(({ run: r, found, toCheck, conversations, meetings }) => {
            const product = r.adhoc_query?.productId ? getCatalogueItem(r.adhoc_query.productId)?.shortName : null;
            const partial = r.counters.researchState === "partial";
            const running = r.status === "running" || r.status === "queued";
            return <tr key={r.id} className="border-t border-[var(--line)] align-top">
              <td className="p-3"><Link href={`/crm?run=${r.id}`} className="font-semibold hover:text-[var(--accent)] hover:underline">{r.adhoc_query?.query || "Product search"}</Link>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{product && product.toLowerCase() !== (r.adhoc_query?.query ?? "").toLowerCase() ? `${product} · ` : ""}{r.adhoc_query?.markets.map(marketName).join(", ")}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{formatDateTime(r.created_at)}</p></td>
              <td className="p-3"><span className={`pill ${running ? "bg-blue-50 text-blue-800" : partial ? "bg-amber-50 text-amber-800" : ""}`}>{runStatusText(r.status, r.counters)}</span></td>
              <td className="p-3"><span className="text-lg font-bold tabular-nums">{r.result_count}</span></td>
              <td className="p-3">{found === null ? <span className="text-[var(--muted)]">—</span> : <><span className="text-lg font-bold tabular-nums">{found}</span>{toCheck ? <p className="text-xs text-[var(--muted)]">{toCheck} to check</p> : null}</>}</td>
              <td className="p-3 text-sm">{conversations ? `${conversations} conversation${conversations === 1 ? "" : "s"}` : <span className="text-[var(--muted)]">Not started</span>}{meetings ? <p className="text-xs text-green-800">{meetings} meeting{meetings === 1 ? "" : "s"} booked</p> : null}</td>
              <td className="p-3"><div className="flex flex-wrap justify-end gap-2"><Link href={`/find?run=${r.id}`} className="btn btn-secondary btn-sm"><CalendarClock size={14} aria-hidden />Progress</Link><Link href={`/crm?run=${r.id}`} className="btn btn-primary btn-sm">Leads<ArrowRight size={14} aria-hidden /></Link></div></td>
            </tr>;
          })}</tbody>
        </table></div>
      </section>

      <section className="card p-5" aria-labelledby="pipeline">
        <h2 id="pipeline" className="card-title">Pipeline</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-5">{[["Companies found",pipeline.found],["Buyers saved",pipeline.buyers],["Intro emails sent",pipeline.emailed],["Replied",pipeline.replied],["Meetings",pipeline.meetings]].map(([label,value],index) =>
          <li key={label as string} className="rounded-lg bg-[var(--subtle)] p-4"><p className="text-xs text-[var(--muted)]">{index + 1}. {label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></li>)}</ol>
        <p className="mt-3 text-xs text-[var(--muted)]">Companies found counts your {Math.min(searches.length, 8)} most recent searches. A saved buyer is a potential buyer with proof, not a confirmed order. Demo emails go only to the approved inbox.</p>
      </section>

      {actions.meetings.length ? <section className="card p-5" aria-labelledby="meetings">
        <h2 id="meetings" className="card-title">Meetings</h2>
        <ul className="mt-3 divide-y divide-[var(--line)] text-sm">{actions.meetings.map((m, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="font-semibold">{m.company}</p><p className="text-xs text-[var(--muted)]">{m.product}{m.start ? ` · ${formatDateTime(m.start)}` : ""}</p></div>
          <div className="flex gap-2">{m.meetUrl ? <a href={m.meetUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Join Google Meet</a> : null}{m.opportunityId ? <Link href={`/opportunities/${m.opportunityId}?tab=conversation`} className="btn btn-secondary btn-sm">Conversation</Link> : null}</div>
        </li>)}</ul>
      </section> : null}
    </>}
    {data.earlierSearches.length ? <details className="text-sm text-[var(--muted)]"><summary className="cursor-pointer">Earlier searches without a product</summary><ul className="mt-3 space-y-2">{data.earlierSearches.map(r => <li key={r.id}><Link className="underline" href={`/find?run=${r.id}`}>{r.adhoc_query?.query || "Earlier search"} · {formatDateTime(r.created_at)}</Link></li>)}</ul></details> : null}
  </div>;
}
