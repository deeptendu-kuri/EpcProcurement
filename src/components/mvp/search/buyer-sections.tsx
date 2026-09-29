"use client";

import { useState } from "react";
import { ArrowRight, Check, ExternalLink, Home, Info, X } from "lucide-react";
import type { BuyerView, ContactSlot, ProofItem } from "@/mvp/buyers/types";
import { formatDate } from "../labels";
import {
  FIT_LABELS,
  FIT_STYLES,
  REACH_LABELS,
  SLOT_ROLE_LABELS,
  countryName,
  initials,
  windowText,
} from "./buyer-labels";

/** A sidebar card with an uppercase title (mockup `.card`). */
export function BuyerCard({ title, aside, tone = "plain", children, id }: {
  title: string;
  aside?: React.ReactNode;
  tone?: "plain" | "hero";
  children: React.ReactNode;
  id?: string;
}) {
  const box = tone === "hero" ? "border-[#bbf7d0] bg-gradient-to-b from-[#f0fdf4] to-white" : "border-[var(--line)] bg-white";
  return (
    <section id={id} className={`mb-3 rounded-xl border px-4 py-3.5 ${box}`} aria-label={title}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[.06em] text-[#6b7280]">
        {title}
        {aside ? <span className="font-normal normal-case tracking-normal text-[#94a3b8]"> · {aside}</span> : null}
      </h3>
      {children}
    </section>
  );
}

export function ExampleTag({ text = "Example — replace with your own" }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[#fedf89] bg-[#fffaeb] px-1.5 py-px text-[11px] font-semibold text-[#b54708]" title="Set by an example profile. Replace it with your own in Settings.">
      {text}
    </span>
  );
}

export function WhyNowCard({ buyer }: { buyer: BuyerView }) {
  return (
    <BuyerCard title="Why they will buy now" tone="hero">
      <p className="m-0 text-[15px] leading-relaxed text-[#064e3b]">
        {buyer.buyingReason ? <b className="font-semibold">{buyer.buyingReason}</b> : "We have not found a clear buying reason yet."}
      </p>
      {buyer.triggerDate ? <p className="mt-1.5 text-xs text-[#047857]">Since {formatDate(buyer.triggerDate)}</p> : null}
    </BuyerCard>
  );
}

export function SellCard({ buyer }: { buyer: BuyerView }) {
  const order = { good: 0, possible: 1, competitor: 2 } as const;
  const items = [...buyer.sellItems].sort((a, b) => order[a.fit] - order[b.fit]);
  return (
    <BuyerCard title="What we can sell them" aside="from your catalogue">
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.itemId} className="flex items-start justify-between gap-3 border-b border-dashed border-[var(--line)] py-[7px] last:border-0">
              <span className="min-w-0">
                <span className="text-[#111827]">{item.name}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {item.fit === "competitor" ? "Hidden from outreach" : item.why}
                  {item.fit !== "competitor" && item.window ? ` · ${item.window}` : ""}
                </span>
              </span>
              <span className={`flex shrink-0 items-center gap-1 text-[13.5px] font-semibold ${FIT_STYLES[item.fit]}`}>
                {item.fit === "competitor" ? <X size={14} aria-hidden /> : <span aria-hidden>●</span>}
                {FIT_LABELS[item.fit]}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#9ca3af]">No catalogue item matched this buyer yet.</p>
      )}
    </BuyerCard>
  );
}

export function WhyYouCard({ buyer }: { buyer: BuyerView }) {
  const example = buyer.whyYou.some((item) => item.isExample);
  return (
    <BuyerCard title="Why you" aside="their benefit">
      {buyer.whyYou.length ? (
        <>
          <ul className="flex flex-col gap-2">
            {buyer.whyYou.slice(0, 3).map((item) => (
              <li key={item.strengthId} className="flex items-start gap-2 text-sm">
                <Check size={15} className="mt-0.5 shrink-0 text-[#16a34a]" aria-hidden />
                <span>
                  <span className="font-semibold text-[#111827]">{item.text}</span>
                  <span className="block text-xs text-[var(--muted)]">{item.reason}</span>
                </span>
              </li>
            ))}
          </ul>
          {example ? <div className="mt-2"><ExampleTag text="Example strengths — replace with your own in Settings" /></div> : null}
        </>
      ) : (
        <p className="text-sm text-[#9ca3af]">None of your strengths is confirmed by the facts yet.</p>
      )}
    </BuyerCard>
  );
}

