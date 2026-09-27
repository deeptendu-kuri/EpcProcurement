"use client";

import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import type { LeadRow } from "@/mvp/types";
import { ConfidenceChip, SampleBadge, ScoreBadge } from "./badges";
import { CLASS_LABELS, KIND_LABELS } from "./labels";
import { LeadSectionNav } from "./lead-section-nav";

export interface LeadHeaderProps {
  lead: LeadRow;
  buyerName: string;
  projectName: string | null;
  productLabel: string | null;
  /** Draft email from the header on small screens (the right rail holds it on desktop). */
  onDraftEmail: () => void;
  /** Why Draft email is turned off (same rule as the right rail), or null when it is allowed. */
  draftBlocked: string | null;
}

/** Sticky lead header (docs/mvp/13 §6): company · project, score / 100, confidence, type · product, Sample data. */
export function LeadHeader({ lead, buyerName, projectName, productLabel, onDraftEmail, draftBlocked }: LeadHeaderProps) {
  return (
    <header className="sticky top-14 z-20 -mx-4 -mt-5 border-b border-[var(--line)] bg-white/95 px-4 pb-3 pt-3 backdrop-blur lg:-mx-6 lg:px-6">
      <Link href="/leads" className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-3)] hover:text-[var(--foreground)]">
        <ArrowLeft size={13} aria-hidden /> Leads
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-snug text-[var(--foreground)] sm:text-xl">
            {buyerName}
            {projectName ? <span className="font-semibold text-[var(--text-3)]"> · {projectName}</span> : null}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--text-2)]">
            <span className="font-semibold">
              {KIND_LABELS[lead.kind]}
              {productLabel ? ` · ${productLabel}` : ""}
            </span>
            <span className="chip">{CLASS_LABELS[lead.class]}</span>
            {lead.is_sample ? <SampleBadge /> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ScoreBadge score={lead.score} size="lg" />
          <ConfidenceChip band={lead.confidence_band} />
          {/* Wrapper carries the tooltip: disabled buttons don't show one in every browser. */}
          <span className="lg:hidden" title={draftBlocked ?? undefined}>
            <button
              type="button"
              onClick={onDraftEmail}
              disabled={Boolean(draftBlocked)}
              aria-label={draftBlocked ? `Draft email (turned off: ${draftBlocked})` : undefined}
              className="btn btn-primary btn-sm"
            >
              <Mail size={14} aria-hidden /> Draft email
            </button>
          </span>
        </div>
      </div>
      <div className="mt-2">
        <LeadSectionNav />
      </div>
    </header>
  );
}
