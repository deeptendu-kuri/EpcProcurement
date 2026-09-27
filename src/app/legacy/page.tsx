import Link from "next/link";
import { ResponsiveTable } from "@/components/responsive-table";
import { ArrowRight, BarChart3, DatabaseZap, Globe2, ListChecks, Radar, Search, UsersRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { listBuyerOpportunities } from "@/modules/dashboard/repository";
import type { BuyerOpportunity } from "@/types/domain";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const opportunities = await listBuyerOpportunities({
    query: typeof params.q === "string" ? params.q : undefined,
    country: typeof params.country === "string" ? params.country : undefined,
    confidence: typeof params.confidence === "string" ? params.confidence : undefined,
    minScore: typeof params.minScore === "string" ? Number(params.minScore) : undefined,
  });

  const verifiedCount = opportunities.filter((item) => item.verificationStatus === "Verified Lead").length;
  const decisionMakerCount = opportunities.reduce((count, item) => count + (item.decisionMakers?.length ?? 0), 0);
  const unknownEmailCount = opportunities.flatMap((item) => item.decisionMakers ?? []).filter((person) => person.emailStatus !== "Verified").length;
  const averageScore = Math.round(opportunities.reduce((sum, item) => sum + item.score.score, 0) / Math.max(opportunities.length, 1));
  const topRegions = regionBreakdown(opportunities);
  const latestSignals = [...opportunities].sort((a, b) => b.latestSignal.signalDate.localeCompare(a.latestSignal.signalDate)).slice(0, 5);

  return (
    <AppShell>
      <div className="flex flex-col gap-5">
        <header className="surface overflow-hidden rounded-xl">
          <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="p-5">
              <p className="text-xs font-bold uppercase text-[#2563eb]">Command Center</p>
              <h1 className="mt-1 max-w-5xl text-2xl font-bold tracking-normal text-[#101828]">Buyer pipeline overview</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#475467]">
                Track source-backed accounts, buying signals, and the next actions needed before outreach.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/legacy/discovery" className="btn-primary focus-ring inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-bold">
                  <Search size={16} />
                  Open SuperSearch
                </Link>
                <Link href="/legacy/lead-lists" className="btn-quiet focus-ring inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-bold">
                  <ListChecks size={16} />
                  Review Lists
                </Link>
              </div>
            </div>
            <div className="border-t border-[#e6eaf0] bg-white/70 p-5 xl:border-l xl:border-t-0">
              <div className="grid grid-cols-2 gap-3">
                <HeroMetric label="Verified Accounts" value={verifiedCount} />
                <HeroMetric label="Avg Score" value={averageScore} />
                <HeroMetric label="Role Targets" value={decisionMakerCount} />
                <HeroMetric label="Needs Verification" value={unknownEmailCount} />
              </div>
            </div>
          </div>
        </header>

        <section className="flex min-w-0 flex-col gap-4">
          <div className="surface min-w-0 rounded-lg p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Radar size={17} className="text-[#2563eb]" />
                  <h2 className="font-bold text-[#101828]">Latest Source-Backed Signals</h2>
                </div>
              <p className="mt-1 text-sm text-[#667085]">Recent project, tender, and procurement evidence driving the current account set.</p>
              </div>
            </div>
            <div data-dashboard-table="signals" className="mt-4 overflow-x-auto rounded-md border border-[#e4e7ec]">
              <ResponsiveTable className="w-full border-collapse text-left text-sm">
                <thead className="table-head text-[11px] uppercase">
                  <tr>
                    <th className="w-[25%] px-3 py-2.5">Account</th>
                    <th className="w-[32%] px-3 py-2.5">Signal</th>
                    <th className="w-[18%] px-3 py-2.5">Region</th>
                    <th className="w-[10%] px-3 py-2.5">Score</th>
                    <th className="w-[15%] px-3 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {latestSignals.map((opportunity) => (
                    <tr key={opportunity.company.id} className="border-t border-[#eef2f6] hover:bg-[#f8fafc]">
                      <td className="px-3 py-3">
                        <div className="font-bold text-[#101828]">{opportunity.company.canonicalName}</div>
                        <div className="mt-0.5 text-xs text-[#667085]">{opportunity.project?.name ?? opportunity.tender?.title ?? "Project context"}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="line-clamp-2 text-[#344054]">{opportunity.latestSignal.summary}</div>
                      </td>
                      <td className="px-3 py-3 text-[#344054]">{opportunity.company.region ?? opportunity.company.country}</td>
                      <td className="px-3 py-3">
                        <Badge tone={opportunity.score.score >= 70 ? "green" : "amber"}>{opportunity.score.score}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/legacy/companies/${opportunity.company.id}`} className="btn-quiet focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-bold">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <aside className="surface rounded-lg p-4">
              <div className="flex items-center gap-2">
                <Globe2 size={17} className="text-[#2563eb]" />
                <h2 className="font-bold text-[#101828]">Market Coverage</h2>
              </div>
              <p className="mt-1 text-sm text-[#667085]">Current lead mix based on source-backed account evidence.</p>
              <div className="mt-4 space-y-3">
                {topRegions.map((region) => (
                  <div key={region.label}>
                    <div className="mb-1 flex items-center justify-between text-xs font-bold text-[#344054]">
                      <span>{region.label}</span>
                      <span>{region.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#eef2f6]">
                      <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${region.share}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </aside>
            <ActionCard icon={DatabaseZap} title="Contact Research" value={`${unknownEmailCount} pending`} detail="Contacts and roles requiring verification" href="/legacy/leads" />
            <ActionCard icon={BarChart3} title="Run Health" value="Visible" detail="Operational status and usage" href="/legacy/usage" />
          </div>
        </section>

        <DashboardQueue opportunities={opportunities} />
      </div>
    </AppShell>
  );
}

function regionBreakdown(opportunities: BuyerOpportunity[]) {
  const counts = opportunities.reduce<Record<string, number>>((map, opportunity) => {
    const label = opportunity.company.region ?? opportunity.company.country;
    map[label] = (map[label] ?? 0) + 1;
    return map;
  }, {});
  const max = Math.max(...Object.values(counts), 1);
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count, share: Math.max(12, Math.round((count / max) * 100)) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function DashboardQueue({ opportunities }: { opportunities: BuyerOpportunity[] }) {
  const contacts = opportunities
    .flatMap((opportunity) => (opportunity.decisionMakers ?? []).map((contact) => ({ opportunity, contact })))
    .sort((a, b) => b.opportunity.score.score - a.opportunity.score.score)
    .slice(0, 6);

  return (
    <section>
      <div className="surface overflow-hidden rounded-xl">
        <div className="flex flex-col justify-between gap-3 border-b border-[#e4e7ec] bg-white px-4 py-4 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <UsersRound size={17} className="text-[#2563eb]" />
              <h2 className="font-bold text-[#101828]">Priority Next Actions</h2>
            </div>
            <p className="mt-1 text-sm text-[#667085]">Highest-scoring accounts and role targets ready for review.</p>
          </div>
          <Link href="/legacy/leads" className="btn-primary focus-ring inline-flex h-9 w-fit items-center gap-2 rounded-md px-3 text-sm font-bold">
            Open CRM
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="responsive-records">
          <ResponsiveTable className="w-full border-collapse text-left text-sm">
            <thead className="table-head text-[11px] uppercase">
              <tr>
                <th className="px-4 py-2.5">Decision Maker</th>
                <th className="px-4 py-2.5">Account</th>
                <th className="px-4 py-2.5">Region</th>
                <th className="px-4 py-2.5">Intent Signal</th>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Next Step</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map(({ opportunity, contact }) => (
                <tr key={`${opportunity.company.id}-${contact.id}`} className="border-t border-[#eef2f6] align-top hover:bg-[#f8fafc]">
                  <td className="px-4 py-3">
                    <div className="font-bold text-[#101828]">{contact.name}</div>
                    <div className="mt-1 text-xs text-[#667085]">{contact.title}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-[#101828]">{opportunity.company.canonicalName}</div>
                    <div className="mt-1 text-xs text-[#667085]">{opportunity.project?.name ?? opportunity.tender?.title ?? "Project context pending"}</div>
                  </td>
                  <td className="px-4 py-3 text-[#344054]">{opportunity.company.region ?? opportunity.company.country}</td>
                  <td className="max-w-[220px] px-4 py-3">
                    <div className="truncate font-semibold text-[#101828]">{opportunity.intentKeywords?.[0] ?? "Matched signal"}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#667085]">{opportunity.latestSignal.signalType.replaceAll("_", " ")}</div>
                  </td>
                  <td className="px-4 py-3"><Badge tone={contact.emailStatus === "Verified" ? "green" : contact.emailStatus === "Risky" ? "amber" : "neutral"}>{contact.emailStatus}</Badge></td>
                  <td className="px-4 py-3">
                    <Link href={`/legacy/companies/${opportunity.company.id}`} className="btn-quiet focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-bold">
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </ResponsiveTable>
        </div>
      </div>

    </section>
  );
}
function HeroMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[#e6eaf0] bg-white p-3 shadow-sm">
      <div className="text-[11px] font-bold uppercase text-[#667085]">{label}</div>
      <div className="mt-1 text-2xl font-bold text-[#101828]">{value}</div>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  title,
  value,
  detail,
  href,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  value: string;
  detail: string;
  href: string;
}) {
  return (
    <Link href={href} className="surface group flex items-center gap-3 rounded-lg p-3 transition-colors hover:border-[#bfdbfe] hover:bg-[#fbfdff]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#dbeafe] bg-[#eff6ff] text-[#2563eb]">
          <Icon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-[#101828]">{title}</div>
        <div className="mt-0.5 text-sm font-semibold text-[#2563eb]">{value}</div>
        <p className="mt-0.5 truncate text-xs text-[#667085]">{detail}</p>
      </div>
      <ArrowRight size={16} className="shrink-0 text-[#98a2b3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#2563eb]" />
    </Link>
  );
}
