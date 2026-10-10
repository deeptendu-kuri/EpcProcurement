import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowRight, BadgeCheck, Building2, CalendarCheck, ChevronRight, ClipboardCheck, Layers, Loader2, Mail, MessagesSquare, Pause, Search, UserPlus, Video } from "lucide-react";
import { GuideButton } from "@/components/mvp/tour/guide-button";
import { dashboardData, type DashboardLead, type DashboardSearch } from "@/mvp/dashboard";
import { marketName } from "@/mvp/config/markets";
import { getCatalogueItem } from "@/mvp/config/buyers-config";
import { formatDateTime } from "@/components/mvp/labels";
import { searchKind } from "@/components/mvp/run-steps";
import { SearchControls, SearchStatusChip } from "@/components/mvp/research/search-controls";
import { LiveRefresh, SearchesTable, type SearchSummary } from "@/components/mvp/dashboard/searches-table";
import { countryName } from "@/components/mvp/search/buyer-labels";
import { RatingBadge } from "@/components/mvp/search/results-table";
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
const placeOf = (markets: string[]) => `${markets.slice(0, 3).map(marketName).join(", ")}${markets.length > 3 ? ` +${markets.length - 3}` : ""}`;
const PROOF_WORD: Record<DashboardLead["verification"], { label: string; tone: string }> = {
  website: { label: "Verified", tone: "bg-[var(--good-bg)] text-[var(--good)]" },
  listing: { label: "Listed work", tone: "bg-[var(--info-bg)] text-[var(--info)]" },
  rating: { label: "Likely", tone: "bg-[var(--warn-bg)] text-[var(--warn)]" },
};

/** A search in plain words, for the table and the active cards. */
function summary(s: DashboardSearch): SearchSummary {
  const r = s.run;
  const query = r.adhoc_query?.query || "Product search";
  const product = r.adhoc_query?.productId ? getCatalogueItem(r.adhoc_query.productId)?.shortName : null;
  return {
    id: r.id, query, when: formatDateTime(r.created_at), kind: searchKind(r.status, r.counters ?? {}),
    detail: `${product && product.toLowerCase() !== query.toLowerCase() ? `${product} · ` : ""}${placeOf(r.adhoc_query?.markets ?? [])}`,
    verified: s.verified, likely: s.likely, found: s.found, toCheck: s.toCheck, conversations: s.conversations, meetings: s.meetings,
    cost: [s.minutes !== null ? `${s.minutes} min` : null, s.tokens ? `${compactTokens(s.tokens)} AI tokens` : null].filter(Boolean).join(" · "),
  };
}

/** A running or paused search, with its progress and controls. */
function ActiveCard({ s }: { s: DashboardSearch }) {
  const sum = summary(s);
  const ratio = s.tokenLimit ? Math.min(1, s.tokens / s.tokenLimit) : null;
  return (
    <li className="card flex flex-col gap-3 p-5" data-testid="active-search">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/find?run=${sum.id}`} className="text-[16px] font-semibold tracking-[-0.01em] hover:text-[var(--accent)]">{sum.query}</Link>
          <p className="truncate text-[13px] text-[var(--muted)]">{sum.detail}</p>
        </div>
        <SearchStatusChip kind={sum.kind} />
      </div>
      <dl className="grid grid-cols-3 gap-3 text-[13px]">
        <div><dt className="text-[var(--muted)]">Leads</dt><dd className="text-[20px] font-semibold tabular-nums">{s.verified + s.likely}</dd><dd className="text-[12px] text-[var(--muted)]">{s.verified} verified · {s.likely} likely</dd></div>
        <div><dt className="text-[var(--muted)]">Time</dt><dd className="text-[20px] font-semibold tabular-nums">{s.minutes ?? 0} min</dd></div>
        <div><dt className="text-[var(--muted)]">AI tokens</dt><dd className="text-[20px] font-semibold tabular-nums">{compactTokens(s.tokens)}</dd>
          {ratio !== null ? <dd className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--subtle)]" aria-label={`${Math.round(ratio * 100)}% of this search's AI allowance`}><span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(ratio * 100)}%` }} /></dd> : null}</div>
      </dl>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
        <SearchControls runId={sum.id} kind={sum.kind} size="sm" />
        <Link href={`/crm?run=${sum.id}`} className="btn btn-primary btn-sm ml-auto">Leads<ArrowRight size={13} aria-hidden /></Link>
      </div>
    </li>
  );
}

/**
 * Dashboard (docs/mvp/18 §3, §9): one control centre. The overview numbers, searches running or paused
 * (with Pause / Resume / Finish), what needs the user today, the best new leads, the day's AI allowance,
 * meetings, and every search in a filterable table.
 */
