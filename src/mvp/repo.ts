/**
 * Read models and small writes for the UI and /api/mvp routes (docs/mvp/12 §5).
 * All functions use getDb(); rows are typed in src/mvp/types.ts.
 */
import type {
  ActivityRow,
  ActivityType,
  LeadDetail,
  LeadFilter,
  LeadListResult,
  LeadPatch,
  LeadRow,
  RunRow,
  RunWithEvents,
} from "@/mvp/types";

/**
 * Leads for the inbox, sorted by score desc then newest, with per-class counts for the tabs.
 * `filter.status` defaults to "open".
 */
export async function listLeads(filter: LeadFilter = {}): Promise<LeadListResult> {
  void filter;
  return { items: [], counts: { genuine: 0, research: 0, watch: 0, rejected: 0 } };
}

/** Everything the lead page needs (F3/F4), or null when the lead doesn't exist. */
export async function getLeadDetail(id: string): Promise<LeadDetail | null> {
  void id;
  return null;
}

/**
 * Update the user-editable lead fields (status, reject_reason, owner_user_id, next_action),
 * set `updated_at`, and record a 'status_change' activity when the status changes.
 * @returns the updated row, or null when the lead doesn't exist.
 */
export async function updateLead(id: string, patch: LeadPatch): Promise<LeadRow | null> {
  void id;
  void patch;
  throw new Error("not implemented");
}

/** Append an activity (note, status change, draft, sent email…) to a lead. */
export async function addActivity(activity: {
  leadId: string;
  type: ActivityType;
  body?: string | null;
  personId?: string | null;
  userId?: string | null;
}): Promise<ActivityRow> {
  void activity;
  throw new Error("not implemented");
}

/**
 * A run with its progress events (ordered by id).
 * @param afterEventId only return events with id greater than this (for 2 s polling).
 */
export async function getRun(id: string, afterEventId?: number): Promise<RunWithEvents | null> {
  void id;
  void afterEventId;
  return null;
}

/** Most recent runs first. */
export async function listRecentRuns(limit = 10): Promise<RunRow[]> {
  void limit;
  return [];
}
