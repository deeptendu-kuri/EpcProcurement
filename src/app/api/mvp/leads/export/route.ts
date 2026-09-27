import { leadEvidenceUrls, listLeads } from "@/mvp/repo";
import type { LeadListItem } from "@/mvp/types";
import { serverError } from "../../_shared/http";
import { parseLeadQuery } from "../filter";
import { leadsToCsv } from "./csv";

const BATCH = 500;
const EXPORT_MAX = 10_000;

/**
 * GET /api/mvp/leads/export?<same filters as the Leads page> — CSV of the whole filtered set (all pages,
 * up to 10,000 leads) with the evidence URLs behind each one.
 */
export async function GET(request: Request) {
  const { filter, state } = parseLeadQuery(request.url);
  try {
    const items: LeadListItem[] = [];
    for (let offset = 0; offset < EXPORT_MAX; offset += BATCH) {
      const page = await listLeads({ ...filter, limit: BATCH, offset });
      items.push(...page.items);
      if (page.items.length < BATCH || items.length >= page.total) break;
    }
    const urls: Record<string, string[]> = {};
    for (let index = 0; index < items.length; index += BATCH) {
      Object.assign(urls, await leadEvidenceUrls(items.slice(index, index + BATCH).map((item) => item.id)));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(leadsToCsv(items, urls), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="leads-${state.tab}-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return serverError("export leads", error);
  }
}
