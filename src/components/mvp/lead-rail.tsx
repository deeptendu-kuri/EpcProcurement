"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, Mail, NotebookPen, UserRound } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import { LEAD_STATUSES, REJECT_REASONS, type ChecklistItem, type LeadRow, type LeadStatus, type OutreachPermission, type RejectReason } from "@/mvp/types";
import { patchLead } from "./api-client";
import { emailBlockReason, type DraftContact } from "./draft-panel";
import { PERMISSION_LABELS, REJECT_REASON_LABELS, STATUS_LABELS } from "./labels";
import { useToast } from "./shell/toast";

/** met / missing / unknown counts for the compliance summary (not-applicable items are left out). */
export function complianceCounts(items: Pick<ChecklistItem, "status">[]): { met: number; missing: number; unknown: number } {
  const counts = { met: 0, missing: 0, unknown: 0 };
  for (const item of items) {
    if (item.status === "met" || item.status === "missing" || item.status === "unknown") counts[item.status] += 1;
  }
  return counts;
}

/**
 * Why Draft email is turned off for the whole lead, or null when at least one contact may be emailed.
 * (The draft panel still explains the rule per contact.)
 */
export function draftBlockedReason(contacts: DraftContact[]): string | null {
  if (!contacts.length) return "No contact to write to yet.";
  const reasons = contacts.map((contact) => emailBlockReason(contact));
  if (reasons.some((reason) => reason === null)) return null;
  return reasons[0];
}

const RULE_TONE: Record<OutreachPermission, string> = {
  allowed: "border-[#abefc6] bg-[#ecfdf3] text-[#067647]",
  opt_out_only: "border-[#b2ddff] bg-[#eff8ff] text-[#175cd3]",
  consent_needed: "border-[#fedf89] bg-[#fffaeb] text-[#b54708]",
  blocked: "border-[#fecdca] bg-[#fef3f2] text-[#b42318]",
};

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="eyebrow mb-2">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Right rail of the lead page (docs/mvp/13 §6): status, next step, owner, contacts with contact-rule chips,
 * compliance summary and Draft email (disabled with the reason when consent is needed).
 */
