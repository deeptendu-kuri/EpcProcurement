"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Trash2, X } from "lucide-react";
import type { ChainNode, SupplyChain } from "@/mvp/buyers/types";
import { LINK_LABELS, LINK_LEGEND, LINK_ORDER, LINK_STYLES, LINK_SWATCH } from "../search/buyer-labels";

export interface SupplyChainTreeProps {
  chain: SupplyChain;
  /** Short name of the tier-1 buyer, for "Tier 2 · supplies KPIL". */
  rootShortName: string;
  /** Tier-2 node ids whose tier-3 suppliers are shown. */
  expanded: ReadonlySet<string>;
  /** Node whose "Find candidates" popover is open (controlled, so the contacts table can open it). */
  candidatesFor: string | null;
  onCandidatesFor: (nodeId: string | null) => void;
  /** Node ids being loaded (expanding) or saved (set / remove company). */
  busy?: ReadonlySet<string>;
  onToggleExpand: (node: ChainNode) => void;
  onSetCompany: (node: ChainNode, body: { name: string; companyId?: string }) => Promise<void> | void;
  onRemoveCompany: (node: ChainNode) => Promise<void> | void;
}

export function LinkChip({ link, why }: { link: ChainNode["link"]; why?: string }) {
  return (
    <span className={`ml-auto shrink-0 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold ${LINK_STYLES[link]}`} title={why || undefined} data-testid="link-chip">
      {LINK_LABELS[link]}
    </span>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#475569]" aria-label="How we know">
      {LINK_ORDER.map((link) => (
        <li key={link} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: LINK_SWATCH[link] }} />
          {LINK_LEGEND[link]}
        </li>
      ))}
    </ul>
  );
}

function TierHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-3.5 text-[11px] font-bold uppercase tracking-[.07em] text-[#64748b]">{children}</h3>;
}

/** Popover: candidates with why, a "Set company" input, and remove for a wrong company (15 §B). */
function CandidatesPopover({ node, busy, onClose, onSetCompany, onRemoveCompany }: {
  node: ChainNode;
  busy: boolean;
  onClose: () => void;
  onSetCompany: SupplyChainTreeProps["onSetCompany"];
  onRemoveCompany: SupplyChainTreeProps["onRemoveCompany"];
}) {
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputId = `set-company-${node.nodeId}`;

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} role="dialog" aria-label={`Candidates for ${node.whatTheyDo || node.name}`} className="pop-in absolute left-0 top-[calc(100%+6px)] z-30 w-[min(22rem,80vw)] rounded-xl border border-[var(--line)] bg-white p-3 text-left shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-[.06em] text-[#6b7280]">{node.whatTheyDo || node.name}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-icon ml-auto -mr-1 text-[#94a3b8]">
          <X size={14} />
        </button>
      </div>
      {node.candidates.length ? (
        <ul className="mb-2 flex flex-col gap-1" aria-label="Candidates">
          {node.candidates.map((candidate) => (
            <li key={candidate.companyId} className="flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-[var(--subtle)]">
              <span className="min-w-0 flex-1">
                <b className="text-[13px] text-[#111827]">{candidate.name}</b>
                <span className="block text-xs text-[var(--muted)]">{candidate.why}</span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSetCompany(node, { name: candidate.name, companyId: candidate.companyId })}
                className="shrink-0 whitespace-nowrap text-[12.5px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-50"
              >
                Use this
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-[12.5px] text-[#6b7280]">No company in our directory makes this nearby yet. Add the one you know.</p>
      )}
      <form
        className="flex gap-1.5 border-t border-[var(--line)] pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed) void onSetCompany(node, { name: trimmed });
        }}
      >
        <label htmlFor={inputId} className="sr-only">Set company</label>
        <input id={inputId} value={name} onChange={(event) => setName(event.target.value)} placeholder="Company name" maxLength={200} className="input h-8 min-w-0 flex-1 text-sm" />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null} Set company
        </button>
      </form>
      {node.companyId ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRemoveCompany(node)}
          className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#b42318] hover:underline disabled:opacity-50"
        >
          <Trash2 size={12} aria-hidden /> Remove {node.name} — wrong company
        </button>
      ) : null}
    </div>
  );
}

