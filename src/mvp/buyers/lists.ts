/**
 * Lead lists (docs/mvp/14 §10): named lists of buyers saved from SuperSearch
 * (tables `lead_lists`, `lead_list_items`, migration 005). Parameterised SQL only. Server-only.
 */
import { getDb, type Queryable } from "@/mvp/db";
import { isUuid } from "./load";
import type { LeadList } from "./types";

interface ListSql {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  item_count: number;
}

const toList = (row: ListSql): LeadList => ({ id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at, itemCount: Number(row.item_count ?? 0) });

const LIST_SELECT = `select l.id, l.name, l.created_at, l.updated_at,
    (select count(*)::int from lead_list_items i where i.list_id = l.id) as item_count
  from lead_lists l`;

/** All lists, most recently changed first. */
export async function listLeadLists(db: Queryable = getDb()): Promise<LeadList[]> {
  const { rows } = await db.query<ListSql>(`${LIST_SELECT} order by l.updated_at desc, l.name`);
  return rows.map(toList);
}

/** One list with its lead ids (newest first), or null. */
export async function getLeadList(id: string, db: Queryable = getDb()): Promise<(LeadList & { leadIds: string[] }) | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<ListSql>(`${LIST_SELECT} where l.id = $1`, [id]);
  if (!rows[0]) return null;
  const items = await db.query<{ lead_id: string }>("select lead_id from lead_list_items where list_id = $1 order by added_at desc", [id]);
  return { ...toList(rows[0]), leadIds: items.rows.map((r) => r.lead_id) };
}

/** Create a list, optionally with leads. */
export async function createLeadList(name: string, leadIds: string[] = [], userId: string | null = null, db: Queryable = getDb()): Promise<LeadList> {
  const { rows } = await db.query<{ id: string }>("insert into lead_lists (name, created_by) values ($1, $2) returning id", [name.trim().slice(0, 120), userId]);
  const id = rows[0].id;
  if (leadIds.length) await addToLeadList(id, leadIds, db);
  return (await getLeadList(id, db))!;
}

/** Rename a list. Returns null when it doesn't exist. */
export async function renameLeadList(id: string, name: string, db: Queryable = getDb()): Promise<LeadList | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<{ id: string }>("update lead_lists set name = $2, updated_at = now() where id = $1 returning id", [id, name.trim().slice(0, 120)]);
  return rows[0] ? getLeadList(id, db) : null;
}

/** Delete a list (its items go with it). Returns whether it existed. */
export async function deleteLeadList(id: string, db: Queryable = getDb()): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { rows } = await db.query<{ id: string }>("delete from lead_lists where id = $1 returning id", [id]);
  return rows.length > 0;
}

/** Add leads to a list (existing ones are kept; unknown lead ids are ignored). Returns the number added. */
export async function addToLeadList(id: string, leadIds: string[], db: Queryable = getDb()): Promise<number> {
  const ids = [...new Set(leadIds.filter(isUuid).map((x) => x.toLowerCase()))];
  if (!isUuid(id) || !ids.length) return 0;
  const { rows } = await db.query<{ lead_id: string }>(
    `insert into lead_list_items (list_id, lead_id)
       select $1::uuid, l.id from leads l where l.id = any($2::uuid[])
     on conflict do nothing returning lead_id`,
    [id, ids],
  );
  await db.query("update lead_lists set updated_at = now() where id = $1", [id]);
  return rows.length;
}

/** Remove leads from a list. Returns the number removed. */
export async function removeFromLeadList(id: string, leadIds: string[], db: Queryable = getDb()): Promise<number> {
  const ids = [...new Set(leadIds.filter(isUuid).map((x) => x.toLowerCase()))];
  if (!isUuid(id) || !ids.length) return 0;
  const { rows } = await db.query<{ lead_id: string }>("delete from lead_list_items where list_id = $1 and lead_id = any($2::uuid[]) returning lead_id", [id, ids]);
  await db.query("update lead_lists set updated_at = now() where id = $1", [id]);
  return rows.length;
}
