"use client";
import Link from "next/link";
import { CalendarCheck, Clock3, Mail, MessageSquare, ShieldAlert } from "lucide-react";
import type { listFunnelThreads } from "@/mvp/automation/engine";

export type Conversation = Awaited<ReturnType<typeof listFunnelThreads>>[number];
export type ConversationGroup = "preparing" | "waiting" | "replied" | "review" | "meeting" | "paused" | "stopped";
export function conversationGroup(t: Conversation): ConversationGroup {
  if (t.state === "meeting_booked") return "meeting";
  if (t.state === "stopped") return "stopped";
  if (t.state === "review" || t.review_count > 0) return "review";
  if (t.paused) return "paused";
  if (["engaged", "awaiting_calendar", "awaiting_time", "meeting_pending"].includes(t.state)) return "replied";
  return t.state === "active" && t.sent_count > 0 ? "waiting" : "preparing";
}
export function followupDue(t: Conversation, now: number): boolean {
  return conversationGroup(t) === "waiting" && t.followups_sent < 2 && t.pending_count === 0
    && Number.isFinite(Date.parse(t.next_action_at)) && Date.parse(t.next_action_at) <= now;
}
export const GROUP_LABEL: Record<ConversationGroup, string> = {
  preparing: "Preparing introduction", waiting: "Waiting for reply", replied: "Reply / scheduling",
  review: "Needs review", meeting: "Meeting booked", paused: "Paused", stopped: "Stopped",
};
const TONE: Record<ConversationGroup, string> = {
  preparing: "bg-blue-50 text-blue-800", waiting: "bg-blue-50 text-blue-800", replied: "bg-violet-50 text-violet-800",
  review: "bg-amber-50 text-amber-900", meeting: "bg-green-50 text-green-800", paused: "bg-slate-100 text-slate-700", stopped: "bg-slate-100 text-slate-700",
};
const timestamp = (value: string | null, timeZone: string) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value)) : "Not scheduled";
export function nextStep(t: Conversation, now: number): string {
  const group = conversationGroup(t);
  if (group === "meeting") return "Meeting confirmed. Open the Calendar / Meet details below.";
  if (group === "stopped") return "Conversation closed. No automatic follow-ups will be sent.";
  if (group === "review") return "Automatic sending is held. Open the conversation to review the reason.";
  if (group === "paused") return "Conversation paused. No new automatic messages until resumed.";
  if (t.state === "awaiting_calendar") return "Connect Google Calendar in Settings to continue scheduling.";
  if (t.state === "awaiting_time") return "Waiting for the customer to choose an offered meeting time.";
  if (t.state === "meeting_pending") return "Checking the agreed time and creating the Calendar event.";
  if (t.pending_count > 0) return "An email is queued or being sent. It is not sent until the provider accepts it.";
  if (t.state === "engaged") return "Processing the customer’s reply and the next sales response.";
  if (group === "preparing") return t.state === "needs_contact" ? "Waiting for the required contact check." : "Checking buyer fit and preparing the introduction.";
  if (t.followups_sent >= 2) return "Follow-up limit reached. Waiting for a reply; no further automatic chase.";
  return followupDue(t, now) ? "Follow-up is due; the worker will check sending hours and safety limits." : "Waiting for a reply. A follow-up is scheduled if the customer does not respond.";
}

