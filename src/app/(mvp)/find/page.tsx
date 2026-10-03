import Link from "next/link";
import { PackageSearch } from "lucide-react";
import { getActiveProducts, getClientProfile } from "@/mvp/config/profile";
import { marketName } from "@/mvp/config/markets";
import { isUuid, listRecentRuns } from "@/mvp/repo";
import { listSavedSearches } from "@/mvp/saved-searches";
import { EmptyState } from "@/components/mvp/empty-state";
import { FindForm } from "@/components/mvp/find-form";
import { PageHeader } from "@/components/mvp/page-header";
import { RecentRuns } from "@/components/mvp/recent-runs";
import { SavedSearchesList } from "@/components/mvp/saved-searches-list";
import { catalogueOptions } from "@/components/mvp/search/page-data";

interface FindPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Find (docs/mvp/09 §4.1, 13 §7): Search now with live progress, saved searches and recent searches. */
export default async function FindPage({ searchParams }: FindPageProps) {
  const params = await searchParams;
  const profile = getClientProfile();
  const products = getActiveProducts();
  const runParam = typeof params.run === "string" && isUuid(params.run) ? params.run : null;
  const ticketParam = typeof params.ticket === "string" ? params.ticket.slice(0, 200) : null;

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

  const [runs, saved] = await Promise.all([listRecentRuns(10), listSavedSearches()]);
  const suggestions = catalogueOptions().slice(0, 8).map(product => product.name);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Find buyers" subtitle="Choose what you sell, where to search, and who you want to contact." />
      <FindForm
        products={catalogueOptions()}
        markets={profile.markets.map((code) => ({ code, name: marketName(code) }))}
        suggestions={suggestions}
        initialRunId={runParam}
        initialTicketId={ticketParam}
      />
      <SavedSearchesList searches={saved} />
      <RecentRuns runs={runs} />
    </div>
  );
}
