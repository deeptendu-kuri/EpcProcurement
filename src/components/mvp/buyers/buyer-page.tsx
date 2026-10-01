"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Check, Mail, Plus } from "lucide-react";
import type { BuyerDeal, BuyerView } from "@/mvp/buyers/types";
import type { LeadDetail, LeadStatus, OutreachRule } from "@/mvp/types";
import { ActivitySection } from "../activity-section";
import { SampleBadge } from "../badges";
import { DraftPanel, type DraftContact } from "../draft-panel";
import { BUYING_ROLE_LABELS, formatDate } from "../labels";
import { ComplianceSection, RejectedBanner } from "../lead-sections";
import { draftBlockedReason } from "../lead-rail";
import { useLeadActions } from "../leads/use-lead-actions";
import { Section } from "../section";
import { ExampleTag, ProofList } from "../search/buyer-sections";
import { BUYER_STAGE_LABELS, HOW_SURE_LABELS, HOW_SURE_STYLES, REACH_LABELS, STAGE_STYLES, countryName, whatTheyDoText, windowText } from "../search/buyer-labels";
import { AddToListDialog } from "../search/lead-lists";
import { Avatar } from "../search/results-table";
import { SupplyChainExplorer } from "./supply-chain-explorer";
import { DEMO_CONTACT_EMAIL, type DemoEmailInfo } from "@/mvp/email/config";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 2026" (or "" for a missing / bad date). Fixed names: ICU may print "Sept". */
export function monthYear(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? "" : `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "USD 480M" / "USD 1.2B". */
export function usdText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "";
  if (value >= 1e9) return `USD ${(value / 1e9).toFixed(value >= 1e10 ? 0 : 1).replace(/\.0$/, "")}B`;
  if (value >= 1e6) return `USD ${(value / 1e6).toFixed(value >= 1e8 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (value >= 1e3) return `USD ${Math.round(value / 1e3)}K`;
  return `USD ${Math.round(value)}`;
}

/** The deal as one context line: "won a gas pipeline contract worth INR 40B (Sep 2026)" (15 §A.2). */
export function dealLine(buyer: Pick<BuyerView, "buyingReason" | "triggerDate">): string {
  const reason = buyer.buyingReason?.trim();
  if (!reason) return "";
  const text = reason.charAt(0).toLowerCase() + reason.slice(1);
  const when = monthYear(buyer.triggerDate);
  return when && !text.includes(when) ? `${text} (${when})` : text;
}

/** "Buyer · Pipeline builder · India". */
export function buyerSubtitle(buyer: Pick<BuyerView, "whatTheyDo" | "subRoleLabel" | "role" | "country">): string {
  return ["Buyer", whatTheyDoText(buyer), countryName(buyer.country)].join(" · ");
}

function SummaryBox({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="min-w-0 rounded-xl border border-[var(--line)] bg-white px-3.5 py-3">
      <h2 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[.06em] text-[#6b7280]">{title}</h2>
      <div className="text-[13.5px] text-[#111827]">{children}</div>
    </section>
  );
}

/** When: items grouped by their buying window, or the window steps when items carry none. */
function WhenText({ buyer }: { buyer: BuyerView }) {
  const groups = new Map<string, string[]>();
  for (const item of buyer.sellItems) {
    if (item.fit === "competitor" || !item.window) continue;
    groups.set(item.window, [...(groups.get(item.window) ?? []), item.name]);
  }
  if (groups.size) {
    return (
      <ul className="flex flex-col gap-0.5">
        {[...groups].slice(0, 4).map(([window, names]) => (
          <li key={window}>
            <b>{window}:</b> {names.join(", ")}
          </li>
        ))}
      </ul>
    );
  }
  const steps = buyer.window.filter((step) => step.state !== "done");
  if (!steps.length) return <span className="text-[#9ca3af]">The buying window is not known yet.</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {steps.slice(0, 3).map((step, index) => (
        <li key={`${step.label}-${index}`}>
          <b>{step.state === "now" ? "Now" : windowText(step.from, step.to) || "Next"}:</b> {step.label}
          {step.state === "now" && windowText(step.from, step.to) ? ` (${windowText(step.from, step.to)})` : ""}
        </li>
      ))}
    </ul>
  );
}

export function BuyerSummary({ buyer }: { buyer: BuyerView }) {
  const sell = buyer.sellItems.filter((item) => item.fit !== "competitor");
  const example = buyer.whyYou.some((item) => item.isExample);
  return (
    <div className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr]" data-tour="lead-why">
      <SummaryBox title="What they’ll buy from you">
        {sell.length ? sell.map((item) => item.name).join(" · ") : <span className="text-[#9ca3af]">No catalogue match yet.</span>}
        {buyer.competitorFor.length ? <p className="mt-1 text-xs text-[#b91c1c]">✕ Competitor for {buyer.competitorFor.join(", ")} (hidden from outreach)</p> : null}
      </SummaryBox>
      <SummaryBox title="When">
        <WhenText buyer={buyer} />
      </SummaryBox>
      <SummaryBox title="Why you">
        {buyer.whyYou.length ? buyer.whyYou.slice(0, 3).map((item) => item.text).join(" · ") : <span className="text-[#9ca3af]">None of your strengths is confirmed yet.</span>}
        {example ? <div className="mt-1.5"><ExampleTag text="Example strengths" /></div> : null}
      </SummaryBox>
    </div>
  );
}

export function DealsList({ deals, currentLeadId }: { deals: BuyerDeal[]; currentLeadId: string }) {
  if (deals.length <= 1) return null;
  return (
    <section aria-label="Deals" className="rounded-[14px] border border-[var(--line)] bg-white px-[18px] py-3.5">
      <h2 className="mb-1 text-base font-bold text-[#111827]">
        Deals <span className="text-xs font-normal text-[var(--muted)]">· {deals.length} for this company</span>
      </h2>
      <ul className="divide-y divide-[var(--line)]">
        {deals.map((deal) => (
          <li key={deal.leadId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-[13.5px]">
            <span className="min-w-0 flex-1 text-[#111827]">
              {deal.title}
              {deal.leadId === currentLeadId ? <span className="ml-2 rounded-md bg-[#eef2ff] px-1.5 py-px text-[11px] font-semibold text-[#3730a3]">Shown above</span> : null}
            </span>
            <span className="text-xs text-[var(--muted)]">
              {[deal.date ? formatDate(deal.date) : null, usdText(deal.valueUsd) || null, `${deal.sourceCount} ${deal.sourceCount === 1 ? "source" : "sources"}`].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface BuyerPageViewProps {
  buyer: BuyerView;
  detail: LeadDetail;
  companyOutreach: OutreachRule | null;
  demoEmail?: DemoEmailInfo;
  contactEmails?: Record<string, string>;
  composeOnLoad?: boolean;
  initialContactKey?: string;
}

/**
 * The buyer-first page (docs/mvp/15 §A, mockup buyer-chain): header, three summary boxes, deals, the
 * supply chain with every contact across it, then Can you sell to them? · How to reach them · Proof · Activity.
 * No project, stage or owner sections.
 */
export function BuyerPageView({ buyer, detail, companyOutreach, demoEmail, contactEmails, composeOnLoad, initialContactKey }: BuyerPageViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const actions = useLeadActions();
  const [draftOpen, setDraftOpen] = useState(Boolean(composeOnLoad));
  const [listOpen, setListOpen] = useState(false);
  const { lead } = detail;
  const status = actions.statusOf(lead.id, lead.status as LeadStatus);
  const good = status !== "new" && status !== "rejected";

  const outreach = new Map(detail.compliance.outreach.map((item) => [item.personId, item]));
  const contacts: DraftContact[] = [
    ...detail.people.filter(person => person.current_company_id === buyer.companyId).map((person) => ({
      id: person.id,
      name: person.full_name,
      detail: [person.title, person.roles[0] ? BUYING_ROLE_LABELS[person.roles[0].buying_role] : null].filter(Boolean).join(" · "),
      country: outreach.get(person.id)?.country ?? person.country,
      rule: outreach.get(person.id)?.rule ?? null,
      email: contactEmails?.[person.id],
      companyName: buyer.name,
    })),
    ...(demoEmail?.enabled ? [{ id: null, name: "Demo procurement contact", detail: "Demo contact — not scraped", country: buyer.country, rule: null, email: DEMO_CONTACT_EMAIL, companyName: buyer.name, isDemo: true }] : []),
    { id: null, name: `${buyer.name} (company address)`, country: buyer.country, rule: companyOutreach },
  ];
  const draftBlocked = demoEmail?.enabled ? null : draftBlockedReason(contacts);
  const eligibilitySub = detail.breakdown.criteria.flatMap((criterion) => criterion.subs ?? []).find((sub) => sub.id === "4.1");
  const deal = dealLine(buyer);
  const sources = new Set(buyer.proof.map((item) => item.source)).size;
  const reachTone =
    buyer.reach.email === "allowed" ? "text-[#047857]" : buyer.reach.email === "opt_out_only" ? "text-[#1d4ed8]" : buyer.reach.email === "consent_needed" ? "text-[#b45309]" : "text-[#b91c1c]";

  return (
    <div className="flex flex-col gap-4 pb-10">
      <header>
        <Link href="/search" className="inline-flex items-center gap-1 text-[12.5px] text-[#64748b] hover:text-[#111827]">
          <ArrowLeft size={13} aria-hidden /> SuperSearch
        </Link>
        <div className="mt-1.5 flex flex-wrap items-start gap-3.5">
          <Avatar name={buyer.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-bold leading-tight text-[#111827]">{buyer.name}</h1>
            <p className="mt-0.5 text-sm text-[#475569]">
              {buyerSubtitle(buyer)}
              {deal ? <span> &nbsp;·&nbsp; {deal}</span> : null}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-[7px] py-0.5 text-[11px] font-semibold ${STAGE_STYLES[buyer.stage]}`}>{BUYER_STAGE_LABELS[buyer.stage]}</span>
              {buyer.isSample ? <SampleBadge /> : null}
              <button
                type="button"
                onClick={() => void actions.accept(lead.id, status, buyer.name)}
                disabled={good || actions.isBusy(lead.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-[#16a34a] bg-[#16a34a] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#15803d] disabled:opacity-60"
              >
                <Check size={13} aria-hidden /> {good ? "Marked good lead" : "Good lead"}
              </button>
              <button type="button" onClick={() => setListOpen(true)} className="btn btn-secondary btn-sm">
                <Plus size={13} aria-hidden /> Add to list
              </button>
              <span title={draftBlocked ?? undefined}>
                <button type="button" onClick={() => setDraftOpen(true)} disabled={Boolean(draftBlocked)} className="btn btn-secondary btn-sm">
                  <Mail size={13} aria-hidden /> Draft email
                </button>
              </span>
            </div>
          </div>
          <div className="text-right" title="Buyer fit (0–100) and how sure we are">
            <span className="text-[26px] font-bold tabular-nums text-[#111827]">{buyer.fitScore}</span>
            <span className="text-[#6b7280]">/100 buyer fit</span>
            <p className={`text-xs ${HOW_SURE_STYLES[buyer.howSure]}`}>{HOW_SURE_LABELS[buyer.howSure]} — how sure we are</p>
          </div>
        </div>
      </header>

      <RejectedBanner gates={detail.gates} leadClass={lead.class} status={lead.status} rejectReason={lead.reject_reason} />
      <BuyerSummary buyer={buyer} />
      <DealsList deals={buyer.deals ?? []} currentLeadId={buyer.leadId} />
      <SupplyChainExplorer leadId={buyer.leadId} rootShortName={buyer.shortName || buyer.name} demoEmail={demoEmail} />

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <ComplianceSection items={detail.compliance.bid} eligibility={eligibilitySub ? { points: eligibilitySub.points, max: eligibilitySub.max } : null} />
          <Section id="reach" title="How to reach them" aside={countryName(buyer.reach.country ?? buyer.country)}>
            <p className={`mb-1 text-xs font-semibold ${reachTone}`}>{REACH_LABELS[buyer.reach.email]}</p>
            <p className="text-[13px] text-[#374151]">{buyer.reach.summary}</p>
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Section id="proof" title="Proof" aside={`${sources} ${sources === 1 ? "source" : "sources"}`}>
            {buyer.proof.length ? <ProofList proof={buyer.proof} /> : <p className="text-sm text-[#9ca3af]">No quotes stored for this buyer.</p>}
          </Section>
          <ActivitySection leadId={lead.id} activities={detail.activities} people={detail.people} />
        </div>
      </div>

      {draftOpen ? <DraftPanel leadId={lead.id} contacts={contacts} demoEmail={demoEmail} autoGenerate initialContactKey={initialContactKey} onClose={() => setDraftOpen(false)} onSent={() => startTransition(() => router.refresh())} /> : null}
      {listOpen ? <AddToListDialog leadIds={[lead.id]} onClose={() => setListOpen(false)} /> : null}
    </div>
  );
}
