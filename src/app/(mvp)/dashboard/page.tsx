import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowRight, Building2, CalendarCheck, ChevronRight, ClipboardCheck, Layers, Loader2, Mail, MessagesSquare, Search, UserPlus, Video } from "lucide-react";
import { GuideButton } from "@/components/mvp/tour/guide-button";
import { dashboardData, type DashboardSearch } from "@/mvp/dashboard";
import { marketName } from "@/mvp/config/markets";
import { getCatalogueItem } from "@/mvp/config/buyers-config";
import { formatDateTime } from "@/components/mvp/labels";
import { runStatusText } from "@/components/mvp/run-steps";
import { compactTokens } from "@/mvp/research/usage";

export const dynamic = "force-dynamic";
type Icon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
const journey: { icon: Icon; label: string }[] = [{ icon: Search, label: "Search a material" }, { icon: Layers, label: "Review buyers and proof" }, { icon: Mail, label: "Automatic email and replies" }, { icon: CalendarCheck, label: "Meeting booked" }];

/** One row of the Today list: an icon, a plain sentence and where to go. */
function TodayRow({ icon: Icon, tone, text, detail, href, cta }: { icon: Icon; tone: string; text: string; detail?: string; href: string; cta: string }) {
  return (
    <li>
      <Link href={href} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--hover)]">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon size={18} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-[var(--text)]">{text}</span>
          {detail ? <span className="block truncate text-[13px] text-[var(--muted)]">{detail}</span> : null}
        </span>
        <span className="flex items-center gap-1 text-[14px] font-medium text-[var(--accent)]">{cta}<ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
      </Link>
    </li>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function SearchRow({ s }: { s: DashboardSearch }) {
  const r = s.run;
  const query = r.adhoc_query?.query || "Product search";
  const product = r.adhoc_query?.productId ? getCatalogueItem(r.adhoc_query.productId)?.shortName : null;
  const markets = r.adhoc_query?.markets ?? [];
  const running = r.status === "running" || r.status === "queued";
  const status = runStatusText(r.status, r.counters);
  const facts = [
    plural(r.result_count, "buyer"),
    s.found !== null ? `${s.found} companies found` : null,
    s.conversations ? plural(s.conversations, "conversation") : null,
    s.meetings ? plural(s.meetings, "meeting") : null,
  ].filter(Boolean).join(" · ");
  const cost = [s.minutes !== null ? `${s.minutes} min` : null, s.tokens ? `${compactTokens(s.tokens)} AI tokens` : null].filter(Boolean).join(" · ");
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/find?run=${r.id}`} className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--text)] hover:text-[var(--accent)]">{query}</Link>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${running ? "bg-[var(--info-bg)] text-[var(--info)]" : /partial/.test(status) ? "bg-[var(--warn-bg)] text-[var(--warn)]" : "bg-[var(--good-bg)] text-[var(--good)]"}`}>
            {running ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}{running ? "Running" : /partial/.test(status) ? "Finished · partial" : status}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">
          {product && product.toLowerCase() !== query.toLowerCase() ? `${product} · ` : ""}{markets.slice(0, 3).map(marketName).join(", ")}{markets.length > 3 ? ` +${markets.length - 3}` : ""} · {formatDateTime(r.created_at)}
        </p>
        <p className="mt-1.5 text-[14px] text-[var(--text-2)]">{facts}{s.toCheck ? <span className="text-[var(--muted)]"> · {s.toCheck} to check</span> : null}</p>
        {cost ? <p className="mt-0.5 text-[12px] text-[var(--muted)]">{cost}</p> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Link href={`/find?run=${r.id}`} className="btn btn-secondary">Open</Link>
        <Link href={`/crm?run=${r.id}`} className="btn btn-primary">Leads<ArrowRight size={15} aria-hidden /></Link>
      </div>
    </li>
  );
}

