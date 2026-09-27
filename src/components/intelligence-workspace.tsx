import { CircleDot, DatabaseZap, ExternalLink, Filter, Layers3, Radar, Rows3, SearchCheck } from "lucide-react";
import { Badge } from "@/components/badge";
import type { BuyerOpportunity } from "@/types/domain";

interface IntelligenceWorkspaceProps {
  opportunities: BuyerOpportunity[];
}

function materialPackages(opportunity: BuyerOpportunity) {
  const text = [
    opportunity.company.subIndustry,
    opportunity.project?.projectType,
    opportunity.potentialProduct,
    opportunity.latestSignal.summary,
    ...opportunity.requirements.map((requirement) => requirement.productCategory),
    ...opportunity.requirements.map((requirement) => requirement.productType),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (text.includes("water")) {
    return ["DI / GRE pipe", "Valves", "Fittings", "Pumps", "Flow meters", "Civil works"];
  }

  if (text.includes("lng") || text.includes("gas")) {
    return ["Line pipe", "Coatings", "Compressors", "Valves", "Flanges", "Instrumentation"];
  }

  if (text.includes("epc") || text.includes("pipeline")) {
    return ["Steel pipe", "Bends", "Coatings", "Welding consumables", "Valves", "Testing services"];
  }

  return ["Core materials", "Mechanical packages", "Electrical packages", "Civil works", "Inspection services"];
}

function uniqueTopics(opportunities: BuyerOpportunity[]) {
  return Array.from(new Set(opportunities.flatMap((opportunity) => opportunity.intentKeywords ?? []))).slice(0, 8);
}

function sourceSummary(opportunity: BuyerOpportunity) {
  const primary = opportunity.sources[0];
  if (!primary) return "Source pending";
  return `${primary.sourceType} / ${primary.reliability}`;
}

function signalLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function IntelligenceWorkspace({ opportunities }: IntelligenceWorkspaceProps) {
  const topics = uniqueTopics(opportunities);
  const topOpportunities = opportunities.slice(0, 5);
  const selectedOpportunity = topOpportunities[0];
  const regions = Array.from(new Set(opportunities.map((opportunity) => opportunity.company.region ?? opportunity.company.country))).slice(0, 5);
  const packageCount = topOpportunities.reduce((count, opportunity) => count + materialPackages(opportunity).length, 0);

  return (
    <section className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="surface overflow-hidden rounded-xl">
        <div className="flex flex-col gap-4 border-b border-[#e4e7ec] bg-white px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Radar size={17} className="text-[#2563eb]" />
              <h2 className="font-bold text-[#101828]">Intent Intelligence</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[#667085]">
              Public account signals, source evidence, and material implications. Private searched-keyword data can be added through a licensed intent-data source.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:w-[360px]">
            <IntelMetric label="Accounts" value={opportunities.length} />
            <IntelMetric label="Topics" value={topics.length} />
            <IntelMetric label="Packages" value={packageCount} />
          </div>
        </div>

        <div className="grid border-b border-[#e4e7ec] bg-[#fbfcff] lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-b border-[#e4e7ec] p-4 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-[#667085]">
              <Filter size={14} />
              Active Regions
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {regions.map((region) => (
                <span key={region} className="quiet-chip px-2 py-1 text-xs font-semibold">
                  {region}
                </span>
              ))}
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-[#667085]">
              <CircleDot size={14} />
              Matched Public Topics
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {topics.map((topic) => (
                <span key={topic} className="rounded-md border border-[#dbeafe] bg-white px-2.5 py-1 text-xs font-bold text-[#1d4ed8] shadow-sm">
                  {topic}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] border-collapse text-left text-sm">
            <thead className="table-head text-[11px] uppercase">
              <tr>
                <th className="px-4 py-2.5">Account</th>
                <th className="px-4 py-2.5">Detected Signal</th>
                <th className="px-4 py-2.5">Source Quality</th>
                <th className="px-4 py-2.5">Timing</th>
                <th className="px-4 py-2.5">Material Implication</th>
                <th className="px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {topOpportunities.map((opportunity) => (
                <tr key={opportunity.company.id} className="data-table-row align-top">
                  <td className="max-w-[220px] px-4 py-3">
                    <div className="truncate font-bold text-[#101828]">{opportunity.company.canonicalName}</div>
                    <div className="mt-0.5 text-xs text-[#667085]">{opportunity.company.country} / {opportunity.company.industry}</div>
                  </td>
                  <td className="max-w-[260px] px-4 py-3">
                    <div className="font-semibold text-[#101828]">{signalLabel(opportunity.latestSignal.signalType)}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#667085]">{opportunity.latestSignal.summary}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={opportunity.sources[0]?.reliability === "Very High" || opportunity.sources[0]?.reliability === "High" ? "green" : "neutral"}>
                      {sourceSummary(opportunity)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#344054]">{opportunity.project?.stage ?? opportunity.tender?.status ?? "Signal active"}</div>
                    <div className="mt-0.5 text-xs text-[#667085]">{opportunity.latestSignal.signalDate}</div>
                  </td>
                  <td className="max-w-[240px] px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {materialPackages(opportunity).slice(0, 3).map((item) => (
                        <span key={`${opportunity.company.id}-${item}`} className="quiet-chip px-2 py-1 text-xs font-semibold">
                          {item}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <a className="btn-quiet focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-bold" href={opportunity.sources[0]?.url ?? "#"} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} />
                      Evidence
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="surface overflow-hidden rounded-xl">
        <div className="border-b border-[#e4e7ec] bg-white px-4 py-4 text-[#101828]">
          <div className="flex items-center gap-2">
            <Layers3 size={17} className="text-[#2563eb]" />
            <h2 className="font-bold text-[#101828]">Material Expansion</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-[#667085]">Adjacent packages suggested from the project type and requirement language.</p>
        </div>

        {selectedOpportunity ? (
          <div className="border-b border-[#e4e7ec] bg-[#f8fbff] p-4">
            <div className="text-xs font-bold uppercase text-[#667085]">Selected buying context</div>
            <div className="mt-2 text-sm font-bold text-[#101828]">{selectedOpportunity.company.canonicalName}</div>
            <p className="mt-1 line-clamp-3 text-xs leading-5 text-[#667085]">{selectedOpportunity.latestSignal.summary}</p>
          </div>
        ) : null}

        <div className="divide-y divide-[#e4e7ec]">
          {topOpportunities.slice(0, 4).map((opportunity) => (
            <div key={opportunity.company.id} className="bg-white p-4 transition-colors hover:bg-[#fbfcfe]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-[#101828]">{opportunity.company.canonicalName}</div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#667085]">{opportunity.project?.name ?? opportunity.latestSignal.summary}</div>
                </div>
                <Badge tone={opportunity.score.confidence === "High" ? "green" : "neutral"}>{opportunity.score.confidence}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {materialPackages(opportunity).slice(0, 6).map((item) => (
                  <span key={`${opportunity.company.id}-${item}`} className="quiet-chip truncate px-2 py-1 text-xs font-semibold">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 divide-x divide-[#e4e7ec] border-t border-[#e4e7ec]">
          <div className="bg-[#f8fafc] p-4">
            <Rows3 size={15} className="text-[#667085]" />
            <div className="mt-2 text-lg font-bold text-[#101828]">{topics.length}</div>
            <div className="text-xs text-[#667085]">intent topics</div>
          </div>
          <div className="bg-[#f8fafc] p-4">
            <DatabaseZap size={15} className="text-[#667085]" />
            <div className="mt-2 text-lg font-bold text-[#101828]">{packageCount}</div>
            <div className="text-xs text-[#667085]">package hints</div>
          </div>
        </div>
      </aside>
    </section>
  );
}

function IntelMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-[#e4e7ec] bg-[#f8fafc] px-3 py-2 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-[#667085]">
        <SearchCheck size={12} />
        {label}
      </div>
      <div className="mt-1 text-base font-bold text-[#101828]">{value}</div>
    </div>
  );
}
