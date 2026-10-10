import Link from "next/link";
import { PackageSearch } from "lucide-react";
import { getActiveProducts, getClientProfile } from "@/mvp/config/profile";
import { marketName } from "@/mvp/config/markets";
import { getRun, isUuid } from "@/mvp/repo";
import { listSavedSearches } from "@/mvp/saved-searches";
import { EmptyState } from "@/components/mvp/empty-state";
import { FindForm } from "@/components/mvp/find-form";
import { PageHeader } from "@/components/mvp/page-header";
import { SavedSearchesList } from "@/components/mvp/saved-searches-list";
import { catalogueOptions } from "@/components/mvp/search/page-data";
import { materialCatalogue } from "@/mvp/discovery/material-catalogue";
import {funnelStatus} from '@/mvp/automation/config';
import {AutomationReadiness} from '@/components/mvp/outreach/automation-readiness';
import { SearchLiveWorkspace } from "@/components/mvp/research/search-live-workspace";
import { searchWorkspace } from "@/mvp/research/workspace";

interface FindPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Find (docs/mvp/18 §4): the search form, or with ?run=… that search's live workspace. */
export default async function FindPage({ searchParams }: FindPageProps) {
  const params = await searchParams;
  const profile = getClientProfile();
  const products = getActiveProducts();
  const runParam = typeof params.run === "string" && isUuid(params.run) ? params.run : null;
  const ticketParam = typeof params.ticket === "string" ? params.ticket.slice(0, 200) : null;
  // "Run again" from the Dashboard: the form starts with that search's material and countries.
  const againParam = typeof params.again === "string" && isUuid(params.again) ? params.again : null;

  if (!products.length) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Find opportunities" />
        <EmptyState icon={<PackageSearch size={20} aria-hidden />} title="No products yet" text="Add your products in Settings so we know what to look for." showFind={false}>
          <Link href="/settings" className="btn btn-primary">Open Settings</Link>
        </EmptyState>
      </div>
    );
  }

  if (runParam) {
    const workspace = await searchWorkspace(runParam);
    if (workspace) return <SearchLiveWorkspace key={runParam} runId={runParam} initial={workspace} />;
  }
  const [saved, selectedRun,automation] = await Promise.all([listSavedSearches(), runParam ?? againParam ? getRun((runParam ?? againParam)!) : Promise.resolve(null),funnelStatus()]);
  const suggestions = catalogueOptions().slice(0, 8).map(product => product.name);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Find buyers" subtitle="Type what you supply, the way you would in Google. Pick the countries; we find the companies that buy it." />
      <AutomationReadiness status={automation}/>
      <FindForm
        products={catalogueOptions()}
        materials={materialCatalogue()}
        markets={profile.markets.map((code) => ({ code, name: marketName(code) }))}
        suggestions={suggestions}
        initialRunId={runParam}
        initialTicketId={ticketParam}
        initialInput={selectedRun?.adhoc_query ?? null}
      />
      <details className="card p-4"><summary className="cursor-pointer text-sm font-semibold">Scheduled searches ({saved.length})</summary><div className="mt-4"><SavedSearchesList searches={saved} /></div></details>
      <Link href="/dashboard" className="self-start text-sm text-[var(--muted)] underline">See all your searches on the Dashboard</Link>
    </div>
  );
}
