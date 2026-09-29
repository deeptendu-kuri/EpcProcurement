/**
 * One row and one page per buyer company (docs/mvp/15 §A3): leads of the same company — after name
 * merging (known-companies aliases, "Welspun Corp Unit" = "Welspun Corp") — share a group key. Pure.
 */
import { companyVariantKey, normalizeCompanyName } from "@/mvp/pipeline/text";
import { findKnownCompany } from "./roles";

export function companyGroupKey(companyId: string, name: string): string {
  const known = findKnownCompany(name);
  if (known) return `known:${normalizeCompanyName(known.names[0])}`;
  const key = companyVariantKey(name) ?? normalizeCompanyName(name);
  return key.length >= 3 ? `name:${key}` : `id:${companyId}`;
}
