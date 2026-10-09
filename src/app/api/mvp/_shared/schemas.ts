import { z } from "zod";
import { COUNTRY_CODES } from "@/mvp/config/countries";
import { getCatalogue } from "@/mvp/config/buyers-config";

/** Body of "Search now" and the search part of a saved search. */
export const runInputSchema = z.object({
  query: z.string().trim().min(2, "Type what you offer.").max(200),
  productId: z.string().refine(id => getCatalogue().items.some(item => item.id === id), "Select a product from your catalogue.").optional(),
  contactRole: z.enum(["buyer", "decision_maker", "technical_approver", "influencer", "approver", "vendor_registration"]).optional(),
  researchMode: z.enum(["preview", "batch", "deep"]).optional(),
  targetCompanies: z.number().int().min(1).max(100).optional(),
  includeResellers: z.boolean().optional(),
  lanes: z.array(z.enum(['trigger','roundup','capability'])).min(1).max(3).transform(lanes=>[...new Set(lanes)]).optional(),
  markets: z
    .array(z.string().trim().toUpperCase().refine(code => COUNTRY_CODES.includes(code), "Choose a valid country."))
    .min(1, "Pick at least one market.")
    .max(20, "Search up to 20 countries at once to keep free-tier searches manageable.")
    .transform((markets) => [...new Set(markets)]),
  leadKinds: z
    .array(z.enum(["bid", "supply_subcontract"]))
    .min(1, "Pick a lead type.")
    .transform((kinds) => [...new Set(kinds)]),
});

/** 6 / 12 / 24 hours, or null = manual only. */
export const refreshSchema = z.union([z.literal(6), z.literal(12), z.literal(24), z.null()]);
