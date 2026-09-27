"use client";

import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import type { LeadListItem, LeadStatus, RejectReason } from "@/mvp/types";
import { ConfidenceChip, SampleBadge } from "../badges";
import { KIND_SHORT, STAGE_LABELS, STATUS_LABELS, disciplineLabel, formatDate, formatShortDate } from "../labels";
import { RejectMenu } from "./reject-menu";

export interface LeadRowActions {
  statusOf: (id: string, status: LeadStatus) => LeadStatus;
  isBusy: (id: string) => boolean;
  onAccept: (lead: LeadListItem) => void;
  onReject: (lead: LeadListItem, reason: RejectReason) => void;
}

/** Score as a small pill: strong for 70+, medium for 50+. */
export function ScorePill({ score }: { score: number | null }) {
  const tone = score === null ? "score-none" : score >= 70 ? "score-high" : score >= 50 ? "score-mid" : "score-low";
  return (
    <span className={`score-pill ${tone}`} aria-label={score === null ? "Not scored" : `Score ${score} out of 100`}>
      {score ?? "–"}
    </span>
  );
}

export function StatusPill({ status }: { status: LeadStatus }) {
  return <span className={`status-pill status-${status}`}>{STATUS_LABELS[status]}</span>;
}

/** Whole days from now until a YYYY-MM-DD date (negative when past). */
export function daysUntil(date: string, now: number = Date.now()): number {
  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - now) / 86_400_000);
}

/**
 * "closes 18 Oct 2026" (amber when within 14 days) or "added 27 Sep 2026".
 * `short` drops the year when it is the current one ("closes 18 Oct"), for the table.
 */
export function DateCell({ lead, short = false }: { lead: Pick<LeadListItem, "closingDate" | "createdAt">; short?: boolean }) {
  const fmt = short ? formatShortDate : formatDate;
  if (lead.closingDate) {
    const days = daysUntil(lead.closingDate);
    const soon = days >= 0 && days <= 14;
    return (
      <span
        className={soon ? "font-semibold text-[#b54708]" : ""}
        title={soon ? `Closes in ${days} ${days === 1 ? "day" : "days"}` : `Closes ${formatDate(lead.closingDate)}`}
      >
        closes {fmt(lead.closingDate)}
      </span>
    );
  }
  return (
    <span className="text-[#6b7280]" title={`Added ${formatDate(lead.createdAt)}`}>
      added {fmt(lead.createdAt)}
    </span>
  );
}

/**
 * Leads table (docs/mvp/13 §4): Score · Confidence · Company → Project · Country / Category · Type · Stage ·
 * Date · Status · actions. Fixed column widths so it fits ~990 px (1280 screens) without scrolling; the actions
 * column is pinned to the right edge so Accept / Reject stay visible if it ever scrolls (tablet widths).
 * Clicking a row opens the quick preview.
 */
