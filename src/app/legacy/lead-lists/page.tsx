import { AppShell } from "@/components/app-shell";
import Link from "next/link";
import { LeadLists } from "@/components/lead-lists";
import { listBuyerOpportunities } from "@/modules/dashboard/repository";

export default async function LeadListsPage() {
  const opportunities = await listBuyerOpportunities();

  return (
    <AppShell>
      <div className="flex flex-col gap-5">
        <header className="surface rounded-xl p-5">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase text-[#2563eb]">Campaign Lists</p>
              <h1 className="mt-1 text-2xl font-bold tracking-normal text-[#101828]">Prepare export-ready segments</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667085]">
                Build focused account and contact lists from discovered buyers, verified roles, and source-backed project evidence.
              </p>
            </div>
            <Link href="/legacy/usage" className="btn-quiet focus-ring inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-semibold">
              Run health
            </Link>
          </div>
        </header>

        <LeadLists opportunities={opportunities} />
      </div>
    </AppShell>
  );
}
