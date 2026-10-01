import { notFound } from "next/navigation";
import { getBuyerView } from "@/mvp/buyers";
import { companyOutreachRules } from "@/mvp/compliance";
import { getLeadDetail } from "@/mvp/repo";
import { BuyerPageView } from "@/components/mvp/buyers/buyer-page";
import { getDb } from "@/mvp/db";
import { demoEmailInfo } from "@/mvp/email/config";

/**
 * Buyer-first page (docs/mvp/15 §A, mockup buyer-chain): who they are and the deal in one line, what
 * they'll buy, when and why you, the supply chain from the deal with every contact across it, then
 * the compact sections (Can you sell to them?, How to reach them, Proof, Activity).
 */
export default async function BuyerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ compose?: string; contact?: string }> }) {
  const { id } = await params;
  const [detail, buyer] = await Promise.all([getLeadDetail(id), getBuyerView(id)]);
  if (!detail || !buyer) notFound();
  const query = await searchParams;
  const points = detail.people.length ? (await getDb().query<{ person_id: string; value: string }>(
    "select person_id, value from contact_points where kind = 'email' and person_id = any($1::uuid[]) order by created_at", [detail.people.map(p => p.id)],
  )).rows : [];

  let companyOutreach = null;
  try {
    companyOutreach = companyOutreachRules(detail.buyer.country ?? "");
  } catch (error) {
    console.error("[buyer page] outreach rules failed:", error);
  }

  return <BuyerPageView buyer={buyer} detail={detail} companyOutreach={companyOutreach} demoEmail={demoEmailInfo()} contactEmails={Object.fromEntries(points.map(p => [p.person_id, p.value]))} composeOnLoad={query.compose === "1"} initialContactKey={query.contact} />;
}