export function WindowCard({ buyer }: { buyer: BuyerView }) {
  if (!buyer.window.length) {
    return (
      <BuyerCard title="When they buy">
        <p className="text-sm text-[#9ca3af]">The buying window is not known yet.</p>
      </BuyerCard>
    );
  }
  return (
    <BuyerCard title="When they buy">
      <ol className="mt-1 flex items-start">
        {buyer.window.map((step, index) => {
          const dot =
            step.state === "done"
              ? "bg-[#16a34a] shadow-[0_0_0_4px_#dcfce7]"
              : step.state === "now"
                ? "bg-[#2563eb] shadow-[0_0_0_4px_#dbeafe]"
                : "bg-[#cbd5e1]";
          return (
            <li key={`${step.label}-${index}`} className="relative flex flex-1 flex-col items-center px-1 text-center text-xs text-[#1f2937]">
              {index > 0 ? <span aria-hidden className="absolute right-1/2 top-[5px] h-0.5 w-full bg-[#e2e8f0]" /> : null}
              <span aria-hidden className={`relative z-10 mb-1.5 h-3 w-3 rounded-full ${dot}`} />
              <span className={step.state === "now" ? "font-semibold" : ""}>
                {step.label}
                {step.state === "now" ? <span className="sr-only"> (now)</span> : null}
              </span>
              <span className="text-[var(--muted)]">{windowText(step.from, step.to)}</span>
            </li>
          );
        })}
      </ol>
    </BuyerCard>
  );
}

