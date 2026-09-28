/** Server-side data for the SuperSearch pages: catalogue options and markets (never import from a client component). */
import { getCatalogue } from "@/mvp/config/buyers-config";
import { marketName } from "@/mvp/config/markets";
import { getClientProfile } from "@/mvp/config/profile";
import type { MarketOption } from "./filter-panel";
import type { CatalogueOption } from "./search-state";

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function catalogueOptions(): CatalogueOption[] {
  try {
    return getCatalogue().items.map((item) => ({ id: item.id, name: capitalise(item.shortName || item.name), category: item.category }));
  } catch (error) {
    console.error("[search] catalogue unavailable", error);
    return [];
  }
}

export function marketOptions(): MarketOption[] {
  try {
    return getClientProfile().markets.map((code) => ({ code, name: marketName(code) }));
  } catch {
    return [];
  }
}
