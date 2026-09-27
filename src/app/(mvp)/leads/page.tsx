import { getActiveProducts, getClientProfile } from "@/mvp/config/profile";
import { marketName } from "@/mvp/config/markets";
import { listLeads } from "@/mvp/repo";
import { LEAD_STATUSES, type LeadClass, type LeadFilter, type LeadKind, type LeadStatus } from "@/mvp/types";
import { LeadsInbox } from "@/components/mvp/leads-inbox";
import { CLASS_ORDER } from "@/components/mvp/labels";

const PAGE_SIZE = 50;

interface LeadsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function param(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

/** Leads inbox (docs/mvp/09 §4.2, 12 §1 F2). Filters live in the URL so the page can be shared and refreshed. */
export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const profile = getClientProfile();
  const products = getActiveProducts();

  const market = param(params, "market").toUpperCase();
  const product = param(params, "product");
  const kindParam = param(params, "kind");
  const kind: LeadKind | undefined = kindParam === "bid" || kindParam === "supply_subcontract" ? kindParam : undefined;
  const statusParam = param(params, "status");
  const status: LeadFilter["status"] =
    statusParam === "all" ? "all" : (LEAD_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as LeadStatus) : "open";
  const run = param(params, "run");
  const page = Math.max(1, Number.parseInt(param(params, "page"), 10) || 1);
  const tabParam = (param(params, "tab") || param(params, "class")) as LeadClass;

  const base: LeadFilter = {
    market: market || undefined,
    productId: product || undefined,
    kind,
    status,
    runId: run || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  let activeClass: LeadClass = CLASS_ORDER.includes(tabParam) ? tabParam : "genuine";
  let result = await listLeads({ ...base, class: activeClass });
  // Coming from a search ("See new leads"): open the first tab that has something in it.
  if (!CLASS_ORDER.includes(tabParam) && !result.items.length) {
    const firstWithLeads = CLASS_ORDER.find((cls) => result.counts[cls] > 0);
    if (firstWithLeads && firstWithLeads !== activeClass) {
      activeClass = firstWithLeads;
      result = await listLeads({ ...base, class: activeClass });
    }
  }

  return (
    <LeadsInbox
      result={result}
      activeClass={activeClass}
      filters={{ market, product, kind: kind ?? "", status: status === "open" ? "" : status, run }}
      markets={profile.markets.map((code) => ({ value: code, label: marketName(code) }))}
      products={products.map((item) => ({ value: item.id, label: item.name }))}
      page={page}
      pageSize={PAGE_SIZE}
    />
  );
}
