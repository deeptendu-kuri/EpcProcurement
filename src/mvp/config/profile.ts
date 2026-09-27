import { z } from "zod";
import { DISCIPLINES, MARKET_CODES, type ClientProduct, type ClientProfile } from "@/mvp/types";
import raw from "./client-profile.json";

const discipline = z.enum(DISCIPLINES);

const productSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  discipline,
  hs_codes: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  spec_ranges: z
    .object({
      standard: z.array(z.string()).optional(),
      grade: z.array(z.string()).optional(),
      od_in: z.tuple([z.number(), z.number()]).optional(),
    })
    .catchall(z.unknown())
    .default({}),
  active: z.boolean().default(true),
});

const profileSchema = z.object({
  is_example: z.boolean().default(false),
  company_name: z.string().min(1),
  markets: z.array(z.enum(MARKET_CODES)).min(1),
  disciplines: z.array(discipline).min(1),
  adjacent_disciplines: z.array(discipline).default([]),
  sectors: z.array(z.string()).default([]),
  related_sectors: z.array(z.string()).default([]),
  min_project_value_usd: z.number().nullable().default(null),
  sweet_spot_min_usd: z.number().nullable().default(null),
  sweet_spot_max_usd: z.number().nullable().default(null),
  served_ports: z.array(z.string()).default([]),
  served_regions: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  local_content: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  registrations: z.record(z.string(), z.boolean()).default({}),
  excluded_company_names: z.array(z.string()).default([]),
  existing_customer_names: z.array(z.string()).default([]),
  products: z.array(productSchema).default([]),
  updated_at: z.string().nullable().default(null),
});

let cached: ClientProfile | undefined;

/**
 * The client profile that drives scope fit, eligibility and logistics scoring (04 §4, 07).
 * Loaded from `client-profile.json` and validated once. The shipped file is an EXAMPLE
 * (`is_example: true`) to be replaced with the client's real data.
 */
export function getClientProfile(): ClientProfile {
  if (!cached) cached = profileSchema.parse(raw) as ClientProfile;
  return cached;
}

/** Active products only. */
export function getActiveProducts(): ClientProduct[] {
  return getClientProfile().products.filter((product) => product.active);
}

/** Look up a product by id (as stored in requirements.client_product_id / leads.client_product_ids). */
export function getProductById(id: string): ClientProduct | undefined {
  return getClientProfile().products.find((product) => product.id === id);
}
