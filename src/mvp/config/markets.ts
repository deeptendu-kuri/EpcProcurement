import type { MarketCode } from "@/mvp/types";

/** Display names for the slice markets (04 §3 market_code). */
export const MARKET_NAMES: Record<MarketCode, string> = {
  IN: "India",
  SA: "Saudi Arabia",
  AE: "UAE",
  QA: "Qatar",
  OM: "Oman",
  KW: "Kuwait",
  BH: "Bahrain",
  NO: "Norway",
  MY: "Malaysia",
};

export function marketName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return MARKET_NAMES[code.toUpperCase() as MarketCode] ?? code.toUpperCase();
}
