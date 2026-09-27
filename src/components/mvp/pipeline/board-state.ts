import type { LeadListItem, LeadStatus } from "@/mvp/types";

/** Board columns = lead statuses (docs/mvp/13 §5). Rejected lives in the Rejected tab of Leads. */
export const BOARD_STATUSES = ["new", "accepted", "contacted", "rfq", "quoted", "won", "lost"] as const satisfies readonly LeadStatus[];
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export function isBoardStatus(value: string): value is BoardStatus {
  return (BOARD_STATUSES as readonly string[]).includes(value);
}

/**
 * Group leads into board columns using each lead's current (possibly optimistic) status.
 * Leads whose status is not on the board (rejected) are left out. Order inside a column is kept.
 */
export function groupByStatus(
  items: LeadListItem[],
  statusOf: (id: string, status: LeadStatus) => LeadStatus = (_id, status) => status,
): Record<BoardStatus, LeadListItem[]> {
  const columns = Object.fromEntries(BOARD_STATUSES.map((status) => [status, [] as LeadListItem[]])) as Record<BoardStatus, LeadListItem[]>;
  for (const item of items) {
    const status = statusOf(item.id, item.status);
    if (isBoardStatus(status)) columns[status].push(item);
  }
  return columns;
}

/** Sum of scores in a column (a quick "how much is here" number). */
export function columnSummary(items: LeadListItem[]): { count: number; averageScore: number | null } {
  const scored = items.filter((item) => typeof item.score === "number");
  return {
    count: items.length,
    averageScore: scored.length ? Math.round(scored.reduce((sum, item) => sum + (item.score ?? 0), 0) / scored.length) : null,
  };
}

/** MIME type for a lead being dragged (native HTML5 drag and drop). */
export const DRAG_TYPE = "application/x-mvp-lead";
