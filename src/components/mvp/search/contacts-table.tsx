"use client";

import { Loader2 } from "lucide-react";
import type { ContactRow } from "@/mvp/buyers/types";
import { FindMenu, StatusChip } from "../buyers/chain-contacts-table";
import { SLOT_ROLE_LABELS, countryName, initials, roleText } from "./buyer-labels";
import { RolePill } from "./results-table";

export function contactKey(row: Pick<ContactRow, "leadId" | "slotId">): string {
  return `${row.leadId}|${row.slotId}`;
}

export interface ContactsTableProps {
  rows: ContactRow[];
  onOpenBuyer: (leadId: string) => void;
  /** "+ Add" on a slot with nobody found. */
  onAdd?: (row: ContactRow) => void;
  /** "Confirm" on a likely person. */
  onConfirm?: (row: ContactRow) => void;
  /** Row keys being confirmed. */
  busy?: ReadonlySet<string>;
  onEmail?: (row: ContactRow) => void;
  demoEmail?: boolean;
}

/**
 * Contacts view of SuperSearch (docs/mvp/14 §8, 15 §E): one row per buying-team slot of each buyer —
 * the person when we have one, otherwise "Not found" with Find · + Add.
 */
export function ContactsTable({ rows, onOpenBuyer, onAdd, onConfirm, busy, onEmail, demoEmail }: ContactsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-[13.5px]" aria-label="Contacts">
        <thead>
          <tr className="bg-[#fcfcfd] text-left text-xs uppercase tracking-[.03em] text-[#6b7280]">
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Person</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Buying role</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Buyer</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">What they do</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Location</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Status</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = contactKey(row);
            const saving = busy?.has(key) ?? false;
            return (
              <tr key={key} className="align-top hover:bg-[#fafbfc]" data-testid="contact-row">
                <td className="border border-[var(--line)] px-2.5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e2e8f0] text-[11px] text-[#475569]">
                      {row.person ? initials(row.person.name) : "?"}
                    </span>
                    <div className="min-w-0">
                      {row.person && onEmail ? <button type="button" disabled={saving} onClick={() => onEmail(row)} className="text-left font-semibold text-[var(--accent)] hover:underline">{row.person.name}</button> : <p className="font-semibold text-[#111827]">{row.person ? row.person.name : row.slotTitle}</p>}
                      <p className="text-xs text-[var(--muted)]">{row.person ? (row.person.title ?? row.slotTitle) : "Not found yet"}</p>
                    </div>
                  </div>
                </td>
                <td className="border border-[var(--line)] px-2.5 py-2.5">{SLOT_ROLE_LABELS[row.slotRole]}</td>
                <td className="border border-[var(--line)] px-2.5 py-2.5">
                  <button type="button" onClick={() => onOpenBuyer(row.leadId)} className="text-left font-semibold text-[#111827] hover:underline">
                    {row.company}
                  </button>
                </td>
                <td className="border border-[var(--line)] px-2.5 py-2.5">
                  <RolePill role={row.role} label={roleText(row.role, (row as ContactRow & { whatTheyDo?: string }).whatTheyDo || row.roleLabel)} />
                </td>
                <td className="border border-[var(--line)] px-2.5 py-2.5">{countryName(row.country)}</td>
                <td className="border border-[var(--line)] px-2.5 py-2.5">
                  <StatusChip status={row.status} />
                </td>
                <td className="border border-[var(--line)] px-2.5 py-2.5">
                  {row.person ? (
                    row.status === "confirmed" ? (
                      <span className="text-xs text-[#166534]">Confirmed ✓</span>
                    ) : onConfirm ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => onConfirm(row)}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[var(--line)] bg-white px-2 py-1 text-xs font-semibold text-[#111827] hover:bg-[var(--subtle)] disabled:opacity-60"
                      >
                        {saving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
                        {row.slotRole === "decision_maker" ? "Confirm decision maker" : "Confirm"}
                      </button>
                    ) : null
                  ) : (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px]">
                      <FindMenu links={row.findLinks} />
                      {onAdd ? (
                        <>
                          {row.findLinks.length ? <span aria-hidden className="text-[#94a3b8]">·</span> : null}
                          <button type="button" onClick={() => onAdd(row)} className="text-[var(--accent)] hover:underline" aria-label={`Add contact: ${row.slotTitle} at ${row.company}`}>
                            + Add
                          </button>
                        </>
                      ) : null}
                    </span>
                  )}
                  {onEmail && (row.person || demoEmail) ? <button type="button" disabled={saving} onClick={() => onEmail(row)} aria-label={`Email ${row.person?.name || "demo contact"} at ${row.company}`} className="ml-2 text-xs font-semibold text-[var(--accent)] hover:underline">{row.person ? "Email" : "Demo email"}</button> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
