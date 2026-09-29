/**
 * Startup cleanup (docs/mvp/15 §F): re-apply the place-name rule (14 §11) to stored companies. Leads
 * whose buyer is really a place ("Shankar Chowk") become Not a buyer (class `rejected`) with a reason.
 * Idempotent; safe to run on every start.
 */
import type { Queryable } from "@/mvp/db";
import { isPlaceName } from "./merge";

export const PLACE_NAME_REJECT_REASON = "Not a buyer: place name, not a company";

export async function cleanupPlaceNameCompanies(db: Queryable): Promise<{ companies: string[]; leads: number }> {
  const { rows } = await db.query<{ id: string; canonical_name: string }>(
    "select distinct c.id, c.canonical_name from companies c join leads l on l.buyer_company_id = c.id where l.class <> 'rejected'",
  );
  const places = rows.filter((c) => isPlaceName(c.canonical_name));
  let leads = 0;
  for (const c of places) {
    const updated = await db.query<{ id: string }>(
      `update leads set class = 'rejected',
              reasons = jsonb_build_array(jsonb_build_object('text', $2::text, 'evidenceIds', '[]'::jsonb)) || coalesce(reasons, '[]'::jsonb),
              updated_at = now()
        where buyer_company_id = $1 and class <> 'rejected' returning id`,
      [c.id, PLACE_NAME_REJECT_REASON],
    );
    leads += updated.rows.length;
  }
  return { companies: places.map((c) => c.canonical_name), leads };
}

const globalFlag = globalThis as unknown as { __mvpPlaceCleanup?: Promise<unknown> };

/** Run the cleanup once per process (the first call wins; errors are logged, never thrown). */
export function ensurePlaceNameCleanup(db: Queryable): Promise<unknown> {
  if (!globalFlag.__mvpPlaceCleanup) {
    globalFlag.__mvpPlaceCleanup = cleanupPlaceNameCompanies(db).catch((error) => {
      console.error("[startup] place-name cleanup failed", error);
      globalFlag.__mvpPlaceCleanup = undefined;
    });
  }
  return globalFlag.__mvpPlaceCleanup;
}