/** Dashboard (docs/mvp/18 §3): today's actions, the pipeline, every search and upcoming meetings. */
export default async function DashboardPage() {
  const data = await dashboardData();
  const { actions, searches, pipeline } = data;
  const next = actions.nextMeeting;
  const latestLeads = data.latestSearchId ? `/crm?run=${data.latestSearchId}` : "/crm";
  const today = [
    actions.running.length ? <TodayRow key="run" icon={Loader2} tone="bg-[var(--info-bg)] text-[var(--info)]" text={`${plural(actions.running.length, "search", "searches")} running now`} detail={actions.running.map((r) => r.label).join(", ")} href={`/find?run=${actions.running[0].id}`} cta="Watch" /> : null,
    actions.review ? <TodayRow key="review" icon={ClipboardCheck} tone="bg-[var(--warn-bg)] text-[var(--warn)]" text={`${plural(actions.review, "email")} waiting for your review`} detail="The AI check held these before sending. Approve or stop them." href="/outreach" cta="Review" /> : null,
    next?.start ? <TodayRow key="meet" icon={Video} tone="bg-[var(--good-bg)] text-[var(--good)]" text={`Next meeting: ${next.company}`} detail={`${next.product} · ${formatDateTime(next.start)}`} href={next.meetUrl ?? "/outreach"} cta={next.meetUrl ? "Join" : "Open"} /> : null,
    actions.inProgress ? <TodayRow key="conv" icon={MessagesSquare} tone="bg-[var(--accent-soft)] text-[var(--accent)]" text={`${plural(actions.inProgress, "conversation")} running on their own`} detail="Intro emails sent; replies are handled automatically." href="/outreach" cta="Follow" /> : null,
    actions.newBuyers ? <TodayRow key="new" icon={UserPlus} tone="bg-[var(--accent-soft)] text-[var(--accent)]" text={`${plural(actions.newBuyers, "new buyer")} this week`} detail="Saved with proof in the last 7 days." href={latestLeads} cta="Review" /> : null,
    actions.toCheck ? <TodayRow key="check" icon={Building2} tone="bg-[var(--subtle)] text-[var(--text-2)]" text={`${plural(actions.toCheck, "company", "companies")} named but not checked yet`} detail="Found in lists and news; their own websites are not read yet." href={`${latestLeads}#found-companies`} cta="Check" /> : null,
  ].filter(Boolean);
  const steps: [string, number][] = [["Companies found", pipeline.found], ["Buyers saved", pipeline.buyers], ["Emailed", pipeline.emailed], ["Replied", pipeline.replied], ["Meetings", pipeline.meetings]];

  return <div className="flex flex-col gap-8">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">{searches.length ? "What needs you today, and how every search is going." : "Find companies that buy the materials you supply."}</p>
      </div>
      {searches.length ? <Link href="/find" className="btn btn-primary h-10 px-5 text-[14px]"><Search size={16} aria-hidden />Find buyers</Link> : null}
    </header>

    {!searches.length ? <section className="card overflow-hidden" aria-label="Getting started" data-tour="overview-searches">
      <div className="max-w-3xl p-8 sm:p-12">
        <span className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><Search size={24} aria-hidden /></span>
        <h2 className="text-[28px] font-bold tracking-[-0.022em]">Start with what you sell.</h2>
        <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-[var(--muted)]">Type a material the way you would in Google and choose the countries. We find the contractors, subcontractors and fabrication shops that buy it, with the source that shows why.</p>
        <div className="mt-8 flex flex-wrap gap-3"><Link href="/find" className="btn btn-primary h-10 px-5">Find buyers<ArrowRight size={16} aria-hidden /></Link><GuideButton /></div>
      </div>
      <ol className="grid gap-4 border-t border-[var(--line)] bg-[var(--hover)] px-8 py-6 text-[14px] sm:grid-cols-4 sm:px-12">{journey.map(({ icon: Icon, label }, index) => <li key={label} className="flex items-center gap-2"><Icon size={16} className="shrink-0 text-[var(--accent)]" aria-hidden /><span><span className="text-[var(--muted)]">{index + 1}. </span>{label}</span></li>)}</ol>
    </section> : <>
      <section aria-labelledby="today" className="flex flex-col gap-3">
        <h2 id="today" className="text-[20px] font-semibold tracking-[-0.015em]">Today</h2>
        <div className="card overflow-hidden">
          {today.length ? <ul className="divide-y divide-[var(--line)]">{today}</ul>
            : <p className="px-5 py-6 text-[15px] text-[var(--muted)]">You are all caught up. New buyers, replies and meetings will show here.</p>}
        </div>
      </section>

      <section aria-labelledby="pipeline" className="flex flex-col gap-3">
        <h2 id="pipeline" className="text-[20px] font-semibold tracking-[-0.015em]">Pipeline</h2>
        <div className="card">
          <ol className="grid grid-cols-2 divide-[var(--line)] sm:grid-cols-5 sm:divide-x">{steps.map(([label, value]) =>
            <li key={label} className="px-5 py-5"><p className="text-[13px] text-[var(--muted)]">{label}</p><p className="mt-1 text-[30px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{value}</p></li>)}</ol>
          <p className="border-t border-[var(--line)] px-5 py-3 text-[12px] text-[var(--muted)]">Companies found counts your {Math.min(searches.length, 8)} most recent searches. A saved buyer is a likely buyer with proof, not a confirmed order. Demo emails go only to the approved inbox.</p>
        </div>
      </section>

      <section aria-labelledby="searches" className="flex flex-col gap-3" data-tour="overview-searches">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="searches" className="text-[20px] font-semibold tracking-[-0.015em]">Your searches</h2>
          <span className="text-[13px] text-[var(--muted)]">{plural(searches.length, "search", "searches")}</span>
        </div>
        <ul className="card divide-y divide-[var(--line)] overflow-hidden">{searches.map((s) => <SearchRow key={s.run.id} s={s} />)}</ul>
      </section>

      {actions.meetings.length ? <section aria-labelledby="meetings" className="flex flex-col gap-3">
        <h2 id="meetings" className="text-[20px] font-semibold tracking-[-0.015em]">Meetings</h2>
        <ul className="card divide-y divide-[var(--line)] overflow-hidden">{actions.meetings.map((m, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--good-bg)] text-[var(--good)]"><CalendarCheck size={17} aria-hidden /></span>
            <div><p className="text-[15px] font-medium">{m.company}</p><p className="text-[13px] text-[var(--muted)]">{m.product}{m.start ? ` · ${formatDateTime(m.start)}` : ""}</p></div></div>
          <div className="flex gap-2">{m.meetUrl ? <a href={m.meetUrl} target="_blank" rel="noreferrer" className="btn btn-secondary">Join Google Meet</a> : null}{m.opportunityId ? <Link href={`/opportunities/${m.opportunityId}?tab=conversation`} className="btn btn-secondary">Conversation</Link> : null}</div>
        </li>)}</ul>
      </section> : null}
    </>}
    {data.earlierSearches.length ? <details className="text-[13px] text-[var(--muted)]"><summary className="cursor-pointer">Earlier searches without a product</summary><ul className="mt-3 space-y-2">{data.earlierSearches.map(r => <li key={r.id}><Link className="underline" href={`/find?run=${r.id}`}>{r.adhoc_query?.query || "Earlier search"} · {formatDateTime(r.created_at)}</Link></li>)}</ul></details> : null}
  </div>;
}
