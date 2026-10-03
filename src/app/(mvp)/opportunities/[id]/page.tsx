import { notFound } from "next/navigation";
import { getOpportunity } from "@/mvp/opportunities";
import { getBuyerView } from "@/mvp/buyers";
import { getDb } from "@/mvp/db";
import { isUuid } from "@/mvp/repo";
import { demoEmailInfo } from "@/mvp/email/config";
import { OpportunityWorkspace } from "@/components/mvp/opportunities/workspace";

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string }> }) {
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
  const [events, drafts, points] = await Promise.all([
    db.query<{ id: number; body: string; created_at: string }>("select id, body, created_at from opportunity_events where opportunity_id = $1 order by id desc limit 100", [id]),
    db.query<{ id: string; subject: string | null; body: string | null; delivery_state: string | null; delivery_recipient: string | null; created_at: string }>("select id, subject, body, delivery_state, delivery_recipient, created_at from outreach_drafts where opportunity_id = $1 order by created_at desc limit 50", [id]),
    db.query<{ person_id: string; value: string; verified_at: string | null; source: string }>("select cp.person_id, cp.value, cp.verified_at, cp.source from contact_points cp join people p on p.id = cp.person_id where p.current_company_id = $1 and cp.kind = 'email' order by cp.created_at desc", [buyer.companyId]),
  ]);
  return <OpportunityWorkspace key={id} opportunity={opportunity} buyer={buyer} events={events.rows} drafts={drafts.rows} points={points.rows} demoEmail={demoEmailInfo()} returnTo={returnTo} />;
}
