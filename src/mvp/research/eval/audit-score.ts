/** Replays the "save as a lead?" decision for one audited company with the current rules (no AI call). */
import { consistentRating, consistentType, type BuyerType } from "../shortlist";
import { LIKELY_MIN, leadRoleFor } from "../likely";

export interface AuditRow {
  set: string; productId: string; query: string; markets: string[]; includeResellers: boolean;
  name: string; quote: string | null; title: string | null; url: string | null; domain: string | null;
  rating: number | null; role: string | null; reason: string | null; type: BuyerType | null; match: string | null; source: "ai" | "rules" | null;
  grade: "A" | "B" | "C" | "D"; what: string;
}

export function leadDecision(r: AuditRow, productName: string): { lead: boolean; rating: number | null; type: BuyerType | null } {
  if (r.rating === null || r.source !== "ai") return { lead: false, rating: r.rating, type: r.type };
  const judged = { rating: r.rating, role: r.role ?? "", reason: r.reason ?? "", buyerType: r.type };
  const row = { company: r.name, identity_quote: r.quote, title: r.title, url: r.url, domain: r.domain };
  const opts = { resellers: r.includeResellers, markets: r.markets };
  const rating = consistentRating(judged, row, productName, opts);
  const type = consistentType(judged, row, productName, opts);
  return { lead: rating >= LIKELY_MIN && Boolean(type && leadRoleFor(type)), rating, type };
}
