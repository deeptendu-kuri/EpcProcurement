/**
 * Buyers domain (docs/mvp/14): server functions behind SuperSearch, the buyer sidebar and lead lists.
 * Server-only (reads the database). Types live in ./types (safe to import from client components).
 */
import { getDb } from "@/mvp/db";
import { allBuyerRecords, clearBuyerCache, CONFIRM_PREFIX, isUuid, loadBuyerRecords } from "./load";
import { getLeadList } from "./lists";
import { searchContactRecords, searchRecords } from "./search";
import type { BuyerRow, BuyerSearch, BuyerSearchResult, BuyerView, ContactSearchResult, LeadList } from "./types";

export * from "./types";
export { addToLeadList, createLeadList, deleteLeadList, getLeadList, listLeadLists, removeFromLeadList, renameLeadList } from "./lists";
export { buyerSearchSchema, parseBuyerSearch, searchFromUrl } from "./schema";

/** The buyer view of one lead (14 §9), or null when the lead doesn't exist. */
export async function getBuyerView(leadId: string): Promise<BuyerView | null> {
  if (!isUuid(leadId)) return null;
  const [record] = await loadBuyerRecords({ leadIds: [leadId] });
  return record?.view ?? null;
}

/** SuperSearch buyers: `{ rows, total, facets, contactsFound, contactsTotal, page, pageSize }`. */
export async function searchBuyers(search: BuyerSearch = {}): Promise<BuyerSearchResult> {
  const records = await allBuyerRecords();
  return searchRecords(records, search, new Date());
}

/** SuperSearch contacts: one row per buying-team slot (a named person or an empty slot with Find links). */
export async function searchContacts(search: BuyerSearch = {}): Promise<ContactSearchResult> {
  const records = await allBuyerRecords();
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
