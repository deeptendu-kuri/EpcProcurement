import { getVerifiedOpportunities, getVerifiedOpportunity } from "@/modules/dashboard/verified-data";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { BuyerOpportunity } from "@/types/domain";

export interface BuyerFilters {
  query?: string;
  country?: string;
  confidence?: string;
  minScore?: number;
}

export async function listBuyerOpportunities(filters: BuyerFilters = {}): Promise<BuyerOpportunity[]> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return filterOpportunities(getVerifiedOpportunities(), filters);
  }

  // Database-backed read model can be filled after the hosted schema is ready.
  return filterOpportunities(getVerifiedOpportunities(), filters);
}

export async function getBuyerOpportunity(companyId: string): Promise<BuyerOpportunity | undefined> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return getVerifiedOpportunity(companyId);
  }

  return getVerifiedOpportunity(companyId);
}

function filterOpportunities(opportunities: BuyerOpportunity[], filters: BuyerFilters) {
  return opportunities
    .filter((opportunity) => {
      const query = filters.query?.toLowerCase().trim();
      if (!query) {
        return true;
      }
      return [opportunity.company.canonicalName, opportunity.potentialProduct, opportunity.latestSignal.summary]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .filter((opportunity) => (filters.country ? opportunity.company.country === filters.country : true))
    .filter((opportunity) => (filters.confidence ? opportunity.score.confidence === filters.confidence : true))
    .filter((opportunity) => (filters.minScore ? opportunity.score.score >= filters.minScore : true))
    .sort((a, b) => b.score.score - a.score.score);
}
