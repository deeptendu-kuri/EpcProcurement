"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Link2, Loader2, Mail, Phone, Sparkles } from "lucide-react";
import type { ChainContactRow, ChainTier } from "@/mvp/buyers/types";
import { SLOT_ROLE_LABELS, SLOT_STATUS_LABELS, SLOT_STATUS_STYLES } from "../search/buyer-labels";

/** "Find" with one link, or a small menu of search links (LinkedIn, Google …). */
export function FindMenu({ links, label = "Find" }: { links: { label: string; url: string }[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!links.length) return null;
  if (links.length === 1) {
    return (
      <a href={links[0].url} target="_blank" rel="noreferrer" title={links[0].label} className="whitespace-nowrap text-[12.5px] text-[var(--accent)] hover:underline">
        {label}
      </a>
    );
  }
  return (
    <span ref={ref} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="whitespace-nowrap text-[12.5px] text-[var(--accent)] hover:underline">
        {label}
      </button>
      {open ? (
        <span className="pop-in absolute left-0 top-[calc(100%+4px)] z-20 flex w-52 flex-col rounded-lg border border-[var(--line)] bg-white p-1 shadow-lg">
          {links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-[#374151] hover:bg-[var(--subtle)]">
              {link.label} <ExternalLink size={12} aria-hidden />
            </a>
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function SlotRoleTag({ role }: { role: ChainContactRow["role"] }) {
  const style = role === "decision_maker" ? "bg-[#dbeafe] text-[#1d4ed8]" : "bg-[#f1f5f9] text-[#475569]";
  return <span className={`whitespace-nowrap rounded-md px-[7px] py-0.5 text-[11px] ${style}`}>{SLOT_ROLE_LABELS[role]}</span>;
}

export function StatusChip({ status }: { status: keyof typeof SLOT_STATUS_LABELS }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold ${SLOT_STATUS_STYLES[status]}`}>{SLOT_STATUS_LABELS[status]}</span>;
}

/** Email / phone / LinkedIn of a person, as small links. */
export function ContactPoints({ email, phone, linkedinUrl }: { email?: string | null; phone?: string | null; linkedinUrl?: string | null }) {
  if (!email && !phone && !linkedinUrl) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-[#475569]">
      {email ? <span className="inline-flex items-center gap-1"><Mail size={11} aria-hidden />{email}</span> : null}
      {phone ? <span className="inline-flex items-center gap-1"><Phone size={11} aria-hidden />{phone}</span> : null}
      {linkedinUrl ? (
        <a href={linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
          <Link2 size={11} aria-hidden />LinkedIn
        </a>
      ) : null}
    </span>
  );
}

type TierFilter = "all" | ChainTier;

export interface ChainContactsTableProps {
  rows: ChainContactRow[];
  companyOnly?: boolean;
  initialCompanyNode?: string;
  loading?: boolean;
  /** Row keys being confirmed. */
  busy?: ReadonlySet<string>;
  onAdd: (row: ChainContactRow) => void;
  onConfirm: (row: ChainContactRow) => void;
  onFindCandidates: (row: ChainContactRow) => void;
  onEmail?: (row: ChainContactRow) => void;
  demoEmail?: boolean;
}

export function rowKey(row: Pick<ChainContactRow, "nodeId" | "slotId">): string {
  return `${row.nodeId}|${row.slotId}`;
}

/**
 * All contacts in this supply chain (docs/mvp/15 §E): every node × buying-team slot across the tiers.
 * Tier · Company · Person / role · Why them · Status · Action (Find · + Add / Confirm / Find candidates).
 */
export function ChainContactsTable({ rows, companyOnly = false, initialCompanyNode, loading = false, busy, onAdd, onConfirm, onFindCandidates, onEmail, demoEmail }: ChainContactsTableProps) {
  const [tier, setTier] = useState<TierFilter>("all");
  const [companyNode, setCompanyNode] = useState(initialCompanyNode ?? "all");
  const [deciders, setDeciders] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);

  const found = rows.filter((row) => row.person).length;
  const shown = rows.filter(
    (row) => (companyNode === "all" || row.nodeId === companyNode) && (tier === "all" || row.tier === tier) && (!deciders || row.role === "decision_maker") && (!missingOnly || !row.person),
  );
  const pill = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs ${on ? "border-[#111827] bg-[#111827] text-white" : "border-[var(--line)] bg-white text-[#334155] hover:bg-[var(--subtle)]"}`;

  return (
    <div data-testid="chain-contacts">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-bold text-[#111827]">{companyOnly ? "Company contact roles & details" : "All contacts in this supply chain"}</h2>
        <span className="text-xs text-[var(--muted)]" aria-live="polite">
          {rows.length} contact role slots · {found} found
        </span>
        <div role="group" aria-label="Filter contacts" className="ml-auto flex flex-wrap items-center gap-1.5">
          {!companyOnly ? <label className="text-xs text-[var(--text-2)]">Company<select className="input ml-1 max-w-52 px-2 text-xs" aria-label="Contact company" value={companyNode} onChange={e=>setCompanyNode(e.target.value)}><option value="all">All companies</option>{[...new Map(rows.map(row=>[row.nodeId,row])).values()].map(row=><option key={row.nodeId} value={row.nodeId}>{row.companyName}{row.companyIdentified ? "" : " (not identified)"}</option>)}</select></label> : null}
          {!companyOnly ? (["all", 1, 2, 3] as const).map((value) => (
            <button key={value} type="button" aria-pressed={tier === value} onClick={() => setTier(value)} className={pill(tier === value)}>
              {value === "all" ? "All tiers" : `Tier ${value}`}
            </button>
          )) : null}
          <button type="button" aria-pressed={deciders} onClick={() => setDeciders((value) => !value)} className={pill(deciders)}>
            Decision makers
          </button>
          <button
            type="button"
            aria-pressed={missingOnly}
            onClick={() => setMissingOnly((value) => !value)}
            title="Show only the people still to find"
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:brightness-105"
          >
            <Sparkles size={13} aria-hidden /> {missingOnly ? "Show everyone" : "Find contacts"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13.5px]" aria-label={companyOnly ? "Company contact roles & details" : "All contacts in this supply chain"}>
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-[.03em] text-[#6b7280]">
              <th scope="col" className="w-12 px-2.5 py-2.5 font-medium">Tier</th>
              <th scope="col" className="px-2.5 py-2.5 font-medium">Company</th>
              <th scope="col" className="px-2.5 py-2.5 font-medium">Person / role</th>
              <th scope="col" className="px-2.5 py-2.5 font-medium">Why them</th>
              <th scope="col" className="px-2.5 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-2.5 py-2.5 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const key = rowKey(row);
              const saving = busy?.has(key) ?? false;
              return (
                <tr key={key} className="border-b border-[var(--line)] align-top last:border-0" data-testid="chain-contact-row">
                  <td className="px-2.5 py-2.5 tabular-nums">{row.tier}</td>
                  <td className="px-2.5 py-2.5">
                    <b className="text-[#111827]">{row.companyName}</b>
                    {!row.companyIdentified ? <span className="text-xs text-[var(--muted)]"> (not identified)</span> : null}
                  </td>
                  <td className="px-2.5 py-2.5">
                    {row.person ? (
                      <>
                        {onEmail ? <button type="button" onClick={() => onEmail(row)} disabled={saving} className="text-left font-semibold text-[var(--accent)] hover:underline">{row.person.name}</button> : <span className="font-semibold text-[#111827]">{row.person.name}</span>}
                        <span className="text-[#374151]"> · {row.person.title || row.title}</span> <SlotRoleTag role={row.role} />
                        <ContactPoints email={row.person.email} phone={row.person.phone} linkedinUrl={row.person.linkedinUrl} />
                      </>
                    ) : (
                      <>
                        <span className="text-[#111827]">{row.title}</span> <SlotRoleTag role={row.role} />
                      </>
                    )}
                  </td>
                  <td className="px-2.5 py-2.5 text-xs text-[var(--muted)]">{row.why}</td>
                  <td className="px-2.5 py-2.5"><StatusChip status={row.status} /></td>
                  <td className="px-2.5 py-2.5">
                    {onEmail && row.companyIdentified && (row.person || demoEmail) ? (
                      <button type="button" disabled={saving} onClick={() => onEmail(row)} aria-label={`Email ${row.person?.name || "demo contact"} at ${row.companyName}`} className="mb-1 mr-2 inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-[var(--accent)] hover:underline disabled:opacity-50">
                        <Mail size={12} aria-hidden /> {row.person ? "Email" : "Demo email"}
                      </button>
                    ) : null}
                    {!row.companyIdentified || row.status === "company_first" ? (
                      <button type="button" onClick={() => onFindCandidates(row)} className="whitespace-nowrap text-[12.5px] text-[var(--accent)] hover:underline">
                        Find candidates
                      </button>
                    ) : row.person ? (
                      row.status === "confirmed" ? (
                        <span className="text-xs text-[#166534]">Confirmed ✓</span>
                      ) : (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => onConfirm(row)}
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[var(--line)] bg-white px-2 py-1 text-xs font-semibold text-[#111827] hover:bg-[var(--subtle)] disabled:opacity-60"
                        >
                          {saving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
                          {row.role === "decision_maker" ? "Confirm decision maker" : "Confirm"}
                        </button>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px]">
                        <FindMenu links={row.findLinks} />
                        {row.findLinks.length ? <span aria-hidden className="text-[#94a3b8]">·</span> : null}
                        <button type="button" onClick={() => onAdd(row)} className="text-[var(--accent)] hover:underline" aria-label={`Add contact: ${row.title} at ${row.companyName}`}>
                          + Add
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && !rows.length ? (
          <div className="flex flex-col gap-2 pt-2" role="status">
            <span className="sr-only">Loading contacts…</span>
            {Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton h-9 rounded-md" />)}
          </div>
        ) : !shown.length ? (
          <p className="px-2.5 py-4 text-sm text-[#9ca3af]">{rows.length ? "No one matches these filters." : "No buying-team slots for this supply chain yet."}</p>
        ) : null}
      </div>
    </div>
  );
}
