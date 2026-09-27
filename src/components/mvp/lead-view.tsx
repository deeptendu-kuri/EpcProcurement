"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import type { LeadDetail, OutreachRule } from "@/mvp/types";
import { ActivitySection } from "./activity-section";
import { DraftPanel, type DraftContact } from "./draft-panel";
import { EvidenceProvider } from "./evidence";
import { LeadHeader } from "./lead-header";
import {
  BuyerHistorySection,
  ComplianceSection,
  PeopleSection,
  ProjectSection,
  RejectedBanner,
  SupplyChainSection,
  WhySection,
} from "./lead-sections";
import { ScoreBreakdown } from "./score-breakdown";
import { Section } from "./section";
import { BUYING_ROLE_LABELS } from "./labels";

export interface LeadViewProps {
  detail: LeadDetail;
  /** Product names for the lead's client_product_ids. */
  productNames: string[];
  /** Outreach rule for the buyer's country, used for a company-level draft. */
  companyOutreach: OutreachRule | null;
}

/** The lead page (09 §4.3, 12 F3/F4). Every fact carries an ⓘ that opens its quote and source. */
export function LeadView({ detail, productNames, companyOutreach }: LeadViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draftOpen, setDraftOpen] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const { lead, buyer, project } = detail;

  const addNote = useCallback(() => {
    const activity = document.getElementById("activity") as HTMLDetailsElement | null;
    if (activity) activity.open = true;
    noteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    noteRef.current?.focus({ preventScroll: true });
  }, []);

  const outreach = new Map(detail.compliance.outreach.map((item) => [item.personId, item]));
  const contacts: DraftContact[] = [
    ...detail.people.map((person) => ({
      id: person.id,
      name: person.full_name,
      detail: [person.title, person.roles[0] ? BUYING_ROLE_LABELS[person.roles[0].buying_role] : null].filter(Boolean).join(" · "),
      country: outreach.get(person.id)?.country ?? person.country,
      rule: outreach.get(person.id)?.rule ?? null,
    })),
    { id: null, name: `${buyer.canonical_name} (company address)`, country: buyer.country, rule: companyOutreach },
  ];

  const eligibilitySub = detail.breakdown.criteria.flatMap((criterion) => criterion.subs ?? []).find((sub) => sub.id === "4.1");

  return (
    <EvidenceProvider evidence={detail.evidence}>
      <div className="flex flex-col gap-3 pb-10">
        <LeadHeader
          lead={lead}
          buyerName={buyer.canonical_name}
          projectName={project?.name ?? null}
          productLabel={productNames.join(", ") || null}
          onDraftEmail={() => setDraftOpen(true)}
          onAddNote={addNote}
        />
        <RejectedBanner gates={detail.gates} leadClass={lead.class} status={lead.status} rejectReason={lead.reject_reason} />
        <WhySection reasons={detail.reasons} signals={detail.signals} />
        <ProjectSection detail={detail} />
        <SupplyChainSection detail={detail} />
        <PeopleSection detail={detail} />
        <BuyerHistorySection insights={detail.buyerInsights} buyerName={buyer.canonical_name} />
        <Section id="score" title="Score breakdown">
          <ScoreBreakdown breakdown={detail.breakdown} score={lead.score} />
        </Section>
        <ComplianceSection
          items={detail.compliance.bid}
          eligibility={eligibilitySub ? { points: eligibilitySub.points, max: eligibilitySub.max } : null}
        />
        <ActivitySection ref={noteRef} leadId={lead.id} activities={detail.activities} people={detail.people} />
      </div>
      {draftOpen ? (
        <DraftPanel
          leadId={lead.id}
          contacts={contacts}
          onClose={() => setDraftOpen(false)}
          onSent={() => startTransition(() => router.refresh())}
        />
      ) : null}
    </EvidenceProvider>
  );
}
