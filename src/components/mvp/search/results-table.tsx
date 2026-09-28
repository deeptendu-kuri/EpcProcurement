"use client";

import { AlertTriangle } from "lucide-react";
import type { BuyerRow } from "@/mvp/buyers/types";
import { SampleBadge } from "../badges";
import { HOW_SURE_LABELS, HOW_SURE_STYLES, ROLE_STYLES, TENDER_STYLE, avatarColour, countryName, initials, isTenderLabel, roleText } from "./buyer-labels";

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
}

/**
 * Buyers table (docs/mvp/14 §10): Buyer · Buyer role · Why they buy now · What we can sell them
 * (+ competitor note) · Location · Buyer fit + how sure · Contacts. A click opens the sidebar.
 */
export function ResultsTable({ rows, selected, openId, onToggle, onOpen, selectable = true }: ResultsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse text-[13.5px]" aria-label="Buyers">
        <thead>
          <tr className="bg-[#fcfcfd] text-left text-xs uppercase tracking-[.03em] text-[#6b7280]">
            {selectable ? <th scope="col" className="w-[34px] border border-[var(--line)] px-2.5 py-2.5 font-medium"><span className="sr-only">Select</span></th> : null}
            <th scope="col" className="w-[18%] border border-[var(--line)] px-2.5 py-2.5 font-medium">Buyer</th>
            <th scope="col" className="w-[15%] border border-[var(--line)] px-2.5 py-2.5 font-medium">Buyer role</th>
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
            const label = roleText(row.role, row.roleLabel);
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
                      {row.subRoleLabel ? <div className="text-xs text-[var(--muted)]">{row.subRoleLabel}</div> : null}
                      {row.isSample ? <div className="mt-1"><SampleBadge /></div> : null}
                    </div>
                  </div>
                </td>
                <td className="border border-[var(--line)] px-2.5 py-[11px]">
                  <RolePill role={row.role} label={label} />
                </td>
                <td className="border border-[var(--line)] px-2.5 py-[11px] text-[#1f2937]">{row.buyingReason || <span className="text-[#9ca3af]">Not known yet</span>}</td>
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