export function ConversationCard({ thread: t, now, timeZone, automationRunning }: {
  thread: Conversation; now: number; timeZone: string; automationRunning: boolean;
}) {
  const group = conversationGroup(t), booked = group === "meeting";
  const url = `/opportunities/${encodeURIComponent(t.opportunity_id ?? "")}?tab=conversation&returnTo=${encodeURIComponent("/crm?run=" + (t.run_id ?? "all"))}`;
  return <article aria-label={`Conversation with ${t.company}`} className="card flex min-w-0 flex-col overflow-hidden">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] p-5">
      <div className="min-w-0 flex-1"><h3 className="break-words text-base font-bold">{t.company}</h3><p className="mt-1 break-words text-sm text-[var(--muted)]">{t.product}</p></div>
      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONE[group]}`}>{GROUP_LABEL[group]}</span>
    </div>
    <div className="flex flex-1 flex-col gap-4 p-5">
      <dl className="grid grid-cols-3 gap-2 rounded-xl bg-[var(--subtle)] p-3 text-sm">
        <div><dt className="flex items-center gap-1 text-[11px] text-[var(--muted)]"><Mail size={12} aria-hidden />Emails sent</dt><dd className="mt-1 font-bold" title="Provider-accepted messages, not confirmed inbox deliveries">{t.sent_count}</dd></div>
        <div><dt className="flex items-center gap-1 text-[11px] text-[var(--muted)]"><MessageSquare size={12} aria-hidden />Replies</dt><dd className="mt-1 font-bold">{t.reply_count}</dd></div>
        <div><dt className="text-[11px] text-[var(--muted)]">Follow-ups sent</dt><dd className="mt-1 font-bold">{t.followups_sent} <span className="font-normal text-[var(--muted)]">of 2</span></dd></div>
      </dl>
      <div className={`rounded-xl border p-3 ${group === "review" ? "border-amber-200 bg-amber-50" : "border-[var(--line)]"}`}>
        <p className="flex items-center gap-2 text-xs font-bold">{booked ? <CalendarCheck size={14} aria-hidden /> : group === "review" ? <ShieldAlert size={14} aria-hidden /> : <Clock3 size={14} aria-hidden />}What happens next</p>
        <p className="mt-1 text-sm leading-5 text-[var(--text-2)]">{!automationRunning && !["meeting", "stopped", "review", "paused"].includes(group) ? "Automation is not running. Check connections in Settings before this step can continue." : nextStep(t, now)}</p>
        {group === "waiting" && t.followups_sent < 2 && !t.pending_count ? <p className="mt-2 text-xs text-[var(--muted)]">Next follow-up check: {timestamp(t.next_action_at, timeZone)} · {timeZone}</p> : null}
        {t.reason && !(t.sent_count > 0 && /^Demo email queued\b/i.test(t.reason)) ? <p className="mt-2 break-words text-xs leading-5 text-[var(--text-2)]">{group === "review" ? "Review reason: " : "Status: "}{t.reason}</p> : null}
      </div>
      {t.latest_subject ? <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t.latest_direction === "in" ? "Latest customer reply" : t.latest_state === "accepted" ? "Latest email sent" : "Latest email draft"} · {timestamp(t.latest_at, timeZone)}</p><p className="mt-1 truncate text-sm font-semibold" title={t.latest_subject}>{t.latest_subject}</p><p className="mt-1 line-clamp-3 whitespace-pre-line break-words text-xs leading-5 text-[var(--text-2)]">{t.latest_preview}</p></div> : null}
      {t.summary ? <details className="text-sm"><summary className="cursor-pointer font-semibold text-[var(--text-2)]">AI conversation summary</summary><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{t.summary}</p></details> : null}
      {t.run_id ? <Link href={`/crm?run=${encodeURIComponent(t.run_id)}`} className="text-xs text-[var(--accent)] hover:underline">Search: {t.keyword}</Link> : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
        {t.opportunity_id ? <Link href={url} className="btn btn-primary btn-sm">View conversation →</Link> : null}
        {booked && t.meet_url ? <a href={t.meet_url} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">Open Google Meet</a> : null}
        {t.run_id && t.opportunity_id ? <Link href={`/crm?run=${encodeURIComponent(t.run_id)}&open=${encodeURIComponent(t.opportunity_id)}`} className="ml-auto text-xs font-semibold text-[var(--accent)] hover:underline">Buyer evidence</Link> : null}
      </div>
    </div>
  </article>;
}
