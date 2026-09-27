import Link from "next/link";
import { ArrowRight, CalendarClock, Inbox, LayoutDashboard, Sparkles, SquareKanban, TrendingUp } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import { getOverviewStats } from "@/mvp/repo";
import { listSavedSearches } from "@/mvp/saved-searches";
import { ConfidenceChip, SampleBadge } from "@/components/mvp/badges";
import { EmptyState, LoadSampleButton } from "@/components/mvp/empty-state";
import { CLASS_LABELS, disciplineLabel, formatDate, formatDateTime } from "@/components/mvp/labels";
import { leadsHref } from "@/components/mvp/leads/url-state";
import { RefreshNow } from "@/components/mvp/overview/refresh-now";
import { PageHeader } from "@/components/mvp/page-header";

function Kpi({ label, value, hint, href, icon }: { label: string; value: number; hint: string; href: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="card group flex flex-col gap-2 p-4 transition-shadow hover:shadow-md">
      <span className="flex items-center justify-between text-xs font-semibold text-[#6b7280]">
        {label}
        <span className="text-[#9ca3af] transition-colors group-hover:text-[var(--accent)]">{icon}</span>
      </span>
      <span className="text-3xl font-bold tabular-nums tracking-tight text-[#111827]">{value}</span>
      <span className="text-xs text-[#9ca3af]">{hint}</span>
    </Link>
  );
}

function BarList({ title, items, empty }: { title: string; items: { label: string; value: number; href: string }[]; empty: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <section className="card" aria-label={title}>
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
        <span className="text-xs text-[#9ca3af]">open leads</span>
      </div>
      {items.length ? (
        <ul className="flex flex-col gap-1 p-2">
          {items.slice(0, 8).map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--subtle)]"
                title={`Show ${item.value} ${item.value === 1 ? "lead" : "leads"}: ${item.label}`}
              >
                <span className="truncate font-medium text-[#374151]">{item.label}</span>
                <span className="bar-track">
                  <span className="bar-fill block" style={{ width: `${Math.max(4, Math.round((item.value / max) * 100))}%` }} />
                </span>
                <span className="text-right font-semibold tabular-nums text-[#111827]">{item.value}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-sm text-[#9ca3af]">{empty}</p>
      )}
    </section>
  );
}

/** Overview, the new home (docs/mvp/13 §3): KPIs, leads by market and category, latest leads, saved searches. */
export default async function OverviewPage() {
  const [stats, saved] = await Promise.all([getOverviewStats(), listSavedSearches()]);

  const header = <PageHeader title="Overview" subtitle="What is new and what needs you today." actions={<RefreshNow />} />;

  if (!stats.totalLeads) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div data-tour="overview-kpis">
          <EmptyState
            icon={<LayoutDashboard size={20} aria-hidden />}
            title="No leads yet"
            text="Run a search on Find to look for buyers of what you offer, or load sample leads to see how the tool works."
            showSample
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}

      <section aria-label="Key numbers" data-tour="overview-kpis" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="New this week" value={stats.newThisWeek} hint="Added in the last 7 days" href={leadsHref({ tab: "all", added: "7d" })} icon={<Sparkles size={16} />} />
        <Kpi label="Genuine" value={stats.genuine} hint="Open, checked, worth contacting" href={leadsHref({ tab: "genuine" })} icon={<Inbox size={16} />} />
        <Kpi label="Tenders closing ≤ 14 days" value={stats.closingSoon} hint="Open leads, closing soonest first" href={leadsHref({ tab: "all", sort: "closing" })} icon={<CalendarClock size={16} />} />
        <Kpi label="In pipeline" value={stats.inPipeline} hint="Accepted, contacted, RFQ or quoted" href="/pipeline" icon={<SquareKanban size={16} />} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <BarList
          title="Leads by market"
          empty="No open leads."
          items={stats.byMarket.map((item) => ({ label: marketName(item.value), value: item.count, href: leadsHref({ tab: "all", market: item.value }) }))}
        />
        <BarList
          title="Leads by category"
          empty="No category found yet."
          items={stats.byCategory.map((item) => ({ label: disciplineLabel(item.value), value: item.count, href: leadsHref({ tab: "all", category: item.value }) }))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="card" aria-label="Latest leads">
          <div className="card-header">
            <h2 className="card-title">Latest leads</h2>
            <Link href={leadsHref({ tab: "all" })} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-2)] hover:underline">
              See all leads <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
          {stats.latest.length ? (
            <ul className="divide-y divide-[#f0f1f3]">
              {stats.latest.map((lead) => {
                const country = lead.projectCountry ?? lead.buyerCountry;
                return (
                  <li key={lead.id}>
                    <Link href={`/leads/${lead.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[#fafbfc]">
                      <span className="w-8 shrink-0 text-right text-base font-bold tabular-nums text-[#111827]">{lead.score ?? "–"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#111827]">
                          {lead.buyerName}
                          {lead.projectName ? <span className="font-normal text-[#6b7280]"> → {lead.projectName}</span> : null}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#6b7280]">
                          <span>{CLASS_LABELS[lead.class]}</span>
                          {country ? <span>· {marketName(country)}</span> : null}
                          <span>· added {formatDate(lead.createdAt)}</span>
                          {lead.isSample ? <SampleBadge /> : null}
                        </span>
                      </span>
                      <span className="hidden sm:block">
                        <ConfidenceChip band={lead.confidenceBand} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-[#9ca3af]">No open leads right now.</p>
          )}
        </section>

        <section className="card" aria-label="Saved searches">
          <div className="card-header">
            <h2 className="card-title">Saved searches</h2>
            <Link href="/find#saved-searches" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-2)] hover:underline">
              Manage <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
          {saved.length ? (
            <ul className="divide-y divide-[#f0f1f3]">
              {saved.slice(0, 6).map((search) => (
                <li key={search.id} className="px-4 py-3 text-sm">
                  <p className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-[#111827]">{search.name}</span>
                    <span className={`chip ${search.active ? "" : "opacity-70"}`}>
                      {!search.active ? "Paused" : search.refresh_hours ? `Every ${search.refresh_hours} h` : "Manual"}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[#6b7280]">
                    {search.markets.join(" ")}
                    {" · "}
                    {search.last_run_at ? `last run ${formatDateTime(search.last_run_at)}` : "not run yet"}
                    {search.lastRunNewLeads !== null ? ` · ${search.lastRunNewLeads} new` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-2 px-4 py-5 text-sm text-[#6b7280]">
              <p className="flex items-center gap-2"><TrendingUp size={15} aria-hidden /> Save a search on Find and it refreshes every 6 hours by itself.</p>
              <div className="flex flex-wrap gap-2">
                <Link href="/find" className="btn btn-secondary btn-sm">Go to Find</Link>
                {stats.totalLeads < 3 ? <LoadSampleButton className="btn-sm" /> : null}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
