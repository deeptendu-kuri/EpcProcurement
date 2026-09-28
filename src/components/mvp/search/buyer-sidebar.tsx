"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Plus, X } from "lucide-react";
import type { BuyerView } from "@/mvp/buyers/types";
import type { LeadStatus, RejectReason } from "@/mvp/types";
import { SampleBadge } from "../badges";
import { RejectMenu } from "../leads/reject-menu";
import { useLeadActions } from "../leads/use-lead-actions";
import { BUYER_STAGE_LABELS, HOW_SURE_LABELS, HOW_SURE_STYLES, STAGE_STYLES, countryName } from "./buyer-labels";
import { getBuyer } from "./buyer-api";
import { ChainCard, ProofCard, ReachCard, SellCard, TeamCard, WhyNowCard, WhyYouCard, WindowCard } from "./buyer-sections";
import { Avatar, RolePill } from "./results-table";

/** "Manufacturer (pipe mill)". */
export function fullRoleLabel(buyer: Pick<BuyerView, "roleLabel" | "subRoleLabel">): string {
  const sub = buyer.subRoleLabel?.trim();
  if (!sub || buyer.roleLabel.toLowerCase().includes(sub.toLowerCase())) return buyer.roleLabel;
  return `${buyer.roleLabel} (${sub.charAt(0).toLowerCase()}${sub.slice(1)})`;
}

/** The header of a buyer: avatar, name, role chip, country, stage, fit / 100 and how sure we are. */
export function BuyerHeader({ buyer, headingId, onClose }: { buyer: BuyerView; headingId?: string; onClose?: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <Avatar name={buyer.name} size="lg" />
      <div className="min-w-0 flex-1">
        <h2 id={headingId} className="text-lg font-bold leading-tight text-[#111827]">{buyer.name}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <RolePill role={buyer.role} label={fullRoleLabel(buyer)} prefix="Buyer" />
          <span className="rounded-md bg-[#f1f5f9] px-[7px] py-0.5 text-[11px] text-[#475569]">
            {countryName(buyer.country)}
            {buyer.city && buyer.city.trim().toLowerCase() !== countryName(buyer.country).toLowerCase() ? ` · ${buyer.city}` : ""}
          </span>
          <span className={`rounded-md px-[7px] py-0.5 text-[11px] font-semibold ${STAGE_STYLES[buyer.stage]}`}>{BUYER_STAGE_LABELS[buyer.stage]}</span>
          {buyer.isSample ? <SampleBadge /> : null}
        </div>
      </div>
      <div className="shrink-0 text-right" title="Buyer fit (0–100) and how sure we are">
        <span className="text-2xl font-bold tabular-nums text-[#111827]">{buyer.fitScore}</span>
        <span className="text-[#6b7280]">/100</span>
        <p className={`text-xs ${HOW_SURE_STYLES[buyer.howSure]}`}>
          {HOW_SURE_LABELS[buyer.howSure]}
          <span className="block text-[11px] text-[#9ca3af]">how sure we are</span>
        </p>
      </div>
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-icon -mr-2 -mt-1 text-[#94a3b8]" data-autofocus>
          <X size={18} />
        </button>
      ) : null}
    </div>
  );
}

/** The cards of the sidebar, in the order of the mockup (plus "Why you"). */
export function BuyerBody({ buyer, onOpenCompany }: { buyer: BuyerView; onOpenCompany?: (name: string) => void }) {
  return (
    <>
      <WhyNowCard buyer={buyer} />
      <SellCard buyer={buyer} />
      <WhyYouCard buyer={buyer} />
      <WindowCard buyer={buyer} />
      <TeamCard buyer={buyer} />
      <ChainCard buyer={buyer} onOpenCompany={onOpenCompany} />
      <ReachCard buyer={buyer} />
      <ProofCard buyer={buyer} />
    </>
  );
}

export interface BuyerSidebarViewProps {
  buyer: BuyerView;
  status: LeadStatus;
  busy?: boolean;
  onClose: () => void;
  onGood: () => void;
  onNotRelevant: (reason: RejectReason) => void;
  onAddToList: () => void;
  onOpenCompany?: (name: string) => void;
}

