"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Loader2, X } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import type { LeadDetail, LeadListItem, LeadStatus, RejectReason } from "@/mvp/types";
import { apiJson } from "../api-client";
import { BuyerTypeBadge, ConfidenceChip, SampleBadge } from "../badges";
import { EvidenceButton, EvidenceProvider } from "../evidence";
import { CLASS_LABELS, FAILED_CHECK_TITLES, KIND_LABELS, STAGE_LABELS, disciplineLabel, formatDate, formatMoney } from "../labels";
import { SkeletonBlock } from "../skeleton";
import { DateCell, ScorePill, StatusPill } from "./leads-table";
import { RejectMenu } from "./reject-menu";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[#6b7280]">{label}</dt>
      <dd className="min-w-0 font-medium text-[#111827]">{children || <span className="font-normal text-[#9ca3af]">Not found</span>}</dd>
    </>
  );
}

/**
 * Quick-preview drawer (docs/mvp/13 §4): reasons with ⓘ proof, key facts, Accept / Reject / Open full page.
 * A full-screen sheet on phones.
 */
export function LeadDrawer({
  lead,
  status,
  busy,
  onClose,
  onAccept,
  onReject,
}: {
  lead: LeadListItem;
  status: LeadStatus;
  busy: boolean;
  onClose: () => void;
  onAccept: () => void;
  onReject: (reason: RejectReason) => void;
}) {
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiJson<LeadDetail>(`/api/mvp/leads/${lead.id}`, { signal: controller.signal })
      .then((value) => {
        setDetail(value);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load the lead.");
      });
    return () => controller.abort();
  }, [lead.id]);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      // An open proof panel or reject menu handles Escape first.
      if (event.key === "Escape" && !document.querySelector('[aria-labelledby="evidence-title"]')) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const country = lead.projectCountry ?? lead.buyerCountry;
  const failed = (detail?.gates ?? []).filter((gate) => !gate.pass);
  const reasons = detail?.reasons ?? lead.reasons;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <button type="button" aria-label="Close preview" className="backdrop absolute inset-0" onClick={onClose} />
      <EvidenceProvider evidence={detail?.evidence ?? {}}>
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
          className="slide-in-right relative flex h-full w-full flex-col bg-white shadow-lg outline-none sm:max-w-[480px]"
        >
          <div className="flex items-start gap-3 border-b border-[var(--line)] px-5 py-4">
            <ScorePill score={lead.score} />
            <div className="min-w-0 flex-1">
              <h2 id="preview-title" className="text-base font-semibold leading-snug text-[#111827]">
                {lead.buyerName}
                {lead.projectName ? <span className="font-normal text-[#6b7280]"> → {lead.projectName}</span> : null}
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                <ConfidenceChip band={lead.confidenceBand} />
                <BuyerTypeBadge type={lead.buyerType} />
                <span className="chip">{CLASS_LABELS[lead.class]}</span>
                <StatusPill status={status} />
                {lead.isSample ? <SampleBadge /> : null}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-icon">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {lead.class === "rejected" && failed.length ? (
              <div role="note" className="mb-4 flex gap-2 rounded-lg border border-[#fecdca] bg-[#fef3f2] p-3 text-sm text-[#b42318]">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                <div>
                  {failed.map((gate) => (
                    <p key={gate.id}>
                      <span className="font-semibold">{FAILED_CHECK_TITLES[gate.id] ?? "A required check failed"}.</span> {gate.why}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}

            <h3 className="eyebrow">Why this lead</h3>
            {reasons.length ? (
              <ul className="mt-2 flex flex-col gap-2">
                {reasons.map((reason, index) => (
                  <li key={index} className="flex gap-2 text-sm text-[#374151]">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    <span>
                      {reason.text}
                      <EvidenceButton ids={reason.evidenceIds} label="Proof" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[#9ca3af]">No reasons recorded yet.</p>
            )}

            <h3 className="eyebrow mt-6">Key facts</h3>
            <dl className="mt-2 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <Fact label="Type">{KIND_LABELS[lead.kind]}</Fact>
              <Fact label="Product">{lead.productNames.join(", ")}</Fact>
              <Fact label="Country">{country ? marketName(country) : null}</Fact>
              <Fact label="Category">{lead.discipline ? disciplineLabel(lead.discipline) : null}</Fact>
              <Fact label="Stage">{lead.stage ? STAGE_LABELS[lead.stage] : null}</Fact>
              <Fact label="Package">{lead.packageName}</Fact>
              <Fact label="Date"><DateCell lead={lead} /></Fact>
              {detail ? (
                <>
                  <Fact label="Project value">{detail.project?.value_usd ? formatMoney(detail.project.value_usd, "USD") : null}</Fact>
                  <Fact label="People found">{detail.people.length ? String(detail.people.length) : "None yet"}</Fact>
                  <Fact label="Sources">{String(Object.keys(detail.evidence).length)}</Fact>
                </>
              ) : null}
              {lead.nextAction ? <Fact label="Next step">{lead.nextAction}</Fact> : null}
              <Fact label="Added">{formatDate(lead.createdAt)}</Fact>
            </dl>

            {!detail && !error ? (
              <div className="mt-4 flex flex-col gap-2" aria-hidden>
                <SkeletonBlock className="h-4 w-2/3" />
                <SkeletonBlock className="h-4 w-1/2" />
              </div>
            ) : null}
            {error ? <p role="alert" className="mt-4 text-sm text-[#b42318]">{error}</p> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] bg-[#fafafb] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {status === "new" ? (
              <button type="button" disabled={busy} onClick={onAccept} className="btn btn-secondary">
                {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
                Accept
              </button>
            ) : null}
            {status !== "rejected" ? (
              <span className="relative">
                <button type="button" disabled={busy} onClick={() => setRejectOpen((open) => !open)} aria-haspopup="menu" aria-expanded={rejectOpen} className="btn btn-secondary">
                  <X size={15} aria-hidden />
                  Reject
                </button>
                {rejectOpen ? (
                  <RejectMenu
                    align="left"
                    drop="up"
                    onClose={() => setRejectOpen(false)}
                    onPick={(reason) => {
                      setRejectOpen(false);
                      onReject(reason);
                    }}
                  />
                ) : null}
              </span>
            ) : null}
            <Link href={`/leads/${lead.id}`} className="btn btn-primary ml-auto">
              Open full page
              <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      </EvidenceProvider>
    </div>
  );
}
