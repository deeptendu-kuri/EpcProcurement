import { notFound } from "next/navigation";
import { getOpportunity } from "@/mvp/opportunities";
import { getBuyerView } from "@/mvp/buyers";
import { getDb } from "@/mvp/db";
import { getLeadDetail, isUuid } from "@/mvp/repo";
import { demoEmailInfo } from "@/mvp/email/config";
import { OpportunityWorkspace } from "@/components/mvp/opportunities/workspace";
import { enrichmentView } from "@/mvp/enrichment";
import { prospectDemoEnabled } from "@/mvp/automation/config";

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string;tab?:string;calendar?:string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const opportunity = await getOpportunity(id);
  if (!opportunity) notFound();
  const buyer = await getBuyerView(opportunity.lead_id);
  if (!buyer) notFound();
  const query = await searchParams;
  // Exact local path only. No protocol-relative/external back links.
  const returnTo = query.returnTo && /^\/crm(?:\?|$)/.test(query.returnTo) ? query.returnTo : `/crm?search=${opportunity.run_id}`;
  const db = getDb();
  const [events, drafts, points, detail] = await Promise.all([
    db.query<{ id: number; body: string; created_at: string }>("select id, body, created_at from opportunity_events where opportunity_id = $1 order by id desc limit 100", [id]),
    db.query<{ id: string; subject: string | null; body: string | null; delivery_state: string | null; delivery_recipient: string | null; campaign_status: string | null; created_at: string }>("select d.id, d.subject, d.body, d.delivery_state, d.delivery_recipient, d.created_at, c.status as campaign_status from outreach_drafts d left join demo_campaigns c on c.draft_id = d.id where d.opportunity_id = $1 order by d.created_at desc limit 50", [id]),
    db.query<{ person_id: string; value: string; verified_at: string | null; source: string; kind: string }>("select cp.person_id, cp.value, cp.verified_at, cp.source, cp.kind from contact_points cp join people p on p.id = cp.person_id where p.current_company_id = $1 and cp.kind in ('email','phone') order by cp.created_at desc", [buyer.companyId]),
    getLeadDetail(opportunity.lead_id),
  ]);
  return <OpportunityWorkspace key={id} opportunity={opportunity} buyer={buyer} detail={detail} events={events.rows} drafts={drafts.rows} points={points.rows} demoEmail={demoEmailInfo()} returnTo={returnTo} enrichment={await enrichmentView(id)} initialTab={query.tab==='conversation'?'conversation':undefined} calendarResult={query.calendar} demoOutreach={prospectDemoEnabled()} />;
}
