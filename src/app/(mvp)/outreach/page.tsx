import { PageHeader } from "@/components/mvp/page-header";
import { CampaignList } from "@/components/mvp/outreach/campaign-list";
import { listCampaigns } from "@/mvp/email/campaigns";

export default async function OutreachPage() {
  return <div className="flex flex-col gap-5"><PageHeader title="Outreach" subtitle="Approved emails, automatic delivery and an honest record of what was sent." />
    <CampaignList campaigns={await listCampaigns()} workerEnabled={process.env.MVP_OUTREACH_WORKER === "on"} />
  </div>;
}
