import { getClientProfile } from "@/mvp/config/profile";
import { leadFacets, listLeads } from "@/mvp/repo";
import { LeadsWorkspace } from "@/components/mvp/leads/leads-workspace";
import { parseLeadsState, toLeadFilter } from "@/components/mvp/leads/url-state";

interface LeadsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Leads (docs/mvp/13 §4). Filters, sort and page live in the URL so links and the back button work. */
export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const state = parseLeadsState(params);
  // Coming from a search ("See new leads") without a tab: show every class.
  if (!params.tab && !params.class && state.run) state.tab = "all";
  const filter = toLeadFilter(state);

  const [result, facets, any] = await Promise.all([
    listLeads(filter),
    leadFacets(filter),
    listLeads({ status: "all", limit: 1 }),
  ]);
  const productNames = Object.fromEntries(getClientProfile().products.map((product) => [product.id, product.name]));

  return <LeadsWorkspace state={state} result={result} facets={facets} productNames={productNames} hasAnyLeads={any.total > 0} />;
}
