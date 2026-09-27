/**
 * Saved searches with auto-refresh (docs/mvp/13 §7). Stored in `saved_searches` (migration 002).
 * Server-only. Parameterised SQL only.
 */
import { getDb, type Queryable } from "@/mvp/db";
import type { LeadKind, RefreshHours, RunCounters, RunStatus, SavedSearchRow, SavedSearchView } from "@/mvp/types";

export const REFRESH_CHOICES: RefreshHours[] = [6, 12, 24];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR_MS = 60 * 60 * 1000;

export interface SavedSearchInput {
  name: string;
  query: string;
  markets: string[];
  leadKinds: LeadKind[];
  refreshHours: RefreshHours | null;
  /** The run that was just made with these settings (counts as the first run). */
  lastRunId?: string | null;
}

/** When a saved search is due next (null = manual or paused). Never run → due now (its creation time). */
export function nextRunAt(search: Pick<SavedSearchRow, "active" | "refresh_hours" | "last_run_at" | "created_at">): Date | null {
  if (!search.active || !search.refresh_hours) return null;
  if (!search.last_run_at) return new Date(search.created_at);
  return new Date(new Date(search.last_run_at).getTime() + search.refresh_hours * HOUR_MS);
}

/** True when the scheduler should run this search at `now`. */
export function isDue(search: Pick<SavedSearchRow, "active" | "refresh_hours" | "last_run_at" | "created_at">, now: Date): boolean {
  const next = nextRunAt(search);
  return next !== null && next.getTime() <= now.getTime();
}

interface ViewSqlRow extends SavedSearchRow {
  run_status: RunStatus | null;
  run_counters: RunCounters | null;
}

function toView(row: ViewSqlRow): SavedSearchView {
  const { run_status, run_counters, ...rest } = row;
  const next = nextRunAt(rest);
  return {
    ...rest,
    markets: rest.markets ?? [],
    lead_kinds: rest.lead_kinds ?? [],
    lastRunStatus: run_status ?? null,
    lastRunNewLeads: typeof run_counters?.newLeads === "number" ? run_counters.newLeads : null,
    nextRunAt: next ? next.toISOString() : null,
  };
}

const VIEW_SQL = `select s.*, r.status as run_status, r.counters as run_counters
  from saved_searches s left join runs r on r.id = s.last_run_id`;

/** All saved searches, newest first, with their last run. */
export async function listSavedSearches(db: Queryable = getDb()): Promise<SavedSearchView[]> {
  const { rows } = await db.query<ViewSqlRow>(`${VIEW_SQL} order by s.created_at desc limit 100`);
  return rows.map(toView);
}

export async function getSavedSearch(id: string, db: Queryable = getDb()): Promise<SavedSearchView | null> {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await db.query<ViewSqlRow>(`${VIEW_SQL} where s.id = $1`, [id]);
  return rows[0] ? toView(rows[0]) : null;
}

export async function createSavedSearch(input: SavedSearchInput, db: Queryable = getDb()): Promise<SavedSearchView> {
  const { rows } = await db.query<{ id: string }>(
    `insert into saved_searches (name, query, markets, lead_kinds, refresh_hours, last_run_id, last_run_at)
     select $1, $2, $3::text[], $4::text[], $5, r.id, coalesce(r.started_at, r.created_at)
       from (select 1) one left join runs r on r.id = $6::uuid
     returning id`,
    [
      input.name.trim().slice(0, 120),
      input.query.trim(),
      input.markets,
      input.leadKinds,
      input.refreshHours,
      input.lastRunId && UUID_RE.test(input.lastRunId) ? input.lastRunId : null,
    ],
  );
  return (await getSavedSearch(rows[0].id, db))!;
}

/** Pause/resume or change the refresh interval / name. Returns null when it doesn't exist. */
export async function updateSavedSearch(
  id: string,
  patch: { active?: boolean; refreshHours?: RefreshHours | null; name?: string },
  db: Queryable = getDb(),
): Promise<SavedSearchView | null> {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await db.query<{ id: string }>(
    `update saved_searches
        set active = coalesce($2, active),
            refresh_hours = case when $3::boolean then $4::int else refresh_hours end,
            name = coalesce($5, name)
      where id = $1 returning id`,
    [id, patch.active ?? null, patch.refreshHours !== undefined, patch.refreshHours ?? null, patch.name?.trim().slice(0, 120) || null],
  );
  return rows[0] ? getSavedSearch(id, db) : null;
}

export async function deleteSavedSearch(id: string, db: Queryable = getDb()): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const { rows } = await db.query("delete from saved_searches where id = $1 returning id", [id]);
  return rows.length > 0;
}

/** Record that a run started for this saved search (sets last_run_at / last_run_id). */
export async function markSavedSearchRun(id: string, runId: string, db: Queryable = getDb()): Promise<void> {
  await db.query("update saved_searches set last_run_at = now(), last_run_id = $2 where id = $1", [id, runId]);
}

/** Active saved searches whose refresh time has passed. */
export async function dueSavedSearches(now: Date = new Date(), db: Queryable = getDb()): Promise<SavedSearchRow[]> {
  const { rows } = await db.query<SavedSearchRow>(
    `select * from saved_searches
      where active and refresh_hours is not null
        and (last_run_at is null or last_run_at + refresh_hours * interval '1 hour' <= $1::timestamptz)
      order by coalesce(last_run_at, created_at) limit 20`,
    [now.toISOString()],
  );
  return rows.filter((row) => isDue(row, now));
}
