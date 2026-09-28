"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { BuyerView } from "@/mvp/buyers/types";
import { getBuyer } from "./buyer-api";
import { ChainCard, ExampleTag, ProofCard, ReachCard, SellCard, TeamCard, WhyYouCard, WindowCard } from "./buyer-sections";
import { countryName, windowText } from "./buyer-labels";
import { fullRoleLabel } from "./buyer-sidebar";
import { AddToListDialog } from "./lead-lists";

function Question({ n, title, children, href }: { n: number; title: string; children: React.ReactNode; href?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-[var(--line)] bg-white px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.06em] text-[#6b7280]">
        <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] text-[var(--accent)]">{n}</span>
        {href ? <a href={href} className="hover:underline">{title}</a> : title}
      </p>
      <div className="text-sm text-[#1f2937]">{children}</div>
    </div>
  );
}

/** The five questions every buyer answers (docs/mvp/14 §1), from a loaded BuyerView. */
export function FiveQuestionsView({ buyer, onAddToList }: { buyer: BuyerView; onAddToList?: () => void }) {
  const sell = buyer.sellItems.filter((item) => item.fit !== "competitor");
  const now = buyer.window.find((step) => step.state === "now") ?? buyer.window.find((step) => step.state === "next") ?? null;
  const decisionMaker = buyer.team.find((slot) => slot.role === "decision_maker");
  return (
    <section aria-label="Buyer summary" className="flex flex-col gap-3" data-tour="lead-why">
      {buyer.headline ? (
        <p className="rounded-xl border border-[#bbf7d0] bg-gradient-to-b from-[#f0fdf4] to-white px-4 py-3 text-[15px] leading-relaxed text-[#064e3b]">{buyer.headline}</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Question n={1} title="Who is buying">
          <b>{buyer.name}</b>
          <span className="block text-[var(--muted)]">
            {fullRoleLabel(buyer)} · {countryName(buyer.country)}
          </span>
        </Question>
        <Question n={2} title="Why now">
          {buyer.buyingReason || <span className="text-[#9ca3af]">Not known yet</span>}
        </Question>
        <Question n={3} title="What they’ll buy from you" href="#what-they-buy">
          {sell.length ? sell.slice(0, 3).map((item) => item.name).join(", ") : <span className="text-[#9ca3af]">No catalogue match yet</span>}
          {buyer.competitorFor.length ? <span className="block text-xs text-[#b91c1c]">Competitor for {buyer.competitorFor.length} {buyer.competitorFor.length === 1 ? "item" : "items"} (hidden)</span> : null}
        </Question>
        <Question n={4} title="Why you">
          {buyer.whyYou.length ? buyer.whyYou.slice(0, 2).map((item) => item.text).join(" · ") : <span className="text-[#9ca3af]">Not confirmed yet</span>}
          {buyer.whyYou.some((item) => item.isExample) ? <span className="mt-1 block"><ExampleTag /></span> : null}
        </Question>
        <Question n={5} title="Who to talk to, and when" href="#buying-team">
          {decisionMaker?.person ? decisionMaker.person.name : decisionMaker ? decisionMaker.title : "Buying team"}
          <span className="block text-[var(--muted)]">
            {buyer.found} of {buyer.total} found{now ? ` · ${now.label}${windowText(now.from, now.to) ? ` (${windowText(now.from, now.to)})` : ""}` : ""}
          </span>
        </Question>
      </div>
      {onAddToList ? (
        <div>
          <button type="button" onClick={onAddToList} className="btn btn-secondary btn-sm">
            <Plus size={14} aria-hidden /> Add to list
          </button>
        </div>
      ) : null}
      <div className="grid items-start gap-x-4 lg:grid-cols-2">
        <div id="what-they-buy">
          <SellCard buyer={buyer} />
          <WhyYouCard buyer={buyer} />
          <WindowCard buyer={buyer} />
          <ReachCard buyer={buyer} />
        </div>
        <div>
          <TeamCard buyer={buyer} />
          <ChainCard buyer={buyer} />
          <ProofCard buyer={buyer} />
        </div>
      </div>
    </section>
  );
}

/** Loads the buyer view for the full page; shows nothing if the buyer service is not available. */
export function FiveQuestions({ leadId }: { leadId: string }) {
  const [buyer, setBuyer] = useState<BuyerView | null>(null);
  const [failed, setFailed] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getBuyer(leadId, controller.signal)
      .then(setBuyer)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [leadId]);

  if (failed) return null;
  if (!buyer) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-live="polite">
        <span className="sr-only">Loading buyer summary…</span>
        <div className="skeleton h-14 rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="skeleton h-24 rounded-xl" />)}
        </div>
      </div>
    );
  }
  return (
    <>
      <FiveQuestionsView buyer={buyer} onAddToList={() => setListOpen(true)} />
      {listOpen ? <AddToListDialog leadIds={[buyer.leadId]} onClose={() => setListOpen(false)} /> : null}
    </>
  );
}
