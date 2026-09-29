import { notFound } from "next/navigation";
import { getBuyerView } from "@/mvp/buyers";
import { companyOutreachRules } from "@/mvp/compliance";
import { getLeadDetail } from "@/mvp/repo";
import { BuyerPageView } from "@/components/mvp/buyers/buyer-page";

/**
 * Buyer-first page (docs/mvp/15 §A, mockup buyer-chain): who they are and the deal in one line, what
 * they'll buy, when and why you, the supply chain from the deal with every contact across it, then
 * the compact sections (Can you sell to them?, How to reach them, Proof, Activity).
 */
export default async function BuyerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, buyer] = await Promise.all([getLeadDetail(id), getBuyerView(id)]);
  if (!detail || !buyer) notFound();

  let companyOutreach = null;
  try {
    companyOutreach = companyOutreachRules(detail.buyer.country ?? "");
  } catch (error) {
    console.error("[buyer page] outreach rules failed:", error);
  }

  return <BuyerPageView buyer={buyer} detail={detail} companyOutreach={companyOutreach} />;
}
