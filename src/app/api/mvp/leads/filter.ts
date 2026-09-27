import { z } from "zod";
import { LEAD_STATUSES, type LeadFilter } from "@/mvp/types";
import { uuidSchema } from "../_shared/http";

/** Query-string filters shared by GET /api/mvp/leads and /api/mvp/leads/export. `tab` is accepted as an alias of `class`. */
export const leadQuerySchema = z.object({
  class: z.enum(["genuine", "research", "watch", "rejected"]).optional(),
  market: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a 2-letter market code.").optional(),
  product: z.string().trim().min(1).max(100).optional(),
  kind: z.enum(["bid", "supply_subcontract"]).optional(),
  status: z.enum(["open", "all", ...LEAD_STATUSES]).optional(),
  run: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function parseLeadQuery(url: string): { filter: LeadFilter } | { error: string } {
  const raw: Record<string, string> = Object.fromEntries(
    [...new URL(url).searchParams.entries()].filter(([, value]) => value !== ""),
  );
  if (raw.tab && !raw.class) raw.class = raw.tab;
  delete raw.tab;
  delete raw.page;
  const parsed = leadQuerySchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: `${first.path.join(".") || "query"}: ${first.message}` };
  }
  const q = parsed.data;
  return {
    filter: {
      class: q.class,
      market: q.market,
      productId: q.product,
      kind: q.kind,
      status: q.status ?? "open",
      runId: q.run,
      limit: q.limit,
      offset: q.offset,
    },
  };
}
