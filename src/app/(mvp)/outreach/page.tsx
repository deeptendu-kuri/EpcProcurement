import { PageHeader } from "@/components/mvp/page-header";
import { CampaignList } from "@/components/mvp/outreach/campaign-list";
import { listCampaigns } from "@/mvp/email/campaigns";
import { funnelStatus } from "@/mvp/automation/config";
import { listFunnelThreads } from "@/mvp/automation/engine";
import { FunnelWorkbench } from "@/components/mvp/outreach/funnel-workbench";

export default async function OutreachPage() {
  return <div className="flex flex-col gap-5"><PageHeader title="Email automation" subtitle="Set up once. Follow each real lead from research to a sales conversation and meeting." />
    <FunnelWorkbench initial={{settings:await funnelStatus(),threads:await listFunnelThreads()}} />
    <details className="card p-4"><summary className="cursor-pointer font-semibold">Earlier manually approved emails (advanced)</summary><div className="mt-4"><CampaignList campaigns={await listCampaigns()} workerEnabled={process.env.MVP_OUTREACH_WORKER === "on"} /></div></details>
  </div>;
}
