import { LeadCrm } from "@/components/lead-crm";
import { AppShell } from "@/components/app-shell";
import { listBuyerOpportunities } from "@/modules/dashboard/repository";

export default async function LeadsPage() {
  const opportunities = await listBuyerOpportunities({});

  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <header className="px-1 py-2">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="mt-1 text-2xl font-bold tracking-normal text-[#101828]">Leads CRM</h1>
            </div>
          </div>
        </header>

        <LeadCrm opportunities={opportunities} />
      </div>
    </AppShell>
  );
}
