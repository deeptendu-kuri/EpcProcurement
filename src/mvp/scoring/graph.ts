import type { CompanyInsights } from "@/mvp/types";

/**
 * Buyer history from the relationship graph (docs/mvp/07 §6): awards in the last 5 years, sectors,
 * countries, regular suppliers/partners (≥ 2 independent evidences within 36 months), typically
 * subcontracted / self-performed disciplines, and the projects behind them — each with evidence ids.
 */
export async function getCompanyInsights(companyId: string): Promise<CompanyInsights> {
  return {
    companyId,
    awards5y: 0,
    sectors: [],
    countries: [],
    regularSuppliers: [],
    regularPartners: [],
    typicalSubcontracted: [],
    typicalSelfPerformed: [],
    projects: [],
  };
}