/** The buyer sidebar (docs/mvp/14 §10), presentational. */
export function BuyerSidebarView({ buyer, status, busy = false, onClose, onGood, onNotRelevant, onAddToList, onOpenCompany }: BuyerSidebarViewProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const good = status !== "new" && status !== "rejected";
  return (
    <>
      <div className="border-b border-[var(--line)] px-[22px] pb-3.5 pt-[18px]">
        <BuyerHeader buyer={buyer} headingId="buyer-sidebar-title" onClose={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-6 pt-3.5">
        <BuyerBody buyer={buyer} onOpenCompany={onOpenCompany} />
      </div>
      <div className="flex flex-wrap items-center gap-2.5 border-t border-[var(--line)] bg-white px-[22px] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onGood}
          disabled={busy || good}
          className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#16a34a] bg-[#16a34a] px-3.5 py-2 text-[13.5px] font-semibold text-white hover:bg-[#15803d] disabled:opacity-60"
        >
          <Check size={15} aria-hidden /> {good ? "Marked good lead" : "Good lead"}
        </button>
        <span className="relative">
          <button
            type="button"
            onClick={() => setRejectOpen((value) => !value)}
            disabled={busy || status === "rejected"}
            aria-haspopup="menu"
            aria-expanded={rejectOpen}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--line)] bg-white px-3.5 py-2 text-[13.5px] font-semibold text-[#111827] hover:bg-[var(--subtle)] disabled:opacity-60"
          >
            <X size={15} aria-hidden /> {status === "rejected" ? "Marked not relevant" : "Not relevant"}
          </button>
          {rejectOpen ? (
            <RejectMenu
              align="left"
              drop="up"
              onClose={() => setRejectOpen(false)}
              onPick={(reason) => {
                setRejectOpen(false);
                onNotRelevant(reason);
              }}
            />
          ) : null}
        </span>
        <button
          type="button"
          onClick={onAddToList}
          className="inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--line)] bg-white px-3.5 py-2 text-[13.5px] font-semibold text-[#111827] hover:bg-[var(--subtle)]"
        >
          <Plus size={15} aria-hidden /> Add to list
        </button>
        <Link
          href={`/buyers/${buyer.leadId}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-[9px] border border-[#2563eb] bg-[#2563eb] px-3.5 py-2 text-[13.5px] font-semibold text-white hover:bg-[#1d4ed8]"
        >
          Open full page <ArrowRight size={15} aria-hidden />
        </Link>
      </div>
    </>
  );
}

/**
 * Right-hand buyer sidebar over the results (docs/mvp/14 §10). Loads GET /api/mvp/buyers/[id];
 * Esc or the shade closes it.
 */
export function BuyerSidebar({ leadId, onClose, onAddToList, onOpenCompany }: {
  leadId: string;
  onClose: () => void;
  onAddToList: (leadIds: string[]) => void;
  onOpenCompany?: (name: string) => void;
}) {
  const [buyer, setBuyer] = useState<BuyerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = useLeadActions();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    getBuyer(leadId, controller.signal)
      .then((view) => {
        setBuyer(view);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load this buyer.");
      });
    return () => controller.abort();
  }, [leadId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (buyer) (panelRef.current?.querySelector("[data-autofocus]") as HTMLElement | null)?.focus();
  }, [buyer]);

  const status = buyer ? actions.statusOf(buyer.leadId, buyer.status as LeadStatus) : "new";

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="buyer-sidebar-title">
      <button type="button" aria-label="Close buyer" onClick={onClose} className="absolute inset-0 bg-[rgba(15,23,42,.18)]" />
      <section
        ref={panelRef}
        className="slide-in-right absolute right-0 top-0 flex h-full w-full max-w-[600px] flex-col bg-white shadow-[-12px_0_40px_rgba(15,23,42,.18)]"
      >
        {buyer && buyer.leadId === leadId ? (
          <BuyerSidebarView
            buyer={buyer}
            status={status}
            busy={actions.isBusy(buyer.leadId)}
            onClose={onClose}
            onGood={() => void actions.accept(buyer.leadId, status, buyer.name)}
            onNotRelevant={(reason) => void actions.reject(buyer.leadId, status, reason, buyer.name)}
            onAddToList={() => onAddToList([buyer.leadId])}
            onOpenCompany={onOpenCompany}
          />
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <h2 id="buyer-sidebar-title" className="text-base font-semibold text-[#111827]">Could not load this buyer</h2>
            <p className="text-sm text-[#6b7280]">{error}</p>
            <button type="button" onClick={onClose} className="btn btn-secondary">Close</button>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-3 p-6" aria-busy="true">
            <h2 id="buyer-sidebar-title" className="flex items-center gap-2 text-sm text-[#6b7280]">
              <Loader2 size={15} className="animate-spin" aria-hidden /> Loading buyer…
            </h2>
            <div className="skeleton h-10 w-2/3 rounded-md" />
            <div className="skeleton h-28 rounded-xl" />
            <div className="skeleton h-40 rounded-xl" />
            <div className="skeleton h-24 rounded-xl" />
          </div>
        )}
      </section>
    </div>
  );
}
