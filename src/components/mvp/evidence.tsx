"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleHelp, ExternalLink, Info, X } from "lucide-react";
import type { Agreement, EvidenceView } from "@/mvp/types";
import { SampleBadge } from "./badges";
import { TIER_LABELS, formatDate } from "./labels";

interface EvidenceContextValue {
  evidence: Record<string, EvidenceView>;
  open: (ids: string[], title?: string) => void;
}

const EvidenceContext = createContext<EvidenceContextValue>({ evidence: {}, open: () => undefined });

const AGREEMENT_TEXT: Record<Agreement, string> = {
  both: "Confirmed by two AI readers",
  single: "Found by one AI reader",
  rule: "Found by exact text rules",
};

/** Provides the lead's evidence map and the side panel that ⓘ buttons open. */
export function EvidenceProvider({ evidence, children }: { evidence: Record<string, EvidenceView>; children: React.ReactNode }) {
  const [state, setState] = useState<{ ids: string[]; title?: string } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const open = useCallback((ids: string[], title?: string) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setState({ ids, title });
  }, []);
  const close = useCallback(() => {
    setState(null);
    returnFocus.current?.focus?.();
  }, []);
  const value = useMemo(() => ({ evidence, open }), [evidence, open]);

  return (
    <EvidenceContext.Provider value={value}>
      {children}
      {state ? (
        <EvidencePanel items={state.ids.map((id) => evidence[id]).filter(Boolean)} title={state.title} onClose={close} />
      ) : null}
    </EvidenceContext.Provider>
  );
}

export function useEvidence() {
  return useContext(EvidenceContext);
}

/**
 * The ⓘ proof button. Renders nothing when none of the ids resolve to stored evidence,
 * so a fact without proof never shows a dead link.
 */
export function EvidenceButton({ ids, label = "Show source" }: { ids: (string | null | undefined)[] | undefined; label?: string }) {
  const { evidence, open } = useEvidence();
  const known = [...new Set((ids ?? []).filter((id): id is string => Boolean(id && evidence[id])))];
  if (!known.length) return null;
  return (
    <button
      type="button"
      onClick={() => open(known, label)}
      aria-label={`${label} (${known.length} ${known.length === 1 ? "source" : "sources"})`}
      title="Show the quote and the page it came from"
      className="focus-ring ml-1 inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full px-1 align-middle text-[#2563eb] hover:bg-[#eef4ff]"
    >
      <Info size={14} aria-hidden />
      {known.length > 1 ? <span className="text-[11px] font-bold tabular-nums">{known.length}</span> : null}
    </button>
  );
}

/** Split a sentence around the quote (first case-insensitive match). Exported for tests. */
export function splitAroundQuote(sentence: string, quote: string): [string, string, string] | null {
  const at = sentence.toLowerCase().indexOf(quote.trim().toLowerCase());
  if (at < 0) return null;
  const end = at + quote.trim().length;
  return [sentence.slice(0, at), sentence.slice(at, end), sentence.slice(end)];
}

/** The full sentence from the source with the quoted part highlighted (the quote alone when no sentence is stored). */
function QuoteInSentence({ quote, sentence }: { quote: string; sentence?: string | null }) {
  const parts = sentence && sentence.trim().length > quote.trim().length ? splitAroundQuote(sentence, quote) : null;
  const mark = (text: string) => <mark className="rounded bg-[#fef0c7] px-0.5 text-[#101828]">{text}</mark>;
  return (
    <blockquote className="text-sm leading-6 text-[#101828]">
      “{parts ? (
        <>
          <span className="text-[#475467]">{parts[0]}</span>
          {mark(parts[1])}
          <span className="text-[#475467]">{parts[2]}</span>
        </>
      ) : (
        mark(quote)
      )}”
    </blockquote>
  );
}

/** Side panel with the highlighted quote, source name, tier, date, verified flag and link (09 §4.3). */
export function EvidencePanel({ items, title, onClose }: { items: EvidenceView[]; title?: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <button type="button" aria-label="Close sources" className="absolute inset-0 bg-[#101828]/20" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        className="relative flex h-full w-full max-w-[440px] flex-col overflow-y-auto bg-white shadow-2xl outline-none"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-[#e1e6ef] bg-white px-4 py-3">
          <h2 id="evidence-title" className="text-base font-bold text-[#101828]">{title && title !== "Show source" ? title : "Proof"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-[#475467] hover:bg-[#f2f4f7]">
            <X size={18} />
          </button>
        </div>
        <ul className="flex flex-col gap-4 p-4">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-[#e1e6ef] p-3">
              <QuoteInSentence quote={item.quote} sentence={item.sentence} />
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="font-semibold text-[#667085]">Source</dt>
                <dd className="text-[#344054]">{item.sourceName ?? item.publisher_key}{item.documentTitle ? ` · ${item.documentTitle}` : ""}</dd>
                <dt className="font-semibold text-[#667085]">Type</dt>
                <dd className="text-[#344054]">{TIER_LABELS[item.tier] ?? item.tier}</dd>
                <dt className="font-semibold text-[#667085]">Date</dt>
                <dd className="text-[#344054]">{formatDate(item.publishedAt ?? item.observed_at) || "Not found"}</dd>
                <dt className="font-semibold text-[#667085]">Checked</dt>
                <dd>
                  {item.quote_verified ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-[#067647]">
                      <CheckCircle2 size={13} aria-hidden /> Quote found on the page
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-semibold text-[#667085]">
                      <CircleHelp size={13} aria-hidden /> Not verified
                    </span>
                  )}
                  {item.agreement ? <span className="block text-[#667085]">{AGREEMENT_TEXT[item.agreement]}</span> : null}
                </dd>
              </dl>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                {item.isSample ? <SampleBadge /> : <span />}
                {/^https?:\/\//i.test(item.url) ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[#1d4ed8] hover:underline"
                  >
                    Open page <ExternalLink size={13} aria-hidden />
                  </a>
                ) : null}
              </div>
            </li>
          ))}
          {!items.length ? <li className="text-sm text-[#667085]">No source stored for this fact.</li> : null}
        </ul>
      </div>
    </div>
  );
}
