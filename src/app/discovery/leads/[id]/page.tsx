import { AppShell } from "@/components/app-shell";
import { DiscoveryLeadDetail } from "@/components/discovery-lead-detail";

interface DiscoveryLeadDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function DiscoveryLeadDetailPage({ params }: DiscoveryLeadDetailPageProps) {
  const { id } = await params;

  return (
    <AppShell>
      <DiscoveryLeadDetail leadId={id} />
    </AppShell>
  );
}
