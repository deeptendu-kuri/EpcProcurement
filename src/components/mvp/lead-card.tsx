"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CalendarClock, Check, Eye, X } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import { REJECT_REASONS, type LeadListItem, type RejectReason } from "@/mvp/types";
import { BuyerTypeBadge, ConfidenceChip, NewBadge, SampleBadge, ScoreBadge } from "./badges";
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
  /** Open the quick preview (Cards view); the title link then previews instead of navigating. */
  onPreview?: (id: string) => void;
  /** data-tour marker (the first card in the tour). */
  tourId?: string;
}

/** One lead in the inbox (09 §4.2): score, confidence, type · product, buyer → project, ≤ 3 reasons. */
export function LeadCard({ lead, selected, busy, rejectOpen, onRejectOpenChange, onAccept, onReject, onPreview, tourId }: LeadCardProps) {
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
      data-tour={tourId}
      className={`card flex h-full flex-col p-4 transition-shadow hover:shadow-md ${selected ? "ring-2 ring-[var(--accent)]" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {lead.status === "new" ? <NewBadge /> : (
          <span className={`status-pill status-${lead.status}`}>{STATUS_LABELS[lead.status]}</span>
        )}
        <ScoreBadge score={lead.score} />
        <ConfidenceChip band={lead.confidenceBand} />
        <span className="text-xs font-semibold text-[#374151]">
          {KIND_SHORT[lead.kind]}
          {product ? ` · ${product}` : ""}
        </span>
        <BuyerTypeBadge type={lead.buyerType} />
        {lead.isSample ? <SampleBadge /> : null}
      </div>

      <h3 className="mt-2.5 text-[0.9375rem] font-semibold leading-snug text-[#111827]">
        <Link
          href={`/leads/${lead.id}`}
          className="focus-ring hover:underline"
          onClick={(event) => {
            if (!onPreview || event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            onPreview(lead.id);
          }}
        >
          {lead.buyerName}
          {lead.projectName ? <> → {lead.projectName}</> : null}
        </Link>
        {country ? <span className="font-normal text-[#6b7280]"> ({marketName(country)})</span> : null}
        {lead.closingDate ? (
          <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-[#b54708]">
            <CalendarClock size={14} aria-hidden />
            closes {formatDate(lead.closingDate)}
          </span>
        ) : null}
      </h3>

      {lead.reasons.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[0.8125rem] text-[#4b5563] marker:text-[#c3c7cf]">
          {lead.reasons.slice(0, 3).map((reason, index) => (
            <li key={index}>{reason.text}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[#98a2b3]">No reasons recorded yet.</p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-3">
        {canAct && onAccept ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAccept(lead.id)}
            className="btn btn-secondary btn-sm"
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
                className="control h-8 px-2 text-sm"
              >
                {REJECT_REASONS.map((value) => (
                  <option key={value} value={value}>{REJECT_REASON_LABELS[value]}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy}
                className="btn btn-danger btn-sm"
              >
                Reject
              </button>
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(true)}
              className="btn btn-secondary btn-sm"
            >
              <X size={15} aria-hidden />
              Reject
            </button>
          )
        ) : null}
        {onPreview ? (
          <button type="button" onClick={() => onPreview(lead.id)} className="btn btn-ghost btn-sm" aria-label={`Preview ${lead.buyerName}`}>
            <Eye size={15} aria-hidden />
            Preview
          </button>
        ) : null}
        <Link
          href={`/leads/${lead.id}`}
          className="btn btn-primary btn-sm"
        >
          Open
          <ArrowRight size={15} aria-hidden />
        </Link>
      </div>
    </article>
  );
}
