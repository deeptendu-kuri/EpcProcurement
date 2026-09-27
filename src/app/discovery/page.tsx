import { AppShell } from "@/components/app-shell";
import { DiscoverySearch } from "@/components/discovery-search";
import { getVerifiedOpportunities } from "@/modules/dashboard/verified-data";

export default function DiscoveryPage() {
  const opportunities = getVerifiedOpportunities();

  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <header className="surface rounded-xl px-5 py-4">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <p className="text-xs font-bold uppercase text-[#2563eb]">SuperSearch</p>
              <h1 className="mt-1 text-2xl font-bold tracking-normal text-[#101828]">Find source-backed buyers</h1>
              <p className="mt-1 text-sm text-[#667085]">Search projects, accounts, and buying signals before moving them into CRM or lists.</p>
            </div>
            <div className="rounded-lg border border-[#e4e7ec] bg-[#fbfcfe] px-3 py-2 text-sm font-semibold text-[#475467]">
              <span className="font-bold text-[#101828]">{opportunities.length}</span> verified accounts
            </div>
          </div>
        </header>

        <DiscoverySearch opportunities={opportunities} />

      </div>
    </AppShell>
  );
}
