import { notFound } from "next/navigation";
import { companyOutreachRules } from "@/mvp/compliance";
import { getProductById } from "@/mvp/config/profile";
import { getLeadDetail } from "@/mvp/repo";
import { LeadView } from "@/components/mvp/lead-view";

/** Lead page with proof (docs/mvp/09 §4.3, 12 §1 F3/F4). */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getLeadDetail(id);
  if (!detail) notFound();

  const productNames = (detail.lead.client_product_ids ?? []).map((productId) => getProductById(productId)?.name ?? productId);
  let companyOutreach = null;
  try {
    companyOutreach = companyOutreachRules(detail.buyer.country ?? "");
  } catch (error) {
    console.error("[lead page] outreach rules failed:", error);
  }

  return <LeadView detail={detail} productNames={productNames} companyOutreach={companyOutreach} />;
}