export function LeadRail({
  lead,
  contacts,
  compliance,
  onDraftEmail,
  onAddNote,
}: {
  lead: LeadRow;
  contacts: DraftContact[];
  compliance: ChecklistItem[];
  onDraftEmail: () => void;
  onAddNote: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [pendingReject, setPendingReject] = useState(false);
  const [reason, setReason] = useState<RejectReason>((lead.reject_reason as RejectReason) ?? "not_our_scope");
  const [nextAction, setNextAction] = useState(lead.next_action ?? "");
  const [savedNext, setSavedNext] = useState(lead.next_action ?? "");

  const save = async (body: Parameters<typeof patchLead>[1]): Promise<boolean> => {
    try {
      await patchLead(lead.id, body);
      startTransition(() => router.refresh());
      return true;
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : "Could not save.", tone: "error" });
      return false;
    }
  };

  const setStatusTo = async (to: LeadStatus, rejectReason?: RejectReason) => {
    const previous = status;
    if (previous === to) return;
    setStatus(to);
    const ok = await save(to === "rejected" ? { status: to, rejectReason: rejectReason ?? "other" } : { status: to, rejectReason: null });
    if (!ok) {
      setStatus(previous);
      return;
    }
    toast.show({
      message: to === "rejected" ? "Marked not relevant" : `Status: ${STATUS_LABELS[to]}`,
      action: { label: "Undo", onClick: () => void setStatusTo(previous) },
    });
  };

  const saveNext = async () => {
    const value = nextAction.trim();
    if (value === savedNext) return;
    if (await save({ nextAction: value || null })) {
      setSavedNext(value);
      toast.show({ message: "Next step saved", tone: "success" });
    }
  };

  const counts = complianceCounts(compliance);
  const blocked = draftBlockedReason(contacts);

  return (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-[14rem] lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto" data-tour="lead-rail" aria-label="Buyer actions">
      <RailCard title="Status">
        <label htmlFor="rail-status" className="sr-only">Status</label>
        <select
          id="rail-status"
          value={pendingReject ? "rejected" : status}
          onChange={(event) => {
            const value = event.target.value as LeadStatus;
            if (value === "rejected") setPendingReject(true);
            else {
              setPendingReject(false);
              void setStatusTo(value);
            }
          }}
          className="control w-full px-2 text-sm"
        >
          {LEAD_STATUSES.map((value) => (
            <option key={value} value={value}>{STATUS_LABELS[value]}</option>
          ))}
        </select>
        {pendingReject ? (
          <div className="mt-2 flex flex-col gap-2">
            <label htmlFor="header-reject-reason" className="text-xs font-semibold text-[var(--text-3)]">Reason for rejecting</label>
            <select id="header-reject-reason" autoFocus value={reason} onChange={(event) => setReason(event.target.value as RejectReason)} className="control w-full px-2 text-sm">
              {REJECT_REASONS.map((value) => (
                <option key={value} value={value}>{REJECT_REASON_LABELS[value]}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  setPendingReject(false);
                  void setStatusTo("rejected", reason);
                }}
              >
                Not relevant
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPendingReject(false)}>Cancel</button>
            </div>
          </div>
        ) : null}

        <label htmlFor="rail-next" className="mt-3 block text-xs font-semibold text-[var(--text-3)]">Next step</label>
        <input
          id="rail-next"
          value={nextAction}
          onChange={(event) => setNextAction(event.target.value)}
          onBlur={() => void saveNext()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveNext();
            }
          }}
          maxLength={500}
          placeholder="e.g. Call procurement on Monday"
          className="control mt-1 w-full px-2 text-sm"
        />

        <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-3)]">
          <UserRound size={13} aria-hidden /> Owner: <span className="font-semibold text-[var(--text-2)]">{lead.owner_user_id ? "You" : "Not assigned"}</span>
        </p>
      </RailCard>

      <RailCard title="Draft email">
        <button type="button" onClick={onDraftEmail} disabled={Boolean(blocked)} className="btn btn-primary w-full" aria-describedby={blocked ? "draft-blocked" : undefined}>
          <Mail size={15} aria-hidden /> Draft email
        </button>
        {blocked ? (
          <p id="draft-blocked" className="mt-2 flex items-start gap-1.5 text-xs text-[#b54708]">
            <Ban size={13} className="mt-0.5 shrink-0" aria-hidden /> {blocked}
          </p>
        ) : (
          <p className="mt-2 text-xs text-[var(--text-3)]">A short first email you can edit and copy. Nothing is sent from here.</p>
        )}
        <button type="button" onClick={onAddNote} className="btn btn-secondary btn-sm mt-2 w-full">
          <NotebookPen size={14} aria-hidden /> Add note
        </button>
      </RailCard>

      <RailCard title={`Contacts (${contacts.length})`}>
        <ul className="flex flex-col divide-y divide-[var(--line)]">
          {contacts.map((contact) => (
            <li key={contact.id ?? "company"} className="py-2 first:pt-0 last:pb-0">
              <p className="text-sm font-semibold leading-snug text-[var(--foreground)]">{contact.name}</p>
              {contact.detail ? <p className="text-xs text-[var(--text-3)]">{contact.detail}</p> : null}
              {contact.rule ? (
                <span
                  className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold ${RULE_TONE[contact.rule.email]}`}
                  title={contact.rule.steps.join(" ")}
                >
                  Email {PERMISSION_LABELS[contact.rule.email]}
                  {contact.country ? ` · ${marketName(contact.country)}` : ""}
                </span>
              ) : (
                <span className="mt-1 inline-flex text-[0.6875rem] text-[var(--text-3)]">Contact rules unknown</span>
              )}
            </li>
          ))}
        </ul>
      </RailCard>

      <RailCard title="Can you sell to them?">
        {compliance.length ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-[#ecfdf3] px-2 py-1.5">
                <p className="text-lg font-bold tabular-nums text-[#067647]">{counts.met}</p>
                <p className="text-[0.6875rem] font-semibold text-[#067647]">Met</p>
              </div>
              <div className="rounded-lg bg-[#fef3f2] px-2 py-1.5">
                <p className="text-lg font-bold tabular-nums text-[#b42318]">{counts.missing}</p>
                <p className="text-[0.6875rem] font-semibold text-[#b42318]">Missing</p>
              </div>
              <div className="rounded-lg bg-[var(--subtle)] px-2 py-1.5">
                <p className="text-lg font-bold tabular-nums text-[var(--text-2)]">{counts.unknown}</p>
                <p className="text-[0.6875rem] font-semibold text-[var(--text-3)]">Unknown</p>
              </div>
            </div>
            <a href="#compliance" className="mt-2 inline-block text-xs font-semibold text-[var(--accent-2)] hover:underline">See the checklist</a>
          </>
        ) : (
          <p className="text-sm text-[var(--text-3)]">No checklist for this market yet.</p>
        )}
      </RailCard>
    </aside>
  );
}
