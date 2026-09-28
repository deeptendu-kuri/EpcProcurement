"use client";

import { ArrowRight } from "lucide-react";
import type { ContactRow } from "@/mvp/buyers/types";
import { SLOT_ROLE_LABELS, SLOT_STATUS_LABELS, countryName, initials } from "./buyer-labels";
import { RolePill } from "./results-table";

const STATUS_STYLES: Record<ContactRow["status"], string> = {
  not_found: "bg-[#f1f5f9] text-[#475569]",
  likely: "bg-[#fef3c7] text-[#92400e]",
  confirmed: "bg-[#dcfce7] text-[#166534]",
};

/**
 * Contacts view of SuperSearch (docs/mvp/14 §8): one row per buying-team slot of each buyer —
 * the person when a verified source names them, otherwise "Not found" with Find links.
 */
export function ContactsTable({ rows, onOpenBuyer }: { rows: ContactRow[]; onOpenBuyer: (leadId: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-[13.5px]" aria-label="Contacts">
        <thead>
          <tr className="bg-[#fcfcfd] text-left text-xs uppercase tracking-[.03em] text-[#6b7280]">
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Person</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Buying role</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Buyer</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Buyer role</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Location</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium">Status</th>
            <th scope="col" className="border border-[var(--line)] px-2.5 py-2.5 font-medium"><span className="sr-only">Find</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.leadId}-${row.slotId}`} className="align-top hover:bg-[#fafbfc]">
              <td className="border border-[var(--line)] px-2.5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e2e8f0] text-[11px] text-[#475569]">
                    {row.person ? initials(row.person.name) : "?"}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-[#111827]">{row.person ? row.person.name : row.slotTitle}</p>
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
                <RolePill role={row.role} label={row.roleLabel} />
              </td>
              <td className="border border-[var(--line)] px-2.5 py-2.5">{countryName(row.country)}</td>
              <td className="border border-[var(--line)] px-2.5 py-2.5">
                <span className={`whitespace-nowrap rounded-md px-[7px] py-0.5 text-[11px] font-semibold ${STATUS_STYLES[row.status]}`}>{SLOT_STATUS_LABELS[row.status]}</span>
              </td>
              <td className="border border-[var(--line)] px-2.5 py-2.5">
                {row.status === "not_found" && row.findLinks.length ? (
                  <div className="flex flex-col gap-0.5">
                    {row.findLinks.slice(0, 3).map((link) => (
                      <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 whitespace-nowrap text-[12.5px] text-[var(--accent)] hover:underline">
                        {link.label} <ArrowRight size={11} aria-hidden />
                      </a>
                    ))}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
