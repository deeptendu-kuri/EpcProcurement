import { leadEvidenceUrls, listLeads } from "@/mvp/repo";
import { jsonError, serverError } from "../../_shared/http";
import { parseLeadQuery } from "../filter";
import { leadsToCsv } from "./csv";

const EXPORT_LIMIT = 500;

/**
 * GET /api/mvp/leads/export?class=&market=&product=&kind=&status=&run= — CSV of the matching leads
 * (up to 500, same filters as the inbox) with the evidence URLs behind each one.
 */
export async function GET(request: Request) {
  const parsed = parseLeadQuery(request.url);
  if ("error" in parsed) return jsonError(400, parsed.error);
  try {
    const { items } = await listLeads({ ...parsed.filter, limit: EXPORT_LIMIT, offset: 0 });
    const urls = await leadEvidenceUrls(items.map((item) => item.id));
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(leadsToCsv(items, urls), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="leads-${parsed.filter.class ?? "all"}-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return serverError("export leads", error);
  }
}
