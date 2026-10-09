/**
 * Buyers domain (docs/mvp/14): server functions behind SuperSearch, the buyer sidebar and lead lists.
 * Server-only (reads the database). Types live in ./types (safe to import from client components).
 */
import { getDb } from "@/mvp/db";
import { getCatalogueItem } from "@/mvp/config/buyers-config";
import { clearBuyerCache, CONFIRM_PREFIX, isUuid, loadBuyerRecords } from "./load";
import { allSearchRecords, getBuyerPage } from "./chain-db";
import { getLeadList } from "./lists";
import { searchContactRecords, searchRecords } from "./search";
import {hybridSearchRecords} from './hybrid';
import { isDerivedLeadId, type BuyerRow, type BuyerSearch, type BuyerSearchResult, type BuyerView, type ContactSearchResult, type LeadList } from "./types";

export * from "./types";
export { addToLeadList, createLeadList, deleteLeadList, getLeadList, listLeadLists, removeFromLeadList, renameLeadList } from "./lists";
export { buyerSearchSchema, parseBuyerSearch, searchFromUrl } from "./schema";
export {
  addContact,
  allSearchRecords,
  ChainError,
  confirmPerson,
  deleteManualContact,
  deriveBuyer,
  getChainContacts,
  getSupplyChain,
  removeNodeCompany,
  setNodeCompany,
} from "./chain-db";

/**
 * The buyer view of one lead (14 §9, 15 §A–B): with all deals of the company and the supply-chain
 * summary. Accepts `derived:<key>` ids of derived buyers too. Null when not found.
 */
export async function getBuyerView(leadId: string): Promise<BuyerView | null> {
  if (!isUuid(leadId) && !isDerivedLeadId(leadId)) return null;
  return getBuyerPage(leadId);
}