function FindLinks({ slot }: { slot: ContactSlot }) {
  const [open, setOpen] = useState(false);
  if (!slot.findLinks.length) return null;
  const label = slot.role === "vendor_registration" ? "Find page" : "Find";
  if (slot.findLinks.length === 1) {
    return (
      <a href={slot.findLinks[0].url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 whitespace-nowrap text-[12.5px] text-[var(--accent)] hover:underline" title={slot.findLinks[0].label}>
        {label} <ArrowRight size={12} aria-hidden />
      </a>
    );
  }
  return (
    <span className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-0.5 whitespace-nowrap text-[12.5px] text-[var(--accent)] hover:underline">
        {label} <ArrowRight size={12} aria-hidden />
      </button>
      {open ? (
        <span className="pop-in absolute right-0 top-[calc(100%+4px)] z-20 flex w-52 flex-col rounded-lg border border-[var(--line)] bg-white p-1 shadow-lg">
          {slot.findLinks.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-[#374151] hover:bg-[var(--subtle)]" onClick={() => setOpen(false)}>
              {link.label}
              <ExternalLink size={12} aria-hidden />
            </a>
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function SlotRow({ slot }: { slot: ContactSlot }) {
  const person = slot.person;
  const roleLabel = SLOT_ROLE_LABELS[slot.role];
  const tag =
    slot.status === "likely"
      ? { text: `${roleLabel} · likely`, style: "bg-[#fef3c7] text-[#92400e]" }
      : slot.status === "confirmed"
        ? { text: `${roleLabel} · confirmed`, style: "bg-[#dcfce7] text-[#166534]" }
        : slot.role === "decision_maker"
          ? { text: roleLabel, style: "bg-[#dbeafe] text-[#1d4ed8]" }
          : slot.role === "vendor_registration"
            ? null
            : { text: roleLabel, style: "bg-[#f1f5f9] text-[#475569]" };
  return (
    <li className="flex items-center gap-2.5 border-b border-[#f1f5f9] py-[9px] last:border-0" data-testid="contact-slot">
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e2e8f0] text-xs text-[#475569]">
        {person ? initials(person.name) : slot.role === "vendor_registration" ? <Home size={13} /> : "?"}
      </span>
      <div className="min-w-0 flex-1">
        {person ? (
          <p className="text-sm">
            <b className="text-[#111827]">{person.name}</b>
            {person.title ? <span className="text-[#374151]"> · {person.title}</span> : null}
          </p>
        ) : (
          <p className="text-sm font-bold text-[#111827]">{slot.title}</p>
        )}
        <p className="text-xs text-[var(--muted)]">
          {person ? (
            <>
              {person.evidenceIds.length ? (
                <span className="inline-flex items-center gap-0.5">Named in a source <Info size={11} aria-hidden /> · </span>
              ) : null}
              {slot.description}
            </>
          ) : (
            <>
              {slot.description}
              <span className="sr-only"> — not found yet</span>
            </>
          )}
        </p>
      </div>
      {tag ? <span className={`whitespace-nowrap rounded-md px-[7px] py-0.5 text-[11px] ${tag.style}`}>{tag.text}</span> : null}
      {!person || slot.status === "not_found" ? <FindLinks slot={slot} /> : null}
    </li>
  );
}

export function TeamCard({ buyer }: { buyer: BuyerView }) {
  return (
    <BuyerCard title={`Buying team at ${buyer.shortName || buyer.name}`} aside={`${buyer.found} of ${buyer.total} found`} id="buying-team">
      {buyer.team.length ? (
        <ul>
          {buyer.team.map((slot) => (
            <SlotRow key={slot.slotId} slot={slot} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#9ca3af]">No buying team slots for this role yet.</p>
      )}
    </BuyerCard>
  );
}

export function ReachCard({ buyer }: { buyer: BuyerView }) {
  const tone =
    buyer.reach.email === "allowed" ? "text-[#047857]" : buyer.reach.email === "opt_out_only" ? "text-[#1d4ed8]" : buyer.reach.email === "consent_needed" ? "text-[#b45309]" : "text-[#b91c1c]";
  return (
    <BuyerCard title={`How to reach them — ${countryName(buyer.reach.country ?? buyer.country)}`}>
      <p className={`mb-1 text-xs font-semibold ${tone}`}>{REACH_LABELS[buyer.reach.email]}</p>
      <p className="text-[13px] text-[#374151]">{buyer.reach.summary}</p>
    </BuyerCard>
  );
}

/** The sentence with its key phrase in bold (highlight must appear in the sentence). */
export function Highlighted({ sentence, highlight }: { sentence: string; highlight: string }) {
  const at = highlight ? sentence.toLowerCase().indexOf(highlight.toLowerCase()) : -1;
  if (at < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, at)}
      <b>{sentence.slice(at, at + highlight.length)}</b>
      {sentence.slice(at + highlight.length)}
    </>
  );
}

export function ProofList({ proof }: { proof: ProofItem[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {proof.map((item) => (
        <li key={item.evidenceId}>
          <blockquote className="my-1.5 rounded-md border-l-[3px] border-[#f59e0b] bg-[#fffbeb] px-2.5 py-2 text-[13px] text-[#1f2937]">
            “<Highlighted sentence={item.sentence} highlight={item.highlight} />”
          </blockquote>
          <p className="text-xs text-[var(--muted)]">
            {item.source}
            {item.date ? ` · ${formatDate(item.date)}` : ""}
            {item.verified ? " · quote checked ✓" : " · quote not checked yet"}
            {item.url ? (
              <>
                {" · "}
                <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[12.5px] text-[var(--accent)] hover:underline">
                  Open article <ExternalLink size={11} aria-hidden />
                </a>
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ProofCard({ buyer }: { buyer: BuyerView }) {
  const sources = new Set(buyer.proof.map((item) => item.source)).size;
  return (
    <BuyerCard title={`Proof (${sources} ${sources === 1 ? "source" : "sources"})`}>
      {buyer.proof.length ? <ProofList proof={buyer.proof} /> : <p className="text-sm text-[#9ca3af]">No quotes stored for this buyer.</p>}
    </BuyerCard>
  );
}