export function LeadsTable({
  items,
  selectedIndex,
  rejectOpenId,
  actions,
  onSelect,
  onPreview,
  onRejectOpenChange,
}: {
  items: LeadListItem[];
  selectedIndex: number;
  rejectOpenId: string | null;
  actions: LeadRowActions;
  onSelect: (index: number) => void;
  onPreview: (lead: LeadListItem) => void;
  onRejectOpenChange: (id: string | null) => void;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="crm-table table-fixed min-w-[900px]" aria-label="Leads">
        <colgroup>
          <col className="w-[64px]" />
          <col className="w-[104px]" />
          <col />
          <col className="w-[132px]" />
          <col className="w-[128px]" />
          <col className="w-[112px]" />
          <col className="w-[120px]" />
          <col className="w-[112px]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Score</th>
            <th scope="col">Confidence</th>
            <th scope="col">Company → Project</th>
            <th scope="col">Country</th>
            <th scope="col">Type · Stage</th>
            <th scope="col" title="Closing date, or the date the lead was added">Date</th>
            <th scope="col">Status</th>
            <th scope="col" className="col-sticky-end text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((lead, index) => {
            const status = actions.statusOf(lead.id, lead.status);
            const busy = actions.isBusy(lead.id);
            const country = lead.projectCountry ?? lead.buyerCountry;
            const category = lead.discipline ? disciplineLabel(lead.discipline) : null;
            const typeStage = [KIND_SHORT[lead.kind], lead.stage ? STAGE_LABELS[lead.stage] : null].filter(Boolean).join(" · ");
            const menuOpen = rejectOpenId === lead.id;
            // Open the reason menu upwards on the last rows so the card's scroll box does not clip it.
            const dropUp = items.length > 3 && index >= items.length - 2;
            return (
              <tr
                key={lead.id}
                data-lead-id={lead.id}
                data-tour={index === 0 ? "leads-first-row" : undefined}
                aria-selected={index === selectedIndex}
                onClick={() => {
                  onSelect(index);
                  onPreview(lead);
                }}
                className="cursor-pointer"
              >
                <td>
                  <ScorePill score={lead.score} />
                </td>
                <td>
                  {lead.confidenceBand ? (
                    <ConfidenceChip band={lead.confidenceBand} />
                  ) : (
                    <span className="text-[#9ca3af]" title="Confidence not known">
                      –
                    </span>
                  )}
                </td>
                <td className="min-w-0">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(index);
                      onPreview(lead);
                    }}
                    onFocus={() => onSelect(index)}
                    className="block max-w-full truncate text-left font-semibold text-[#111827] hover:underline"
                    title={`${lead.buyerName}${lead.projectName ? ` → ${lead.projectName}` : ""}`}
                  >
                    {lead.buyerName}
                    {lead.projectName ? <span className="font-normal text-[#6b7280]"> → {lead.projectName}</span> : null}
                  </button>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[#6b7280]">
                    <span className="truncate">{lead.productNames[0] ?? lead.packageName ?? ""}</span>
                    {lead.isSample ? <SampleBadge /> : null}
                  </span>
                </td>
                <td>
                  <span className="block truncate" title={country ? marketName(country) : undefined}>
                    {country ? marketName(country) : "–"}
                  </span>
                  {category ? (
                    <span className="mt-0.5 block truncate text-xs text-[#6b7280]" title={category}>
                      {category}
                    </span>
                  ) : null}
                </td>
                <td>
                  <span className="block truncate" title={typeStage}>
                    {typeStage || "–"}
                  </span>
                </td>
                <td className="whitespace-nowrap">
                  <DateCell lead={lead} short />
                </td>
                <td className="px-2">
                  <StatusPill status={status} />
                </td>
                <td
                  className="col-sticky-end whitespace-nowrap px-2 text-right"
                  style={menuOpen ? { zIndex: 5 } : undefined}
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="relative inline-flex items-center gap-0.5">
                    {status === "new" ? (
                      <button type="button" disabled={busy} onClick={() => actions.onAccept(lead)} className="btn btn-ghost btn-sm btn-icon" aria-label={`Accept ${lead.buyerName}`} title="Accept (a)">
                        <Check size={15} aria-hidden />
                      </button>
                    ) : null}
                    {status !== "rejected" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRejectOpenChange(menuOpen ? null : lead.id)}
                        className="btn btn-ghost btn-sm btn-icon"
                        aria-label={`Reject ${lead.buyerName}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        title="Reject (r)"
                      >
                        <X size={15} aria-hidden />
                      </button>
                    ) : null}
                    <Link href={`/leads/${lead.id}`} className="btn btn-ghost btn-sm btn-icon" aria-label={`Open ${lead.buyerName}`} title="Open (o)">
                      <ArrowRight size={15} aria-hidden />
                    </Link>
                    {menuOpen ? (
                      <RejectMenu
                        drop={dropUp ? "up" : "down"}
                        onClose={() => onRejectOpenChange(null)}
                        onPick={(reason) => {
                          onRejectOpenChange(null);
                          actions.onReject(lead, reason);
                        }}
                      />
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
