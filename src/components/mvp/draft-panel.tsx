"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, Check, Copy, Loader2, Mail, Send, X } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import type { OutreachRule } from "@/mvp/types";
import { createDraft, updateDraft, type DraftResult } from "./api-client";
import { PERMISSION_LABELS } from "./labels";

export interface DraftContact {
  /** null = company-level draft (no named contact). */
  id: string | null;
  name: string;
  detail?: string;
  country: string | null;
  rule: OutreachRule | null;
}

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
}: {
  leadId: string;
  contacts: DraftContact[];
  onClose: () => void;
  onSent?: () => void;
}) {
  const [contactKey, setContactKey] = useState<string>(contacts[0]?.id ?? "company");
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"generate" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const contact = contacts.find((item) => (item.id ?? "company") === contactKey);
  const precheck = emailBlockReason(contact);
  const blocked = precheck ?? draft?.blockedReason ?? null;

  const generate = async () => {
    setBusy("generate");
    setError(null);
    setSent(false);
    try {
      const result = await createDraft(leadId, contact?.id ?? null);
      setDraft(result);
      setSubject(result.subject ?? "");
      setBody(result.body ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The draft could not be written.");
    } finally {
      setBusy(null);
    }
  };

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
              value={contactKey}
              onChange={(event) => {
                setContactKey(event.target.value);
                setDraft(null);
                setSubject("");
                setBody("");
                setSent(false);
              }}
              className="control focus-ring h-10 px-2 text-sm"
            >
              {contacts.map((item) => (
                <option key={item.id ?? "company"} value={item.id ?? "company"}>
                  {item.name}
                  {item.detail ? ` · ${item.detail}` : ""}
                </option>
              ))}
            </select>
            {contact?.rule ? (
              <p className="text-xs text-[#667085]">
                Contact rules{contact.country ? ` (${marketName(contact.country)})` : ""}: email {PERMISSION_LABELS[contact.rule.email]}
              </p>
            ) : null}
          </div>

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
            onClick={generate}
            disabled={Boolean(precheck) || busy !== null}
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
                  disabled={sent}
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
                  disabled={sent}
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
                  onClick={markSent}
                  disabled={sent || busy !== null}
                  className="btn-quiet focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold disabled:opacity-50"
                >
                  {busy === "send" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
                  {sent ? "Marked as sent" : "Mark as sent"}
                </button>
              </div>
              <p className="text-xs text-[#667085]">Send it from your own mail app, then mark it as sent so the lead history stays complete.</p>
            </>
          ) : null}

          {error ? <p role="alert" className="text-sm font-semibold text-[#b42318]">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
