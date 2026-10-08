import { originalQuote, attributedScope, companyNames } from "./evidence";

export type ActivityStatus = "recent" | "ongoing" | "capability_only" | "historic" | "unknown";
export interface ActivityClaim { company: string; companyQuote: string; activityQuote?: string | null; activityDate?: string | null }
/** A fetch time, copyright year or model-suggested date is not evidence of active work. */
export function buyerActivity(b: ActivityClaim, text: string, now = new Date(), scoped=false) {
  const quote = b.activityQuote && (scoped?originalQuote(text,b.activityQuote):attributedScope(text, b.activityQuote, b.companyQuote, companyNames(b.company, b.companyQuote)));
  const empty = { status: "capability_only" as ActivityStatus, date: null as string | null, quote: null as string | null };
  if (!quote) return empty;
  if (/\b(?:completed|cancelled|canceled|terminated|suspended)\b/i.test(quote)) return { status: "historic" as ActivityStatus, date: null, quote };
  const value = b.activityDate;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return empty;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return empty;
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const [year, month, day] = value.split("-").map(Number);
  const datePatterns = [value, `${day} ${months[month-1]} ${year}`, `${months[month-1]} ${day}, ${year}`, `${day} ${months[month-1].slice(0,3)} ${year}`];
  if (!datePatterns.some(token => originalQuote(quote, token))) return empty;
  const age = (now.getTime() - parsed.getTime()) / 86_400_000;
  if (age < 0) return empty;
  if (age > 180) return { status: "historic" as ActivityStatus, date: value, quote };
  if (/\b(?:ongoing|under construction|in progress|executing|installation underway)\b/i.test(quote)) return { status: "ongoing" as ActivityStatus, date: value, quote };
  if (/\b(?:awarded|won|secured|contract award|construction started)\b/i.test(quote)) return { status: "recent" as ActivityStatus, date: value, quote };
  return empty;
}

export function buyerPriority(fit: "explicit" | "application", activity: ActivityStatus, tier: string) {
  const components = {
    material: fit === "explicit" ? 40 : 25,
    consumingActivity: 20,
    currentWork: activity === "recent" || activity === "ongoing" ? 25 : activity === "historic" ? 0 : null,
    source: tier === "A" ? 15 : tier === "B" ? 12 : 8,
  };
  return { components, score: Object.values(components).reduce<number>((sum, value) => sum + (value ?? 0), 0) };
}
