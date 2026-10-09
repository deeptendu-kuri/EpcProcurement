"use client";

import { AlertTriangle, Loader2, Save } from "lucide-react";
import { isDerivedLeadId, type BuyerRow, type ChainTier } from "@/mvp/buyers/types";
import { SampleBadge } from "../badges";
import { triggerKindLabel } from "@/mvp/buyers/types";
import { HOW_SURE_LABELS, HOW_SURE_STYLES, LINK_LABELS, LINK_STYLES, ROLE_STYLES, TENDER_STYLE, TIER_STYLES, avatarColour, countryName, initials, isTenderLabel, roleText, whatTheyDoText } from "./buyer-labels";

/** A derived row: a tier 2/3 company with no stored lead yet (docs/mvp/15 §D). */
export function isDerivedRow(row: { derivedKey?: string | null; leadId: string; storedLeadId?: string | null }): boolean {
  return Boolean(row.derivedKey) && (row.storedLeadId === null || isDerivedLeadId(row.leadId));
}

/** "Pipeline builder" (+ " · open tender"), never "EPC" / "owner". */
export function rowRoleText(row: Pick<BuyerRow, "whatTheyDo" | "subRoleLabel" | "role" | "roleLabel">): string {
  const plain = whatTheyDoText(row);
  return roleText(row.role, plain, isTenderLabel(row.roleLabel ?? ""));
}

export function TierBadge({ tier }: { tier: ChainTier }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-1.5 py-px text-[11px] font-semibold ${TIER_STYLES[tier]}`} title={tier === 1 ? "Tier 1 · won the work" : `Tier ${tier} · in the supply chain of a deal`}>
      Tier {tier}
    </span>
  );
}

export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "h-11 w-11 rounded-[10px] text-sm" : "h-7 w-7 rounded-[7px] text-[11px]";
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center font-bold text-white ${box}`} style={{ background: avatarColour(name) }}>
      {initials(name)}
    </span>
  );
}