export default async function DashboardPage() {
  const data = await dashboardData();
  const { actions, searches, pipeline } = data;
  const next = actions.nextMeeting;
  const latestLeads = data.latestSearchId ? `/crm?run=${data.latestSearchId}` : "/crm";
  const withTab = (tab: string) => `${latestLeads}${data.latestSearchId ? "&" : "?"}proof=${tab}`;
  const active = searches.filter((s) => { const k = searchKind(s.run.status, s.run.counters ?? {}); return k === "running" || k === "paused"; });
  const today = [
    actions.running.length ? <TodayRow key="run" icon={Loader2} tone="bg-[var(--info-bg)] text-[var(--info)]" text={`${plural(actions.running.length, "search", "searches")} running now`} detail={actions.running.map((r) => r.label).join(", ")} href={`/find?run=${actions.running[0].id}`} cta="Watch" /> : null,
    actions.paused.length ? <TodayRow key="paused" icon={Pause} tone="bg-[var(--warn-bg)] text-[var(--warn)]" text={`${plural(actions.paused.length, "search", "searches")} paused`} detail="Review the leads, then resume or finish." href={`/crm?run=${actions.paused[0].id}`} cta="Review" /> : null,
    actions.review ? <TodayRow key="review" icon={ClipboardCheck} tone="bg-[var(--warn-bg)] text-[var(--warn)]" text={`${plural(actions.review, "email")} waiting for your review`} detail="The AI check held these before sending. Approve or stop them." href="/outreach" cta="Review" /> : null,
    next?.start ? <TodayRow key="meet" icon={Video} tone="bg-[var(--good-bg)] text-[var(--good)]" text={`Next meeting: ${next.company}`} detail={`${next.product} · ${formatDateTime(next.start)}`} href={next.meetUrl ?? "/outreach"} cta={next.meetUrl ? "Join" : "Open"} /> : null,
    actions.inProgress ? <TodayRow key="conv" icon={MessagesSquare} tone="bg-[var(--accent-soft)] text-[var(--accent)]" text={`${plural(actions.inProgress, "conversation")} running on their own`} detail="Intro emails sent; replies are handled automatically." href="/outreach" cta="Follow" /> : null,
    actions.toVerify ? <TodayRow key="verify" icon={BadgeCheck} tone="bg-[var(--warn-bg)] text-[var(--warn)]" text={`${plural(actions.toVerify, "likely lead")} to verify`} detail="Rated from what the sources say. Verified leads can be emailed automatically." href={withTab("likely")} cta="Verify" /> : null,
    actions.newBuyers ? <TodayRow key="new" icon={UserPlus} tone="bg-[var(--accent-soft)] text-[var(--accent)]" text={`${plural(actions.newBuyers, "new lead")} this week`} detail="Saved in the last 7 days." href={latestLeads} cta="Review" /> : null,
    actions.toCheck ? <TodayRow key="check" icon={Building2} tone="bg-[var(--subtle)] text-[var(--text-2)]" text={`${plural(actions.toCheck, "company", "companies")} named but not checked yet`} detail="Found in lists and news; their own websites are not read yet." href={withTab("found")} cta="Check" /> : null,
  ].filter(Boolean);
  const steps: [string, number, string?][] = [["Companies found", pipeline.found], ["Verified leads", pipeline.verified, "own website or listed work"], ["Likely leads", pipeline.likely, "to verify"],
    ["Emailed", pipeline.emailed], ["Replied", pipeline.replied], ["Meetings", pipeline.meetings]];
  const { used, limit } = data.allowance;

  return <div className="flex flex-col gap-8">
    <LiveRefresh active={active.length > 0} />
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">{searches.length ? "Your searches, leads and what needs you today, in one place." : "Find companies that buy the materials you supply."}</p>
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
      <section aria-labelledby="pipeline" className="flex flex-col gap-3">
        <h2 id="pipeline" className="sr-only">Overview</h2>
        <div className="card">
          <ol className="grid grid-cols-2 divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">{steps.map(([label, value, sub]) =>
            <li key={label} className="px-5 py-4"><p className="text-[13px] text-[var(--muted)]">{label}</p><p className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{value}</p>{sub ? <p className="mt-1 text-[12px] text-[var(--muted)]">{sub}</p> : null}</li>)}</ol>
          <p className="border-t border-[var(--line)] px-5 py-3 text-[12px] text-[var(--muted)]">{plural(actions.newBuyers, "new lead")} this week. Companies found counts your {Math.min(searches.length, 8)} most recent searches. A lead is a likely buyer with proof, not a confirmed order. Demo emails go only to the approved inbox.</p>
        </div>
      </section>

      {active.length ? <section aria-labelledby="active" className="flex flex-col gap-3">
        <h2 id="active" className="text-[20px] font-semibold tracking-[-0.015em]">Searches running now</h2>
        <ul className="grid gap-4 md:grid-cols-2">{active.map((s) => <ActiveCard key={s.run.id} s={s} />)}</ul>
      </section> : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="today" className="flex flex-col gap-3">
            <h2 id="today" className="text-[20px] font-semibold tracking-[-0.015em]">Today</h2>
            <div className="card overflow-hidden">
              {today.length ? <ul className="divide-y divide-[var(--line)]">{today}</ul>
                : <p className="px-5 py-6 text-[15px] text-[var(--muted)]">You are all caught up. New leads, replies and meetings will show here.</p>}
            </div>
          </section>
          <section aria-labelledby="best" className="flex flex-col gap-3">
            <h2 id="best" className="text-[20px] font-semibold tracking-[-0.015em]">Best new leads this week</h2>
            {data.topLeads.length ? <ul className="card divide-y divide-[var(--line)] overflow-hidden">{data.topLeads.map((l) => (
              <li key={l.opportunityId} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid="top-lead">
                <div className="min-w-0 flex-1">
                  <Link href={`/opportunities/${l.opportunityId}?returnTo=${encodeURIComponent("/dashboard")}`} className="text-[15px] font-medium hover:text-[var(--accent)]">{l.name}</Link>
                  <p className="text-[12.5px] text-[var(--muted)]">{l.product}{l.country ? ` · ${countryName(l.country) ?? l.country}` : ""}{l.email ? ` · Email: ${l.email}` : ""}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${PROOF_WORD[l.verification].tone}`}>{PROOF_WORD[l.verification].label}</span>
                <RatingBadge score={l.fit} />
                <Link href={l.verification === "rating" ? `/crm?run=${l.runId}&proof=likely` : `/opportunities/${l.opportunityId}?returnTo=${encodeURIComponent("/dashboard")}`} className="btn btn-secondary btn-sm">{l.verification === "rating" ? "Verify" : "Open"}</Link>
              </li>))}</ul>
              : <p className="card px-5 py-6 text-[14px] text-[var(--muted)]">No new leads in the last 7 days. Start a search to find more.</p>}
          </section>
        </div>
        <aside className="flex flex-col gap-8">
          <section aria-labelledby="allowance" className="card p-5">
            <h2 id="allowance" className="text-[15px] font-semibold">AI allowance today</h2>
            {limit ? <>
              <p className="mt-2 text-[26px] font-semibold tabular-nums">{compactTokens(Math.max(0, limit - used))} <span className="text-[14px] font-normal text-[var(--muted)]">tokens left</span></p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--subtle)]" aria-hidden><div className={`h-full rounded-full ${used / limit > 0.8 ? "bg-[var(--warn)]" : "bg-[var(--accent)]"}`} style={{ width: `${Math.min(100, Math.round((used / limit) * 100))}%` }} /></div>
              <p className="mt-2 text-[12.5px] text-[var(--muted)]">{compactTokens(used)} of {compactTokens(limit)} used. A Quick search uses up to 60k. Resets at 00:00 UTC.</p>
            </> : <p className="mt-2 text-[13px] text-[var(--muted)]">No daily limit on this server.</p>}
          </section>
          <section aria-labelledby="meetings" className="flex flex-col gap-3">
            <h2 id="meetings" className="text-[17px] font-semibold tracking-[-0.01em]">Meetings</h2>
            {actions.meetings.length ? <ul className="card divide-y divide-[var(--line)] overflow-hidden">{actions.meetings.map((m, i) => <li key={i} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--good-bg)] text-[var(--good)]"><CalendarCheck size={15} aria-hidden /></span>
                <div className="min-w-0"><p className="truncate text-[14px] font-medium">{m.company}</p><p className="text-[12.5px] text-[var(--muted)]">{m.product}{m.start ? ` · ${formatDateTime(m.start)}` : ""}</p></div></div>
              <div className="flex gap-2">{m.meetUrl ? <a href={m.meetUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Join Google Meet</a> : null}{m.opportunityId ? <Link href={`/opportunities/${m.opportunityId}?tab=conversation`} className="btn btn-secondary btn-sm">Conversation</Link> : null}</div>
            </li>)}</ul> : <p className="card px-4 py-5 text-[13px] text-[var(--muted)]">No meetings yet. Booked meetings appear here.</p>}
          </section>
        </aside>
      </div>

      <section aria-labelledby="searches" className="flex flex-col gap-3" data-tour="overview-searches">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="searches" className="text-[20px] font-semibold tracking-[-0.015em]">Your searches</h2>
          <span className="text-[13px] text-[var(--muted)]">{plural(searches.length, "search", "searches")}</span>
        </div>
        <SearchesTable rows={searches.map(summary)} />
      </section>
    </>}
    {data.earlierSearches.length ? <details className="text-[13px] text-[var(--muted)]"><summary className="cursor-pointer">Earlier searches without a product</summary><ul className="mt-3 space-y-2">{data.earlierSearches.map(r => <li key={r.id}><Link className="underline" href={`/find?run=${r.id}`}>{r.adhoc_query?.query || "Earlier search"} · {formatDateTime(r.created_at)}</Link></li>)}</ul></details> : null}
  </div>;
}
