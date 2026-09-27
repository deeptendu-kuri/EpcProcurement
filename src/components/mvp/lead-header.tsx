"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Mail, NotebookPen } from "lucide-react";
import { LEAD_STATUSES, REJECT_REASONS, type LeadRow, type LeadStatus, type RejectReason } from "@/mvp/types";
import { patchLead } from "./api-client";
import { ConfidenceChip, SampleBadge, ScoreBadge } from "./badges";
import { CLASS_LABELS, KIND_LABELS, REJECT_REASON_LABELS, STATUS_LABELS } from "./labels";

export interface LeadHeaderProps {
  lead: LeadRow;
  buyerName: string;
  projectName: string | null;
  productLabel: string | null;
  onDraftEmail: () => void;
  onAddNote: () => void;
}

/** Sticky lead header (09 §4.3): who · what, score · confidence, status, Draft email, Add note, next step. */
export function LeadHeader({ lead, buyerName, projectName, productLabel, onDraftEmail, onAddNote }: LeadHeaderProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [pendingReject, setPendingReject] = useState(false);
  const [reason, setReason] = useState<RejectReason>((lead.reject_reason as RejectReason) ?? "not_our_scope");
  const [nextAction, setNextAction] = useState(lead.next_action ?? "");
  const [savedNext, setSavedNext] = useState(lead.next_action ?? "");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const save = async (body: Parameters<typeof patchLead>[1], done: string) => {
    setMessage(null);
    try {
      await patchLead(lead.id, body);
      setMessage({ text: done });
      startTransition(() => router.refresh());
      return true;
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not save.", error: true });
      return false;
    }
  };

  const changeStatus = async (value: LeadStatus) => {
    if (value === "rejected") {
      setPendingReject(true);
      return;
    }
    setPendingReject(false);
    const previous = status;
    setStatus(value);
    if (!(await save({ status: value }, "Status saved"))) setStatus(previous);
  };

  const confirmReject = async () => {
    const previous = status;
    setStatus("rejected");
    setPendingReject(false);
    if (!(await save({ status: "rejected", rejectReason: reason }, "Lead rejected"))) setStatus(previous);
  };

  const saveNext = async () => {
    const value = nextAction.trim();
    if (value === savedNext) return;
    if (await save({ nextAction: value || null }, "Next step saved")) setSavedNext(value);
  };

  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-20 -mx-4 border-b border-[#e1e6ef] bg-white/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
      <Link href="/leads" className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-[#475467] hover:text-[#101828]">
        <ArrowLeft size={13} aria-hidden /> Leads
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[#101828]">
            {buyerName}
            {projectName ? <span className="font-semibold text-[#344054]"> · {projectName}</span> : null}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-[#475467]">
            <span className="font-semibold">{KIND_LABELS[lead.kind]}{productLabel ? ` · ${productLabel}` : ""}</span>
            <span className="rounded bg-[#f2f4f7] px-1.5 py-0.5 text-xs font-semibold text-[#344054]">{CLASS_LABELS[lead.class]}</span>
            {lead.is_sample ? <SampleBadge /> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ScoreBadge score={lead.score} size="lg" />
          <ConfidenceChip band={lead.confidence_band} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-[#344054]">
          Status
          <select
            value={pendingReject ? "rejected" : status}
            onChange={(event) => void changeStatus(event.target.value as LeadStatus)}
            className="control focus-ring h-9 px-2 text-sm font-normal"
          >
            {LEAD_STATUSES.map((value) => (
              <option key={value} value={value}>{STATUS_LABELS[value]}</option>
            ))}
          </select>
        </label>
        {pendingReject ? (
          <span className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="header-reject-reason">Reason for rejecting</label>
            <select
              id="header-reject-reason"
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value as RejectReason)}
              className="control focus-ring h-9 px-2 text-sm"
            >
              {REJECT_REASONS.map((value) => (
                <option key={value} value={value}>{REJECT_REASON_LABELS[value]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={confirmReject}
              className="focus-ring inline-flex h-9 items-center rounded-md border border-[#fda29b] bg-white px-3 text-sm font-semibold text-[#b42318] hover:bg-[#fef3f2]"
            >
              Reject
            </button>
            <button type="button" onClick={() => setPendingReject(false)} className="focus-ring h-9 px-2 text-sm text-[#475467]">
              Cancel
            </button>
          </span>
        ) : null}

        <button
          type="button"
          onClick={onDraftEmail}
          className="btn-primary focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold"
        >
          <Mail size={15} aria-hidden /> Draft email
        </button>
        <button
          type="button"
          onClick={onAddNote}
          className="btn-quiet focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold"
        >
          <NotebookPen size={15} aria-hidden /> Add note
        </button>

        <label className="ml-auto flex min-w-0 items-center gap-2 text-sm font-semibold text-[#344054]">
          Next step
          <input
            value={nextAction}
            onChange={(event) => setNextAction(event.target.value)}
            onBlur={() => void saveNext()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveNext();
              }
            }}
            maxLength={500}
            placeholder="e.g. Call procurement on Monday"
            className="control focus-ring h-9 w-56 min-w-0 px-2 text-sm font-normal"
          />
        </label>
      </div>
      {message ? (
        <p role="status" className={`mt-1 text-xs font-semibold ${message.error ? "text-[#b42318]" : "text-[#067647]"}`}>{message.text}</p>
      ) : null}
    </header>
  );
}
