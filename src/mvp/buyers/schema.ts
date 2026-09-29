/**
 * zod schema for BuyerSearch (docs/mvp/14 §9) — shared by the API routes and (optionally) the UI's URL
 * state. `parseBuyerSearch` never throws: invalid parts are reported as the zod error.
 */
import { z } from "zod";
import type { BuyerSearch } from "./types";

const roles = z.enum(["owner", "epc_contractor", "subcontractor", "manufacturer", "fabricator", "distributor"]);
const slotRoles = z.enum(["decision_maker", "buyer", "technical_approver", "influencer", "approver", "vendor_registration"]);
const text = z.string().trim().min(1).max(120);
const list = <T extends z.ZodType>(item: T) => z.array(item).max(100);

export const buyerSearchSchema = z
  .object({
    location: z.object({ any: list(text).optional(), not: list(text).optional(), basis: z.enum(["hq", "site"]).optional() }).strict().optional(),
    roles: z.object({ any: list(roles).optional(), not: list(roles).optional() }).strict().optional(),
    sell: z.object({ any: list(text).optional(), hideCompetitors: z.boolean().optional() }).strict().optional(),
    signals: z
      .object({ any: list(z.enum(["order_won", "contract_won", "tender_open", "expansion"])).optional(), withinDays: z.number().int().min(1).max(3650).optional() })
      .strict()
      .optional(),
    contacts: z.object({ departments: list(text).optional(), slotRoles: list(slotRoles).optional(), onlyWithFound: z.boolean().optional() }).strict().optional(),
    industry: list(text).optional(),
    valueUsd: z.object({ min: z.number().min(0).optional(), max: z.number().min(0).optional() }).strict().optional(),
    lookalikeOf: z.string().trim().max(200).optional(),
    companyList: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
    reach: list(z.enum(["allowed", "opt_out_only", "consent_needed"])).optional(),
    stage: list(z.enum(["ready", "check", "early", "not_buyer"])).optional(),
    minFit: z.number().min(0).max(100).optional(),
    howSure: list(z.enum(["high", "medium", "low"])).optional(),
    q: z.string().trim().max(200).optional(),
    sort: z.enum(["latest", "fit", "window"]).optional(),
    page: z.number().int().min(1).max(10_000).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
    tiers: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).max(3).optional(),
    linkStatus: list(z.enum(["confirmed", "likely", "possible"])).optional(),
  })
  .strict();

/** Parse a BuyerSearch from unknown input (JSON body, or the `s` URL parameter as JSON). */
export function parseBuyerSearch(raw: unknown): { ok: true; search: BuyerSearch } | { ok: false; error: string; issues: z.core.$ZodIssue[] } {
  const parsed = buyerSearchSchema.safeParse(raw ?? {});
  if (parsed.success) return { ok: true, search: parsed.data as BuyerSearch };
  const first = parsed.error.issues[0];
  const where = first?.path.length ? `${first.path.join(".")}: ` : "";
  return { ok: false, error: `${where}${first?.message ?? "Invalid search."}`, issues: parsed.error.issues };
}

/** Read a BuyerSearch from a URL: `?s=<json>` (plus `page`, `size`, `sort`, `q` shortcuts). */
export function searchFromUrl(url: string): ReturnType<typeof parseBuyerSearch> {
  const params = new URL(url).searchParams;
  let raw: Record<string, unknown> = {};
  const s = params.get("s");
  if (s) {
    try {
      const decoded = JSON.parse(s);
      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) raw = decoded as Record<string, unknown>;
      else return { ok: false, error: "s: must be a JSON object.", issues: [] };
    } catch {
      return { ok: false, error: "s: must be JSON.", issues: [] };
    }
  }
  const page = Number(params.get("page"));
  const size = Number(params.get("size"));
  if (Number.isInteger(page) && page > 0) raw.page = page;
  if (Number.isInteger(size) && size > 0) raw.pageSize = size;
  const sort = params.get("sort");
  if (sort) raw.sort = sort;
  const q = params.get("q");
  if (q) raw.q = q;
  return parseBuyerSearch(raw);
}
