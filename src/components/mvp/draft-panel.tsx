"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, Check, Copy, Loader2, Mail, Send, X } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import type { OutreachRule } from "@/mvp/types";
import { createDraft, sendDemoDraft, updateDraft, type DraftResult } from "./api-client";
import { apiJson } from "./api-client";
import Link from "next/link";
import { DEMO_CONTACT_EMAIL, type DemoEmailInfo } from "@/mvp/email/config";
import { PERMISSION_LABELS } from "./labels";

export interface DraftContact {
  /** null = company-level draft (no named contact). */
  id: string | null;
  name: string;
  detail?: string;
  country: string | null;
  rule: OutreachRule | null;
  email?: string | null;
  companyName?: string;
  isDemo?: boolean;
}

const keyOf = (contact: DraftContact) => contact.isDemo ? "demo" : contact.id ?? "company";

/** Why email is not allowed for this contact, in plain words, or null when it is allowed. */
export function emailBlockReason(contact: DraftContact | undefined): string | null {
  const rule = contact?.rule;
  if (!rule || (rule.email !== "consent_needed" && rule.email !== "blocked")) return null;
  const where = contact?.country ? ` in ${marketName(contact.country)}` : "";
  const head =
    rule.email === "blocked"
      ? `Email is not allowed for contacts${where}.`
      : `Email needs the contact's consent first${where}.`;
  return [head, rule.steps[0]].filter(Boolean).join(" ");
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * Draft email (12 F4, 09 §4.3): pick a contact → generate → edit → Copy → Mark as sent.
 * Disabled with the reason when the contact's country rule is "consent needed" or "blocked".
 */
export function DraftPanel({
  leadId,
  contacts,
  onClose,
  onSent,
  demoEmail,
  autoGenerate = false,
  initialContactKey,
  opportunityId,
}: {
  leadId: string;
  contacts: DraftContact[];
  onClose: () => void;
  onSent?: () => void;
  demoEmail?: DemoEmailInfo;
  autoGenerate?: boolean;
  initialContactKey?: string;
  opportunityId?: string;
}) {
  const startingContact = contacts.find(c => keyOf(c) === initialContactKey) ?? contacts[0];
  const [contactKey, setContactKey] = useState<string>(startingContact ? keyOf(startingContact) : "company");
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"generate" | "send" | null>(autoGenerate && (demoEmail?.enabled || !emailBlockReason(startingContact)) ? "generate" : null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [delivery, setDelivery] = useState<{ recipient: string; messageId: string } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [queued, setQueued] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const contact = contacts.find((item) => keyOf(item) === contactKey);
  const personId = contact?.id ?? null;
  const isDemoContact = Boolean(contact?.isDemo);
  const contactTitle = contact?.detail;
  const precheck = demoEmail?.enabled ? null : emailBlockReason(contact);
  const blocked = precheck ?? draft?.blockedReason ?? null;

  const generate = async (templateOnly = false, signal?: AbortSignal) => {
    setBusy("generate");
    setError(null);
    setSent(false);
    try {
      const result = await createDraft(leadId, personId, {
        ...(opportunityId ? { opportunityId } : {}),
        ...(templateOnly ? { templateOnly: true } : {}),
        ...(isDemoContact ? { demoContact: true, demoContactTitle: contactTitle } : {}), signal,
      });
      if (signal?.aborted) return;
      setDraft(result);
      setSubject(result.subject ?? "");
      setBody(result.body ?? "");
      setAttempted(false);
      setDelivery(null);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "The draft could not be written.");
    } finally {
      if (!signal?.aborted) setBusy(null);
    }
  };

  useEffect(() => {
    if (!autoGenerate || precheck) return;
    const controller = new AbortController();
    createDraft(leadId, personId, {
      ...(opportunityId ? { opportunityId } : {}),
      templateOnly: true, ...(isDemoContact ? { demoContact: true, demoContactTitle: contactTitle } : {}), signal: controller.signal,
    }).then(result => {
      if (controller.signal.aborted) return;
      setDraft(result); setSubject(result.subject ?? ""); setBody(result.body ?? "");
      setAttempted(false); setSent(false); setDelivery(null); setError(null);
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "The draft could not be written.");
    }).finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => controller.abort();
  }, [autoGenerate, precheck, contactKey, leadId, personId, isDemoContact, contactTitle, opportunityId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy did not work in this browser. Select the text and copy it by hand.");
    }
  };

  const markSent = async () => {
    if (!draft) return;
    setBusy("send");
    setError(null);
    try {
      await updateDraft(draft.id, { subject, body, status: "sent_externally" });
      setSent(true);
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark the email as sent.");
    } finally {
      setBusy(null);
    }
  };

  const sendDemo = async () => {
    if (!draft || !demoEmail?.ready) return;
    setBusy("send");
    setError(null);
    setAttempted(true);
    try {
      const result = await sendDemoDraft(draft.id, { subject, body });
      setDelivery(result);
      setSent(true);
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delivery could not be confirmed. Retry the same draft.");
    } finally { setBusy(null); }
  };

  const approveAutomation = async () => {
    if (!draft || !demoEmail?.ready) return;
    setBusy("send"); setError(null);
    try {
      await apiJson("/api/mvp/outreach/campaigns", { method: "POST", body: { draftId: draft.id, subject, body } });
      setQueued(true); setAttempted(true); onSent?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not approve automatic delivery."); }
    finally { setBusy(null); }
  };

  const words = wordCount(body);
  const hasText = Boolean(draft && !draft.blockedReason && (subject || body));

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <button type="button" aria-label="Close draft" className="absolute inset-0 bg-[#101828]/20" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-title"
        className="relative flex h-full w-full max-w-[520px] flex-col overflow-y-auto bg-white shadow-2xl outline-none"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-[#e1e6ef] bg-white px-4 py-3">
          <h2 id="draft-title" className="flex items-center gap-2 text-base font-bold text-[#101828]">
            <Mail size={17} aria-hidden /> Draft email
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-[#475467] hover:bg-[#f2f4f7]">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="draft-contact" className="text-sm font-semibold text-[#344054]">Contact</label>
            <select
              id="draft-contact"
              disabled={busy === "send" || (attempted && !sent)}
              value={contactKey}
              onChange={(event) => {
                setContactKey(event.target.value);
                setDraft(null);
                setSubject("");
                setBody("");
                setSent(false);
                setAttempted(false);
                setDelivery(null);
                if (autoGenerate) setBusy(demoEmail?.enabled || !emailBlockReason(contacts.find(c => keyOf(c) === event.target.value)) ? "generate" : null);
              }}
              className="control focus-ring h-10 px-2 text-sm"
            >
              {contacts.map((item) => (
                <option key={keyOf(item)} value={keyOf(item)}>
                  {item.name}
                  {item.detail ? ` · ${item.detail}` : ""}
                </option>
              ))}
            </select>
            {contact?.companyName ? <p className="text-sm text-[#344054]">Buyer: {contact.companyName}</p> : null}
            <p className="text-sm text-[#344054]">
              Contact email: {contact?.email || (demoEmail?.enabled ? DEMO_CONTACT_EMAIL : "Not found")}
              {demoEmail?.enabled && (!contact?.email || contact.email === DEMO_CONTACT_EMAIL) ? <span className="ml-1 text-xs text-[#92400e]">(dummy address — display only)</span> : null}
            </p>
            {contact?.rule ? (
              <p className="text-xs text-[#667085]">
                Contact rules{contact.country ? ` (${marketName(contact.country)})` : ""}: email {PERMISSION_LABELS[contact.rule.email]}
              </p>
            ) : null}
          </div>

          {demoEmail?.enabled ? (
            <div className="rounded-md border border-[#bfdbfe] bg-[#eff6ff] p-3 text-sm text-[#1e40af]">
              <p className="font-semibold">Demo delivery only</p>
              <p>All messages go to {demoEmail.recipient || "the configured test inbox"}, never to this contact.</p>
              <p className="mt-1 text-xs">This is a test preview, not permission to contact the real buyer.</p>
              {!demoEmail.ready ? <p className="mt-1 font-semibold">{demoEmail.error}</p> : null}
            </div>
          ) : null}

          {blocked ? (
            <div role="alert" className="flex gap-2 rounded-md border border-[#fecdca] bg-[#fef3f2] p-3 text-sm text-[#b42318]">
              <Ban size={17} className="mt-0.5 shrink-0" aria-hidden />
              <div>
                <p className="font-bold">Drafting is turned off for this contact</p>
                <p className="mt-1">{blocked}</p>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void generate()}
            disabled={Boolean(precheck) || busy !== null || (attempted && !sent)}
            className="btn-primary focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "generate" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Mail size={16} aria-hidden />}
            {draft && !draft.blockedReason ? "Write again" : "Write draft"}
          </button>

          {hasText ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="draft-subject" className="text-sm font-semibold text-[#344054]">Subject</label>
                <input
                  id="draft-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  disabled={sent || busy !== null || attempted}
                  className="control focus-ring h-10 px-3 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="draft-body" className="flex justify-between text-sm font-semibold text-[#344054]">
                  Message
                  <span className={`font-normal tabular-nums ${words > 120 ? "text-[#b54708]" : "text-[#667085]"}`}>{words} words</span>
                </label>
                <textarea
                  id="draft-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  disabled={sent || busy !== null || attempted}
                  rows={12}
                  className="control focus-ring px-3 py-2 text-sm leading-6"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="btn-quiet focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold"
                >
                  {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={demoEmail?.enabled ? opportunityId ? approveAutomation : sendDemo : markSent}
                  disabled={queued || sent || busy !== null || Boolean(demoEmail?.enabled && !demoEmail.ready)}
                  className="btn-quiet focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold disabled:opacity-50"
                >
                  {busy === "send" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
                  {queued ? "Approved — queued" : demoEmail?.enabled ? opportunityId ? "Approve & automate demo email" : sent ? "Demo email sent" : attempted ? "Retry demo email" : "Send demo email" : sent ? "Marked as sent" : "Mark as sent"}
                </button>
              </div>
              {queued ? <div role="status" className="rounded-lg bg-[var(--subtle)] p-3 text-sm">Email approved and queued, not yet sent. <Link href="/outreach" className="font-semibold text-[var(--accent)]">Track delivery in Outreach →</Link></div> : null}
              {demoEmail?.enabled ? (
                <p className="text-xs text-[#667085]">{delivery ? `Accepted by the email provider for ${delivery.recipient}. Message ID: ${delivery.messageId}. Check that inbox for receipt.` : "Sent is shown only after the email provider accepts the message. No buyer is emailed in this demo."}</p>
              ) : <p className="text-xs text-[#667085]">Send it from your own mail app, then mark it as sent so the buyer history stays complete.</p>}
            </>
          ) : null}

          {error ? <p role="alert" className="text-sm font-semibold text-[#b42318]">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
