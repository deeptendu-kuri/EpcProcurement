import { PageHeader } from "@/components/mvp/page-header";
import { CampaignList } from "@/components/mvp/outreach/campaign-list";
import { listCampaigns } from "@/mvp/email/campaigns";
import { funnelStatus } from "@/mvp/automation/config";
import { listFunnelThreads } from "@/mvp/automation/engine";
import { FunnelWorkbench } from "@/components/mvp/outreach/funnel-workbench";
import { Suspense } from "react";

async function EarlierEmails() {
  const campaigns = await listCampaigns();
  return <CampaignList campaigns={campaigns} workerEnabled={process.env.MVP_OUTREACH_WORKER === "on"} />;
}

async function Conversations({ calendarResult }: { calendarResult?: string }) {
  const [settings, threads] = await Promise.all([funnelStatus(), listFunnelThreads()]);
  return <FunnelWorkbench initial={{ settings, threads }} calendarResult={calendarResult} />;
}

export default async function OutreachPage({searchParams}:{searchParams:Promise<{calendar?:string}>}) {
  const query=await searchParams;
  return <div className="flex flex-col gap-5"><PageHeader title="Email automation" subtitle="Set up once. Follow each real lead from research to a sales conversation and meeting." />
    <Suspense fallback={<p role="status" className="card p-5">Loading conversations…</p>}><Conversations calendarResult={query.calendar} /></Suspense>
    <details className="card p-4"><summary className="cursor-pointer font-semibold">Earlier manually approved emails (advanced)</summary><div className="mt-4"><Suspense fallback={<p role="status">Loading earlier emails…</p>}><EarlierEmails /></Suspense></div></details>
  </div>;
}