export function RolePill({ role, label, prefix }: { role: BuyerRow["role"]; label: string; prefix?: string }) {
  const style = isTenderLabel(label) ? TENDER_STYLE : ROLE_STYLES[role];
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-[9px] py-0.5 text-xs font-semibold ${style}`}>
      {prefix ? `${prefix} · ` : ""}
      {label}
    </span>
  );
}

export interface ResultsTableProps {
  rows: BuyerRow[];
  selected: Set<string>;
  openId: string;
  onToggle: (leadId: string) => void;
  onOpen: (leadId: string) => void;
  /** Show the select checkboxes (default on). */
  selectable?: boolean;
  /** "Save as buyer" on a derived row (creates a lead). */
  onSaveDerived?: (row: BuyerRow) => void;
  /** Derived keys being saved. */
  saving?: ReadonlySet<string>;
}

/**
 * Buyers table (docs/mvp/14 §10): Buyer · Buyer role · Why they buy now · What we can sell them
 * (+ competitor note) · Location · Buyer fit + how sure · Contacts. A click opens the sidebar.
 */
export function ResultsTable({ rows, selected, openId, onToggle, onOpen, selectable = true, onSaveDerived, saving }: ResultsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse text-[13.5px]" aria-label="Buyers">
        <thead>
          <tr className="bg-[#fcfcfd] text-left text-xs uppercase tracking-[.03em] text-[#6b7280]">
            {selectable ? <th scope="col" className="w-[34px] border border-[var(--line)] px-2.5 py-2.5 font-medium"><span className="sr-only">Select</span></th> : null}
            <th scope="col" className="w-[18%] border border-[var(--line)] px-2.5 py-2.5 font-medium">Buyer</th>
            <th scope="col" className="w-[14%] border border-[var(--line)] px-2.5 py-2.5 font-medium">What they do</th>
            <th scope="col" className="w-[9%] border border-[var(--line)] px-2.5 py-2.5 font-medium" title="Supply-chain tier: 1 won the work, 2 supplies them, 3 supplies tier 2">Tier</th>
            <th scope="col" className="w-[22%] border border-[var(--line)] px-2.5 py-2.5 font-medium">Why they buy now</th>
            <th scope="col" className="w-[21%] border border-[var(--line)] px-2.5 py-2.5 font-medium">What we can sell them</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Location</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium" title="Buyer fit (0–100) and how sure we are">Buyer fit</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Contacts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isSelected = selected.has(row.leadId);
            const isOpen = openId === row.leadId;
            const label = rowRoleText(row);
            const derived = isDerivedRow(row);
            const tier: ChainTier = row.tier ?? 1;
            const moreDeals = Math.max(0, (row.dealsCount ?? 1) - 1);
            return (
              <tr
                key={row.leadId}
                data-lead-id={row.leadId}
                data-tour={index === 0 ? "search-first-row" : undefined}
                onClick={() => onOpen(row.leadId)}
                aria-selected={isOpen}
                className={`cursor-pointer align-top ${isSelected || isOpen ? "bg-[#f5f8ff]" : "hover:bg-[#fafbfc]"}`}
              >
                {selectable ? <td className="border border-[var(--line)] px-2.5 py-[11px]" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={derived}
                    title={derived ? "Save as buyer first" : undefined}
                    onChange={() => onToggle(row.leadId)}
                    aria-label={`Select ${row.name}`}
                    className="mt-0.5 h-3.5 w-3.5 accent-[#111827]"
                  />
                </td> : null}
                <td className="border border-[var(--line)] px-2.5 py-[11px]">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={row.name} />
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(row.leadId);
                        }}
                        className="text-left font-semibold text-[#111827] hover:underline"
                      >
                        {row.name}
                      </button>
                      {row.isSample ? <div className="mt-1"><SampleBadge /></div> : null}
                      {derived && onSaveDerived && row.derivedKey ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSaveDerived(row);
                          }}
                          disabled={saving?.has(row.derivedKey)}
                          className="mt-1 inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-white px-1.5 py-0.5 text-[11.5px] font-semibold text-[#111827] hover:bg-[var(--subtle)] disabled:opacity-60"
                        >
                          {saving?.has(row.derivedKey) ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <Save size={11} aria-hidden />} Save as buyer
                        </button>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="border border-[var(--line)] px-2.5 py-[11px]">
                  <RolePill role={row.role} label={label} />{row.trigger?<span className="mt-2 block text-xs font-semibold text-[var(--accent-2)]">{triggerKindLabel(row.trigger.kind)}{row.trigger.date?` · ${row.trigger.date}`:''}</span>:null}
                </td>
                <td className="border border-[var(--line)] px-2.5 py-[11px]" data-testid="tier-cell">
                  <TierBadge tier={tier} />
                  {tier > 1 && row.link ? (
                    <span className={`ml-1 inline-block whitespace-nowrap rounded-full px-1.5 py-px text-[10.5px] font-semibold ${LINK_STYLES[row.link]}`}>{LINK_LABELS[row.link]}</span>
                  ) : null}
                  {tier > 1 && row.foundVia ? (
                    <div className="mt-1 text-[11.5px] text-[var(--muted)]">
                      Found via{" "}
                      <a href={`/buyers/${encodeURIComponent(row.foundVia.leadId)}`} onClick={(event) => event.stopPropagation()} className="text-[var(--accent)] hover:underline">
                        {row.foundVia.name}
                      </a>
                    </div>
                  ) : null}
                </td>
                <td className="border border-[var(--line)] px-2.5 py-[11px] text-[#1f2937]">
                  {row.buyingReason || <span className="text-[#9ca3af]">{tier > 1 ? "In the supply chain of this deal" : "Not known yet"}</span>}
                  {moreDeals ? <div className="mt-0.5 text-[11.5px] font-semibold text-[#475569]">+{moreDeals} more {moreDeals === 1 ? "deal" : "deals"}</div> : null}
                </td>
                <td className="border border-[var(--line)] px-2.5 py-[11px] text-[#1f2937]">
                  {row.sellSummary || <span className="text-[#9ca3af]">Nothing matched yet</span>}
                  {row.competitorNote ? (
                    <div className="mt-0.5 flex items-start gap-1 text-[11.5px] text-[#b91c1c]">
                      <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden />
                      {row.competitorNote}
                    </div>
                  ) : null}
                </td>
                <td className="border border-[var(--line)] px-2.5 py-[11px]">{countryName(row.country)}</td>
                <td className="border border-[var(--line)] px-2.5 py-[11px]">
                  <span className="font-bold tabular-nums">{row.fitScore}</span>
                  <div className={`text-[11.5px] ${HOW_SURE_STYLES[row.howSure]}`} title="How sure we are">{HOW_SURE_LABELS[row.howSure]}</div>
                </td>
                <td className="border border-[var(--line)] px-2.5 py-[11px] text-[12.5px]">
                  <b className="text-[#111827]">{row.found}</b> of {row.total} found
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
