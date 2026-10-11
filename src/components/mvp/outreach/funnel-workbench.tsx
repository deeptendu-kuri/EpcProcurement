"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarCheck, Clock3, Mail, Search, ShieldAlert } from "lucide-react";
import { apiJson } from "../api-client";
import type { listFunnelThreads } from "@/mvp/automation/engine";
import { ConversationTimeline } from "./conversation-timeline";
import type { FunnelSettings } from "./demo-funnel-setup";
import { ConversationCard, conversationGroup, followupDue, GROUP_LABEL, type ConversationGroup } from "./conversation-card";

type Data = { settings: FunnelSettings; threads: Awaited<ReturnType<typeof listFunnelThreads>> };
type Filter = "all" | "due" | ConversationGroup;
const FILTERS: { id: Filter; label: string }[] = [{ id: "all", label: "All conversations" },
  { id: "waiting", label: "Waiting for reply" }, { id: "due", label: "Follow-up due" },
  { id: "review", label: "Needs review" }, { id: "replied", label: "Reply / scheduling" },
  { id: "meeting", label: "Meeting booked" }, { id: "preparing", label: "Preparing" },
  { id: "paused", label: "Paused" }, { id: "stopped", label: "Stopped" }];

export function FunnelWorkbench({ initial, calendarResult }: { initial: Data; calendarResult?: string }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let inFlight: AbortController | null = null;
    const poll = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      const controller = new AbortController(); inFlight = controller;
      try {
        const next = await apiJson<Data>("/api/mvp/automation", { signal: controller.signal });
        if (!cancelled) { setData(next); setError(null); setNow(Date.now()); }
      } catch { if (!cancelled) setError("Status refresh failed. Check your connection; the last known status is shown."); }
      finally { inFlight = null; }
    };
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => { setNow(Date.now()); void poll(); }, 10_000);
    const visible = () => { if (document.visibilityState !== "hidden") void poll(); };
    document.addEventListener("visibilitychange", visible);
    return () => { cancelled = true; clearTimeout(first); clearInterval(timer); inFlight?.abort(); document.removeEventListener("visibilitychange", visible); };
  }, []);
  const act = async (body: object) => {
    setBusy(true); setError(null);
    try { setData(await apiJson<Data>("/api/mvp/automation", { method: "POST", body })); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update automation."); }
    finally { setBusy(false); }
  };
  const s = data.settings, enabled = s.enabled && s.ready && s.worker, running = enabled && !s.last_error;
  const test = data.threads.find(t => t.mode === "email_test" && t.recipient === s.recipient);
  const threads = data.threads.filter(t => t.mode !== "email_test");
  const matchesFilter = (t: (typeof threads)[number], f: Filter) => f === "all" || (f === "due" ? followupDue(t, now) : conversationGroup(t) === f);
  const count = (f: Filter) => threads.filter(t => matchesFilter(t, f)).length;
  const visibleThreads = threads.filter(t => matchesFilter(t, filter) && [t.company, t.product, t.keyword].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="flex flex-col gap-5">
    <section className="card p-5" data-tour="automation-health" aria-label="Automation status">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className={`mb-1 text-xs font-semibold ${running ? "text-green-700" : "text-amber-800"}`}>{running ? "● Automation on" : enabled ? "● Automation enabled · worker needs attention" : "● Needs attention"}</p><h2 className="text-lg font-bold">Your sales conversations, in one place</h2><p className="mt-1 text-sm text-[var(--muted)]">Introduction → reply → follow-ups → agreed meeting</p></div><Link href="/settings?tab=automation" className="btn btn-secondary btn-sm">Manage connections</Link></div>
      <dl className="mt-4 grid gap-4 rounded-xl bg-[var(--subtle)] p-4 text-sm sm:grid-cols-3"><div><dt className="text-xs text-[var(--muted)]">Seller / salesperson</dt><dd className="mt-1 font-semibold">{s.seller.name}{s.seller.company ? ` · ${s.seller.company}` : ""}</dd></div><div><dt className="text-xs text-[var(--muted)]">Demo customer inbox</dt><dd className="mt-1 break-all font-semibold">{s.recipient}</dd></div><div><dt className="text-xs text-[var(--muted)]">Google Calendar</dt><dd className="mt-1 font-semibold">{s.calendar ? "Connected" : "Not connected · consent needed"}</dd></div></dl>
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">When a new search finishes, up to {s.prospectsPerSearch} evidence-qualified companies receive a demo introduction at this inbox only. Paused searches wait until finished. No real buyer is emailed. Opening a page or conversation never sends an email.</p>
      {calendarResult === "failed" ? <p role="alert" className="mt-2 text-sm text-red-700">Google consent failed. Reconnect in Settings.</p> : null}
      {s.last_error || s.configError ? <p role="alert" className="mt-3 text-sm text-red-700">{s.last_error || s.configError}</p> : null}
      {!running ? <p className="mt-3 text-sm text-amber-800">{enabled ? "The worker reported an error. The message history below remains available; check connections before testing another automated step." : "Delivery is not ready. Check connections and the email worker before starting a search."}</p> : null}
    </section>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Conversation overview">
      {[{ id: "waiting" as const, label: "Waiting for reply", icon: Mail }, { id: "due" as const, label: "Follow-up due", icon: Clock3 }, { id: "review" as const, label: "Needs review", icon: ShieldAlert }, { id: "meeting" as const, label: "Meeting booked", icon: CalendarCheck }].map(item => <button key={item.id} type="button" onClick={() => setFilter(item.id)} aria-pressed={filter === item.id} className={`card p-4 text-left ${filter === item.id ? "ring-2 ring-[var(--accent)]" : "hover:border-[var(--accent)]"}`}><span className="flex items-center gap-2 text-xs font-medium text-[var(--muted)]"><item.icon size={15} aria-hidden />{item.label}</span><span className="mt-2 block text-2xl font-bold tabular-nums">{count(item.id)}</span></button>)}
    </div>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    <section data-tour="automation-conversations" aria-label="Automated conversations" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Conversations <span className="font-normal text-[var(--muted)]">({threads.length})</span></h2><label className="relative min-w-0 flex-1 sm:max-w-xs"><Search size={15} className="absolute left-3 top-3 text-[var(--muted)]" aria-hidden /><span className="sr-only">Filter conversations</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Company, product or search…" className="input w-full pl-9" data-main-search /></label></div>
      <div aria-label="Conversation filters" className="my-4 flex flex-wrap gap-2">{FILTERS.map(f => <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === f.id ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line)] bg-white text-[var(--text-2)] hover:border-[var(--accent)]"}`}>{f.label} ({count(f.id)})</button>)}</div>
      {!threads.length ? <div className="card p-8 text-center"><Mail className="mx-auto text-[var(--muted)]" size={28} aria-hidden /><h3 className="mt-3 font-bold">Start your first sales conversation</h3><p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted)]">Run a material search with automation ready. When it finishes, the top eligible leads appear here with actual email status, follow-ups and meeting progress.</p><Link href="/find" className="btn btn-primary mt-4">Find buyers</Link></div>
        : !visibleThreads.length ? <div className="card p-8 text-center"><p className="font-semibold">No conversations match {filter === "all" ? "this search" : filter === "due" ? "Follow-up due" : GROUP_LABEL[filter]}.</p><button type="button" className="btn btn-secondary mt-3" onClick={() => { setFilter("all"); setQuery(""); }}>Show all conversations</button></div>
        : <div className="grid gap-4 xl:grid-cols-2">{visibleThreads.map(t => <ConversationCard key={t.id} thread={t} now={now} timeZone={s.preferences.timeZone} automationRunning={running} />)}</div>}
      <p className="mt-3 text-xs text-[var(--muted)]">“Sent” means the email provider accepted the message, not guaranteed inbox delivery. Status refreshes every 10 seconds while this tab is visible. A reply cancels pending chasing; opt-outs stop delivery.</p>
    </section>
    <details className="card p-5"><summary className="cursor-pointer font-semibold">Optional inbox-only diagnostic (not a buyer lead)</summary><p className="mt-3 text-sm text-[var(--text-2)]">A separate line-pipe conversation to test email transport without research or verification credits. For the main demo, use a researched prospect above. This diagnostic never enters CRM and has no prospecting follow-ups.</p><button className="btn btn-secondary mt-3" disabled={busy || !running || Boolean(test)} onClick={() => void act({ action: "start_email_test", confirmedRecipient: s.recipient, productId: "line-pipe" })}>Start live inbox diagnostic</button>{test && ["active", "engaged"].includes(test.state) ? <button className="btn btn-secondary mt-3 ml-2" disabled={busy || !s.enabled || test.paused} onClick={() => void act({ action: "send_seller_test_intro", threadId: test.id, confirmedRecipient: s.recipient })}>Send corrected diagnostic introduction (once)</button> : null}{test ? <ConversationTimeline testThreadId={test.id} /> : null}</details>
  </div>;
}
