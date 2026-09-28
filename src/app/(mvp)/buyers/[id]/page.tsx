import { notFound } from "next/navigation";
import { companyOutreachRules } from "@/mvp/compliance";
import { getProductById } from "@/mvp/config/profile";
import { getLeadDetail } from "@/mvp/repo";
import { LeadView } from "@/components/mvp/lead-view";
import { FiveQuestions } from "@/components/mvp/search/five-questions";

/** Full buyer page (docs/mvp/14 §10): the five questions on top, then the detail with proof (09 §4.3). */
export default async function BuyerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getLeadDetail(id);
  if (!detail) notFound();

  const productNames = (detail.lead.client_product_ids ?? []).map((productId) => getProductById(productId)?.name ?? productId);
  let companyOutreach = null;
  try {
    companyOutreach = companyOutreachRules(detail.buyer.country ?? "");
  } catch (error) {
    console.error("[buyer page] outreach rules failed:", error);
  }

  return <LeadView detail={detail} productNames={productNames} companyOutreach={companyOutreach} top={<FiveQuestions leadId={detail.lead.id} />} />;
}
