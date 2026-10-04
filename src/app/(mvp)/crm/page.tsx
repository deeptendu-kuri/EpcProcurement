import Link from "next/link";
import { PageHeader } from "@/components/mvp/page-header";
import { listOpportunities, recentSearches, isVerified, opportunityJourney } from "@/mvp/opportunities";
import { COUNTRIES } from "@/mvp/config/countries";
import { CONTACT_ROLES } from "@/mvp/opportunities/workflow";
import { marketName } from "@/mvp/config/markets";
import { formatDate } from "@/components/mvp/labels";
import { isUuid } from "@/mvp/repo";
import { catalogueOptions } from "@/components/mvp/search/page-data";

export default async function CrmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const value = (key: string) => typeof p[key] === "string" ? p[key] as string : "";
  const searches = await recentSearches();
  const search = value("search") || searches.find(r => r.adhoc_query?.productId)?.id || "none";
  const view = value("view") === "verified" ? "verified" : "discovered";
  const rows = search === "all" || isUuid(search) ? await listOpportunities(search === "all" ? undefined : search) : [];
  const base = rows.filter(o => (!value("country") || o.country === value("country")) && (!value("role") || o.contact_role === value("role"))
    && (!value("product") || o.product_id === value("product")) && (!value("keyword") || o.keyword.toLowerCase().includes(value("keyword").toLowerCase()))
    && (!value("qualification") || o.qualification === value("qualification"))
    && (!value("outreach") || (value("outreach") === "sent" ? o.sent : !o.sent)));
  const filtered = base.filter(o => view === "verified" ? isVerified(o) : !isVerified(o));
  const q = new URLSearchParams();
  for (const key of ["search", "country", "role", "product", "keyword", "qualification", "outreach"]) if (value(key)) q.set(key, value(key));
  q.set("search", search);
  const tabLink = (v: string) => { const tab = new URLSearchParams(q); tab.set("view", v); return `/crm?${tab}`; };
  q.set("view", view);
  const returnTo = `/crm?${q}`;
  return <div className="flex flex-col gap-5">
    <PageHeader title="Buyer CRM" subtitle="Search-scoped opportunities. The same company can have separate product opportunities." actions={<Link href="/find" className="btn btn-primary">Find buyers</Link>} />
    <nav aria-label="CRM views" className="flex flex-wrap gap-2"><Link href={tabLink("discovered")} aria-current={view === "discovered" ? "page" : undefined} className={`btn ${view === "discovered" ? "btn-primary" : "btn-secondary"}`}>Discovered CRM ({base.filter(o => !isVerified(o)).length})</Link><Link href={tabLink("verified")} aria-current={view === "verified" ? "page" : undefined} className={`btn ${view === "verified" ? "btn-primary" : "btn-secondary"}`}>Verified CRM ({base.filter(isVerified).length})</Link></nav>
    <form action="/crm" className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="CRM filters">
      <input type="hidden" name="view" value={view} />
      <label className="text-sm font-semibold">Search<select name="search" defaultValue={search} className="control mt-1 w-full p-2"><option value="all">All searches (explicit)</option>{!searches.some(r => r.id === search) && search !== "all" ? <option value={search}>No search selected</option> : null}{searches.filter(r => r.adhoc_query?.productId).map(r => <option key={r.id} value={r.id}>{r.adhoc_query?.query} · {formatDate(r.created_at)}</option>)}</select></label>
      <label className="text-sm font-semibold">Country<select name="country" defaultValue={value("country")} className="control mt-1 w-full p-2"><option value="">All countries</option>{COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      <label className="text-sm font-semibold">Contact role<select name="role" defaultValue={value("role")} className="control mt-1 w-full p-2"><option value="">All requested roles</option>{CONTACT_ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label className="text-sm font-semibold">Product<select name="product" defaultValue={value("product")} className="control mt-1 w-full p-2"><option value="">All searched products</option>{catalogueOptions().map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label className="text-sm font-semibold">Keyword<input name="keyword" defaultValue={value("keyword")} maxLength={200} className="input mt-1 w-full p-2" placeholder="Filter by search keyword" /></label>
      <label className="text-sm font-semibold">Buyer fit<select name="qualification" defaultValue={value("qualification")} className="control mt-1 w-full p-2"><option value="">Any review status</option><option value="pending">Needs review</option><option value="approved">Fit reviewed</option><option value="rejected">Not relevant</option></select></label>
      <label className="text-sm font-semibold">Demo outreach<select name="outreach" defaultValue={value("outreach")} className="control mt-1 w-full p-2"><option value="">Any status</option><option value="sent">Demo sent</option><option value="not_sent">Not sent</option></select></label>
      <div className="flex items-end gap-2"><button type="submit" className="btn btn-primary">Apply filters</button><Link href={`/crm?search=${encodeURIComponent(search)}&view=${view}`} className="btn btn-secondary">Clear</Link></div>
    </form>
    <p className="text-sm text-[#6b7280]">{view === "verified" ? "Reviewed product fit, a reviewed current company/role and a recent provider-validated email. Expired checks remove the prospect from this view. No samples or dummy emails." : "Saved prospects awaiting fit review or validated contact details. Possible buyers are not confirmed purchases."} Open a prospect to find and validate contacts with Hunter. Manual role confirmation is not email validation.</p>
    <section className="card overflow-hidden" aria-label="CRM results"><div className="card-header"><h2 className="card-title">{filtered.length} {view === "verified" ? "verified" : "discovered"} prospects</h2><span className="text-xs text-[#6b7280]">{search === "all" ? "All searches" : "Selected search only"}</span></div>
      {!filtered.length ? <div className="p-6"><h3 className="font-semibold">{view === "verified" ? "No validated prospects yet" : "No matching prospects"}</h3><p className="mt-1 text-sm text-[#6b7280]">{view === "verified" ? "Review buyer fit and connect contact validation first. Demo emails do not validate a buyer." : "Try clearing filters or running a new product search. A search can legitimately return zero relevant buyers."}</p><Link href="/find" className="btn btn-secondary mt-3">Find buyers</Link></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-[var(--subtle)] text-xs text-[#6b7280]"><tr>{["Company", "Keyword", "What we can sell them", "Country / Role", "Qualification / Contact", "Next action", "Summary"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{filtered.map(o => <tr key={o.id} className="border-t border-[var(--line)] align-top"><td className="p-3"><Link className="font-semibold text-[var(--accent-2)] hover:underline" href={`/opportunities/${o.id}?returnTo=${encodeURIComponent(returnTo)}`}>{o.name}</Link>{o.is_sample ? <p className="mt-1 text-xs text-[#b54708]">Sample data</p> : null}<p className="mt-1 text-xs text-[#6b7280]">{formatDate(o.created_at)}</p></td><td className="p-3">{o.keyword}</td><td className="p-3">{o.product_name}</td><td className="p-3">{marketName(o.country)}<p className="mt-1 text-xs text-[#6b7280]">{CONTACT_ROLES.find(r => r.id === o.contact_role)?.name}</p></td><td className="p-3">{o.qualification === "approved" ? "Fit reviewed" : o.qualification === "rejected" ? "Not relevant" : "Needs fit review"}<p className="mt-1 text-xs">{o.validated_emails && !o.is_sample ? `${o.validated_emails} validated emails` : "Email not validated"}</p>{o.sent ? <p className="text-xs text-[#067647]">Demo sent — not buyer outreach</p> : null}</td><td className="p-3"><Link className="btn btn-secondary btn-sm" href={`/opportunities/${o.id}?returnTo=${encodeURIComponent(returnTo)}`}>{opportunityJourney(o).action}</Link>{o.next_action ? <p className="mt-1 text-xs">{o.next_action}</p> : null}{o.owner_name ? <p className="text-xs text-[#6b7280]">Owner: {o.owner_name}</p> : null}{o.follow_up_at ? <p className="text-xs">Follow-up: {formatDate(o.follow_up_at)} (manual)</p> : null}</td><td className="max-w-60 whitespace-pre-wrap p-3 text-xs">{o.summary || "No conversation summary yet"}</td></tr>)}</tbody></table></div>}
    </section>
    {rows.length >= 2000 ? <p role="status" className="text-sm text-[#b54708]">Showing the newest 2,000 opportunities. Narrow by search to see a smaller set.</p> : null}
    <Link href="/search" className="self-start text-sm text-[#6b7280] underline">Advanced / legacy company search (unscoped historic data)</Link>
  </div>;
}
