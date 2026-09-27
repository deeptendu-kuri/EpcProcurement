import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { LeadLists } from "@/components/lead-lists";
import { listBuyerOpportunities } from "@/modules/dashboard/repository";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LeadListDetailPage({ params }: PageProps) {
  const { id } = await params;
  const opportunities = await listBuyerOpportunities();

  return (
    <AppShell>
      <div className="flex flex-col gap-5">
        <header className="surface rounded-xl p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold uppercase text-[#2563eb]">Campaign Workspace</p>
            <h1 className="mt-2 text-2xl font-bold tracking-normal text-[#101828]">Review export scope</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667085]">
              Review companies, decision makers, source evidence, and email verification state before exporting a focused segment.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">Export guarded</Badge>
            <Badge tone="neutral">Evidence included</Badge>
          </div>
          </div>
        </header>

        <LeadLists opportunities={opportunities} listId={id} />
      </div>
    </AppShell>
  );
}
