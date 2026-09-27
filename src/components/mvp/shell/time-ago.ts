import { formatDateTime } from "../labels";

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** "Updated 12 min ago" from the last finished run, or a plain hint when there was none. */
export function updatedLabel(iso: string | null | undefined, now: number = Date.now()): string {
  const ago = timeAgo(iso, now);
  return ago ? `Updated ${ago}` : "Not updated yet";
}

/**
 * Hydration-safe label: before the browser clock is known (now = 0, also on the server) it shows the
 * absolute UTC time, then "Updated x min ago".
 */
export function statusLabel(iso: string | null | undefined, now: number): string {
  if (!iso) return "Not updated yet";
  return now > 0 ? updatedLabel(iso, now) : `Updated ${formatDateTime(iso)}`;
}