interface SearchLink { runId: string; label: string; product: string; productId: string; opportunityId: string; email: string | null; fit: number; fitKind: 'explicit' | 'potential'; verification: 'website' | 'listing' | 'rating' }
export const EMAIL_LABELS: Record<string, string> = {
  qualifying: "Checking fit", review: "Held for review", needs_contact: "Needs a contact", active: "Intro sent",
  engaged: "Replied", awaiting_time: "Replied", awaiting_calendar: "Replied", meeting_pending: "Replied",
  meeting_booked: "Meeting booked", stopped: "Stopped",
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/**
 * Doc 17: which of the user's searches saved each company, what was searched (what we can sell them),
 * and the email automation status — so Leads can be filtered by search and show both on every row.
 */
async function searchLinks(): Promise<Map<string, SearchLink[]>> {
  // The fit is the higher of the saved-lead score and the search's shortlist rating of the same company.
  const rows = (await getDb().query<{ company_id: string; opportunity_id: string; run_id: string; product_name: string; product_id: string; fit_score: number; material_fit_kind: 'explicit' | 'potential'; verification: 'website' | 'listing' | 'rating'; query: string | null; created_at: string; state: string | null }>(
    `select o.company_id, o.id as opportunity_id, o.run_id, o.product_name, o.product_id,
       greatest(o.fit_score, coalesce((select max(rc.rating) from research_candidates rc join companies cc on cc.id=o.company_id
         where rc.run_id=o.run_id and rc.rating_source is not null and regexp_replace(lower(rc.company),'[^a-z0-9]','','g')=regexp_replace(lower(cc.canonical_name),'[^a-z0-9]','','g')), 0)) as fit_score,
       o.material_fit_kind, o.verification, r.adhoc_query->>'query' as query, r.created_at::text as created_at,
       (select t.state from funnel_threads t where t.opportunity_id=o.id and t.mode<>'email_test' order by t.created_at desc limit 1) as state
     from search_opportunities o join runs r on r.id=o.run_id where o.qualification<>'rejected' order by r.created_at desc`)).rows;
  const links = new Map<string, SearchLink[]>();
  for (const r of rows) {
    const list = links.get(r.company_id) ?? [];
    list.push({ runId: r.run_id, label: `${r.query || r.product_name} · ${shortDate(r.created_at)}`, product: r.product_name, productId: r.product_id, opportunityId: r.opportunity_id,
      email: r.state ? EMAIL_LABELS[r.state] ?? r.state : null, fit: Number(r.fit_score) || 0, fitKind: r.material_fit_kind, verification: r.verification });
    links.set(r.company_id, list);
  }
  return links;
}
/** The link for the selected search, else the latest search that saved the company. */
const linkFor = (list: SearchLink[] | undefined, run: string | undefined) => list?.find((l) => l.runId === run) ?? list?.[0];
/**
 * Records limited to one search (run), or all of them. A company found by a search is rated by that
 * search's buyer fit (search_opportunities.fit_score) when news-signal scoring gave it none, so the
 * rating, the Fit filter and the Fit sort all agree with what the search found.
 */
async function scopedRecords(run: string | undefined) {
  const all = await hybridSearchRecords(await allSearchRecords(), getDb());
  const links = await searchLinks();
  const records = all.filter((r) => !run || links.get(r.view.companyId)?.some((l) => l.runId === run)).map((r) => {
    const list = links.get(r.view.companyId) ?? [];
    const fit = linkFor(list, run)?.fit ?? 0;
    // The product a search found them for is always something we can sell them (and filterable as such).
    const missing = [...new Set(list.map((l) => l.productId))].filter((id) => !r.view.sellItems.some((i) => i.itemId === id))
      .flatMap((id) => { const item = getCatalogueItem(id); return item ? [{ itemId: id, name: item.shortName || item.name, category: item.category, fit: "good" as const, why: "Found by your search for it", evidenceIds: [] }] : []; });
    if (fit <= r.view.fitScore && !missing.length) return r;
    const fitScore = Math.max(fit, r.view.fitScore);
    return { ...r, view: { ...r.view, fitScore, sellItems: [...missing, ...r.view.sellItems] }, row: { ...r.row, fitScore } };
  });
  return { links, records };
}

/** SuperSearch buyers: `{ rows, total, facets, contactsFound, contactsTotal, page, pageSize }`. */
export async function searchBuyers(search: BuyerSearch = {}): Promise<BuyerSearchResult> {
  const { records, links } = await scopedRecords(search.run);
  const result = searchRecords(records, search, new Date());
  const byLead = new Map(records.map((r) => [r.view.leadId, r]));
  result.rows = result.rows.map((row) => {
    const record = byLead.get(row.leadId);
    const list = links.get(record?.view.companyId ?? "") ?? [];
    const current = linkFor(list, search.run);
    const alsoSell = (record?.view.sellItems ?? []).filter((i) => i.fit === "good" && i.itemId !== current?.productId)
      .map((i) => getCatalogueItem(i.itemId)?.shortName ?? i.name).slice(0, 4);
    return { ...row, searches: list.map((l) => ({ runId: l.runId, label: l.label })), searchedProduct: current?.product ?? null,
      emailStatus: current ? current.email ?? "Not started" : null, opportunityId: current?.opportunityId ?? null,
      alsoSell, searchFit: current?.fitKind ?? null, verification: current?.verification ?? null };
  });
  return result;
}

/** SuperSearch contacts: one row per buying-team slot (a named person or an empty slot with Find links). */
export async function searchContacts(search: BuyerSearch = {}): Promise<ContactSearchResult> {
  const { records } = await scopedRecords(search.run);
  return searchContactRecords(records, search, new Date());
}

/**
 * Mark a named person as the confirmed holder of a buying-team slot (14 §8 "Confirmed": after a reply,
 * call or Sales Navigator check). Stored as a 'note' activity on the lead. Returns false when the lead
 * or person doesn't exist.
 */
export async function confirmContact(leadId: string, personId: string, slotId: string | null = null, userId: string | null = null): Promise<boolean> {
  if (!isUuid(leadId) || !isUuid(personId)) return false;
  const db = getDb();
  const { rows } = await db.query<{ ok: number }>(
    "select 1 as ok from leads l, people p where l.id = $1 and p.id = $2",
    [leadId, personId],
  );
  if (!rows.length) return false;
  await db.query("insert into activities (lead_id, person_id, type, body, user_id) values ($1, $2, 'note', $3, $4)", [
    leadId,
    personId,
    `${CONFIRM_PREFIX}${personId.toLowerCase()}${slotId ? `:${slotId}` : ""}`,
    userId,
  ]);
  clearBuyerCache();
  return true;
}

/** A lead list with its buyers as table rows (in the order they were added, newest first), or null. */
export async function getLeadListWithRows(listId: string): Promise<(LeadList & { leadIds: string[]; rows: BuyerRow[] }) | null> {
  const list = await getLeadList(listId);
  if (!list) return null;
  const records = await loadBuyerRecords({ leadIds: list.leadIds });
  const byId = new Map(records.map((r) => [r.view.leadId, r.row]));
  return { ...list, rows: list.leadIds.map((id) => byId.get(id)).filter((row): row is BuyerRow => Boolean(row)) };
}
