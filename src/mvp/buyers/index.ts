/**
 * Buyers domain (docs/mvp/14): server functions behind SuperSearch, the buyer sidebar and lead lists.
 * Server-only (reads the database). Types live in ./types (safe to import from client components).
 */
import { getDb } from "@/mvp/db";
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

interface SearchLink { runId: string; label: string; product: string; opportunityId: string; email: string | null }
const EMAIL_LABELS: Record<string, string> = {
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
  const rows = (await getDb().query<{ company_id: string; opportunity_id: string; run_id: string; product_name: string; query: string | null; created_at: string; state: string | null }>(
    `select o.company_id, o.id as opportunity_id, o.run_id, o.product_name, r.adhoc_query->>'query' as query, r.created_at::text as created_at,
       (select t.state from funnel_threads t where t.opportunity_id=o.id and t.mode<>'email_test' order by t.created_at desc limit 1) as state
     from search_opportunities o join runs r on r.id=o.run_id where o.qualification<>'rejected' order by r.created_at desc`)).rows;
  const links = new Map<string, SearchLink[]>();
  for (const r of rows) {
    const list = links.get(r.company_id) ?? [];
    list.push({ runId: r.run_id, label: `${r.query || r.product_name} · ${shortDate(r.created_at)}`, product: r.product_name, opportunityId: r.opportunity_id, email: r.state ? EMAIL_LABELS[r.state] ?? r.state : null });
    links.set(r.company_id, list);
  }
  return links;
}
/** Records limited to one search (run), or all of them. */
async function scopedRecords(run: string | undefined) {
  const records = await hybridSearchRecords(await allSearchRecords(), getDb());
  const links = await searchLinks();
  return { links, records: run ? records.filter((r) => links.get(r.view.companyId)?.some((l) => l.runId === run)) : records };
}

/** SuperSearch buyers: `{ rows, total, facets, contactsFound, contactsTotal, page, pageSize }`. */
export async function searchBuyers(search: BuyerSearch = {}): Promise<BuyerSearchResult> {
  const { records, links } = await scopedRecords(search.run);
  const result = searchRecords(records, search, new Date());
  const companyOf = new Map(records.map((r) => [r.view.leadId, r.view.companyId]));
  result.rows = result.rows.map((row) => {
    const list = links.get(companyOf.get(row.leadId) ?? "") ?? [];
    const current = list.find((l) => l.runId === search.run) ?? list[0];
    return { ...row, searches: list.map((l) => ({ runId: l.runId, label: l.label })), searchedProduct: current?.product ?? null,
      emailStatus: current ? current.email ?? "Not started" : null, opportunityId: current?.opportunityId ?? null };
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
