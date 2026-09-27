import { marketName } from "@/mvp/config/markets";
import type { LeadClass, LeadKind, LeadListItem } from "@/mvp/types";

const CLASS: Record<LeadClass, string> = { genuine: "Genuine", research: "Needs research", watch: "Watching", rejected: "Rejected" };
const KIND: Record<LeadKind, string> = { bid: "Bid", supply_subcontract: "Supply / subcontract" };

export const CSV_HEADER = [
  "Lead ID", "Class", "Score", "Confidence", "Type", "Products", "Buyer", "Buyer country", "Project", "Project country",
  "Package", "Closing date", "Status", "Reasons", "Evidence URLs", "Sample data", "Created",
];

/** Quote a CSV cell; neutralise spreadsheet formulas (cells starting with = + - @ or a tab/CR). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function leadsToCsv(items: LeadListItem[], evidenceUrls: Record<string, string[]>): string {
  const rows = items.map((lead) => [
    lead.id,
    CLASS[lead.class],
    lead.score ?? "",
    lead.confidenceBand ? lead.confidenceBand[0].toUpperCase() + lead.confidenceBand.slice(1) : "",
    KIND[lead.kind],
    lead.productNames.join("; "),
    lead.buyerName,
    lead.buyerCountry ? marketName(lead.buyerCountry) : "",
    lead.projectName ?? "",
    lead.projectCountry ? marketName(lead.projectCountry) : "",
    lead.packageName ?? "",
    lead.closingDate ?? "",
    lead.status,
    lead.reasons.map((reason) => reason.text).join(" | "),
    (evidenceUrls[lead.id] ?? []).join(" "),
    lead.isSample ? "yes" : "no",
    lead.createdAt,
  ]);
  // BOM so Excel opens UTF-8 correctly; CRLF per RFC 4180.
  return "﻿" + [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
