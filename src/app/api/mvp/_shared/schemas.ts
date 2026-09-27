import { z } from "zod";
import { MARKET_CODES } from "@/mvp/types";

/** Body of "Search now" and the search part of a saved search. */
export const runInputSchema = z.object({
  query: z.string().trim().min(2, "Type what you offer.").max(200),
  markets: z
    .array(z.string().trim().toUpperCase().pipe(z.enum(MARKET_CODES)))
    .min(1, "Pick at least one market.")
    .max(MARKET_CODES.length)
    .transform((markets) => [...new Set(markets)]),
  leadKinds: z
    .array(z.enum(["bid", "supply_subcontract"]))
    .min(1, "Pick a lead type.")
    .transform((kinds) => [...new Set(kinds)]),
});

/** 6 / 12 / 24 hours, or null = manual only. */
export const refreshSchema = z.union([z.literal(6), z.literal(12), z.literal(24), z.null()]);
