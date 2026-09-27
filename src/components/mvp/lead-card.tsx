"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CalendarClock, Check, X } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import { REJECT_REASONS, type LeadListItem, type RejectReason } from "@/mvp/types";
import { ConfidenceChip, NewBadge, SampleBadge, ScoreBadge } from "./badges";
import { KIND_SHORT, REJECT_REASON_LABELS, STATUS_LABELS, formatDate } from "./labels";

export interface LeadCardProps {
  lead: LeadListItem;
  selected?: boolean;
  busy?: boolean;
  /** Controlled open state of the reject reason picker (keyboard "r" opens it). */
  rejectOpen?: boolean;
  onRejectOpenChange?: (open: boolean) => void;
  onAccept?: (id: string) => void;
  onReject?: (id: string, reason: RejectReason) => void;
}

/** One lead in the inbox (09 §4.2): score, confidence, type · product, buyer → project, ≤ 3 reasons. */
export function LeadCard({ lead, selected, busy, rejectOpen, onRejectOpenChange, onAccept, onReject }: LeadCardProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = rejectOpen ?? localOpen;
  const setOpen = (value: boolean) => (onRejectOpenChange ? onRejectOpenChange(value) : setLocalOpen(value));
  const [reason, setReason] = useState<RejectReason>("not_our_scope");

  const country = lead.projectCountry ?? lead.buyerCountry;
  const product = lead.productNames[0] ?? lead.packageName ?? null;
  const canAct = lead.status === "new";

  return (
    <article
      data-lead-id={lead.id}
      aria-label={`${lead.buyerName}${lead.projectName ? `, ${lead.projectName}` : ""}`}
      className={`surface rounded-xl p-4 transition-shadow ${selected ? "ring-2 ring-[#2563eb]" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {lead.status === "new" ? <NewBadge /> : (
          <span className="rounded-md bg-[#f2f4f7] px-2 py-0.5 text-xs font-semibold text-[#475467]">{STATUS_LABELS[lead.status]}</span>
        )}
        <ScoreBadge score={lead.score} />
        <ConfidenceChip band={lead.confidenceBand} />
        <span className="text-sm font-semibold text-[#344054]">
          {KIND_SHORT[lead.kind]}
          {product ? ` · ${product}` : ""}
        </span>
        {lead.isSample ? <SampleBadge /> : null}
      </div>

      <h3 className="mt-2 text-base font-bold text-[#101828]">
        <Link href={`/leads/${lead.id}`} className="focus-ring hover:underline">
          {lead.buyerName}
          {lead.projectName ? <> → {lead.projectName}</> : null}
        </Link>
        {country ? <span className="font-semibold text-[#475467]"> ({marketName(country)})</span> : null}
        {lead.closingDate ? (
          <span className="ml-2 inline-flex items-center gap-1 text-sm font-semibold text-[#b54708]">
            <CalendarClock size={14} aria-hidden />
            closes {formatDate(lead.closingDate)}
          </span>
        ) : null}
      </h3>

      {lead.reasons.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-[#344054]">
          {lead.reasons.slice(0, 3).map((reason, index) => (
            <li key={index}>{reason.text}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[#98a2b3]">No reasons recorded yet.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {canAct && onAccept ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAccept(lead.id)}
            className="btn-quiet focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold disabled:opacity-50"
          >
            <Check size={15} aria-hidden />
            Accept
          </button>
        ) : null}
        {lead.status !== "rejected" && onReject ? (
          open ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onReject(lead.id, reason);
                setOpen(false);
              }}
            >
              <label className="sr-only" htmlFor={`reject-${lead.id}`}>Reason for rejecting</label>
              <select
                id={`reject-${lead.id}`}
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value as RejectReason)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setOpen(false);
                }}
                className="control focus-ring h-9 px-2 text-sm"
              >
                {REJECT_REASONS.map((value) => (
                  <option key={value} value={value}>{REJECT_REASON_LABELS[value]}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy}
                className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-[#fda29b] bg-white px-3 text-sm font-semibold text-[#b42318] hover:bg-[#fef3f2] disabled:opacity-50"
              >
                Reject
              </button>
              <button type="button" onClick={() => setOpen(false)} className="focus-ring h-9 rounded-md px-2 text-sm text-[#475467]">
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(true)}
              className="btn-quiet focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold disabled:opacity-50"
            >
              <X size={15} aria-hidden />
              Reject
            </button>
          )
        ) : null}
        <Link
          href={`/leads/${lead.id}`}
          className="btn-primary focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold"
        >
          Open
          <ArrowRight size={15} aria-hidden />
        </Link>
      </div>
    </article>
  );
}