/** Card-sized product list (mockup: "pipe, valves, bends"): the head of each name, max 5, rest counted. */
function shortList(names: string[], max = 5): { shown: string[]; more: number } {
  const heads: string[] = [];
  for (const name of names) {
    const head = name.split(/\s*[(,]/)[0].trim() || name;
    if (!heads.some((other) => other.toLowerCase() === head.toLowerCase())) heads.push(head);
  }
  return { shown: heads.slice(0, max), more: Math.max(0, heads.length - max) };
}

function NodeCard({ node, isRoot, props }: { node: ChainNode; isRoot: boolean; props: SupplyChainTreeProps }) {
  const identified = node.link !== "not_identified" && Boolean(node.companyId || node.leadId || node.derivedKey);
  const busy = props.busy?.has(node.nodeId) ?? false;
  const isOpen = props.candidatesFor === node.nodeId;
  const buys = node.wouldBuy.map((item) => item.name);
  const shortBuys = shortList(buys);
  const whatLine = [node.whatTheyDo && node.whatTheyDo !== node.name ? node.whatTheyDo : null, node.supplies ? `supplies ${node.supplies}` : null].filter(Boolean).join(" · ");
  const hasChildren = props.chain.nodes.some((other) => other.parentNodeId === node.nodeId);
  const canExpand = !isRoot && node.tier === 2 && (node.expandable || hasChildren);
  const isExpanded = props.expanded.has(node.nodeId);
  const pickLabel = node.link === "not_identified" ? "Find candidates" : node.link === "possible" ? "Candidates" : "Change";

  return (
    <article
      data-testid="chain-node"
      data-node-id={node.nodeId}
      data-tier={node.tier}
      aria-label={`${node.name}, ${LINK_LABELS[node.link]}`}
      className={`relative rounded-xl px-3 py-2.5 ${isRoot ? "border-2 border-[#2563eb] bg-[#f5f8ff]" : "border border-[var(--line)] bg-white"}`}
    >
      <div className="flex items-center gap-2">
        <b className={`min-w-0 text-sm ${identified || isRoot ? "text-[#111827]" : "text-[#374151]"}`}>{node.name}</b>
        <LinkChip link={node.link} why={node.linkWhy} />
      </div>
      {whatLine ? <p className="text-xs text-[#6b7280]">{whatLine}</p> : null}
      <p className="mt-1.5 text-[12.5px] text-[#1f2937]">
        {identified || isRoot ? "Buys from you: " : "Would buy: "}
        <span className="font-semibold text-[#047857]" title={buys.length > shortBuys.shown.length ? buys.join(" · ") : undefined}>
          {buys.length ? shortBuys.shown.join(", ") : "— (not in your catalogue)"}
        </span>
        {shortBuys.more ? <span className="text-[#6b7280]"> +{shortBuys.more} more</span> : null}
      </p>
      {node.competitorFor.length ? <p className="mt-0.5 text-[11.5px] text-[#b91c1c]">✕ Competitor for {node.competitorFor.join(", ")}</p> : null}
      {!isRoot && node.link !== "not_identified" && node.linkWhy ? (
        <p className="mt-0.5 text-[11.5px] text-[#64748b]" title={node.evidenceIds.length ? `Evidence: ${node.evidenceIds.join(", ")}` : undefined}>
          {node.linkWhy}
          {node.evidenceIds.length ? ` · ${node.evidenceIds.length} ${node.evidenceIds.length === 1 ? "source" : "sources"}` : ""}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {isRoot ? (
          <span className="text-[var(--accent)]">This buyer</span>
        ) : node.leadId ? (
          <Link href={`/buyers/${encodeURIComponent(node.leadId)}`} className="text-[var(--accent)] hover:underline">
            Open buyer ▸
          </Link>
        ) : identified ? (
          <Link href={`/search?q=${encodeURIComponent(node.name)}`} className="text-[var(--accent)] hover:underline">
            Open buyer ▸
          </Link>
        ) : null}
        {canExpand ? (
          <button type="button" aria-expanded={isExpanded} onClick={() => props.onToggleExpand(node)} className="inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline" disabled={busy}>
            {busy && !isOpen ? <Loader2 size={11} className="animate-spin" aria-hidden /> : null}
            {isExpanded ? "Collapse" : "Expand"} {isExpanded ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
          </button>
        ) : null}
        {!isRoot ? (
          <span className="relative">
            <button type="button" aria-expanded={isOpen} aria-haspopup="dialog" onClick={() => props.onCandidatesFor(isOpen ? null : node.nodeId)} className="text-[var(--accent)] hover:underline">
              {pickLabel} ▸
            </button>
            {isOpen ? (
              <CandidatesPopover node={node} busy={busy} onClose={() => props.onCandidatesFor(null)} onSetCompany={props.onSetCompany} onRemoveCompany={props.onRemoveCompany} />
            ) : null}
          </span>
        ) : null}
        <span className="ml-auto text-[#475569]">
          {identified || isRoot ? `${node.found} of ${node.total}` : `— of ${node.total}`}
          {isRoot ? " contacts" : ""}
        </span>
      </div>
    </article>
  );
}

/**
 * The supply chain from one deal (docs/mvp/15 §B, mockup buyer-chain): tier 1 won the work, tier 2 its
 * supplier types, tier 3 on "Expand". Each card: company or type, link status, what they would buy,
 * competitor note, contacts, Open buyer / Find candidates.
 */
export function SupplyChainTree(props: SupplyChainTreeProps) {
  const { chain, rootShortName, expanded } = props;
  const root = chain.nodes.find((node) => node.tier === 1) ?? null;
  const tier2 = chain.nodes.filter((node) => node.tier === 2);
  const shownTier3 = tier2.filter((node) => expanded.has(node.nodeId));

  return (
    <div data-testid="supply-chain-tree">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-base font-bold text-[#111827]">Supply chain from this deal — every company here can buy from you</h2>
        <div className="ml-auto"><Legend /></div>
      </div>

      <TierHeading>Tier 1 · won the work</TierHeading>
      {root ? (
        <div className="max-w-[420px]"><NodeCard node={root} isRoot props={props} /></div>
      ) : null}

      {tier2.length ? (
        <>
          <p className="my-1 flex justify-center text-xs text-[#94a3b8]">▼ buys materials and services from</p>
          <TierHeading>Tier 2 · supplies {rootShortName} (also buyers for you)</TierHeading>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {tier2.map((node) => <NodeCard key={node.nodeId} node={node} isRoot={false} props={props} />)}
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-[#9ca3af]">We don’t know what this kind of company buys from others yet.</p>
      )}

      {shownTier3.map((parent) => {
        const children = chain.nodes.filter((node) => node.tier === 3 && node.parentNodeId === parent.nodeId);
        return (
          <section key={parent.nodeId} aria-label={`${parent.name} buys from`} className="mt-3">
            <p className="ml-[18px] text-xs text-[#94a3b8]">▼ {parent.name} buys from (expanded)</p>
            <div className="ml-6 border-l-2 border-dashed border-[#cbd5e1] pl-3.5">
              <TierHeading>Tier 3 · supplies {parent.name}</TierHeading>
              {children.length ? (
                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                  {children.map((node) => <NodeCard key={node.nodeId} node={node} isRoot={false} props={props} />)}
                </div>
              ) : (
                <p className="text-sm text-[#9ca3af]">{props.busy?.has(parent.nodeId) ? "Loading…" : "No supplier types known for this one."}</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
