"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleSlash, ExternalLink, Loader2, Plus, Sparkles, Square, TriangleAlert } from "lucide-react";
import type { SearchWorkspaceData } from "@/mvp/research/workspace";
import type { FoundCompany } from "@/mvp/research/found";
import { marketName } from "@/mvp/config/markets";
import { apiJson } from "../api-client";
import { Avatar, RatingBadge } from "../search/results-table";

const POLL_MS = 4000;
type Filter = "likely" | "all" | "not";
const CHECKABLE: FoundCompany["status"][] = ["not_checked", "no_website", "unreadable"];
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const compact = (n: number) => (n >= 100_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function Stat({ label, value, sub, ratio }: { label: string; value: string; sub?: string; ratio?: number | null }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[12.5px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{value}</p>
      {sub ? <p className="mt-1.5 text-[12px] text-[var(--muted)]">{sub}</p> : null}
      {ratio !== undefined && ratio !== null ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--subtle)]" aria-hidden>
          <div className={`h-full rounded-full ${ratio > 0.9 ? "bg-[var(--warn)]" : "bg-[var(--accent)]"}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function statusLine(c: FoundCompany): { text: string; tone: string } {
  if (c.opportunityId) return { text: "Verified buyer", tone: "bg-[var(--good-bg)] text-[var(--good)]" };
  if (c.status === "checking") return { text: c.statusText, tone: "bg-[var(--info-bg)] text-[var(--info)]" };
  if (c.status === "no_match") return { text: "Checked · no matching work", tone: "bg-[var(--subtle)] text-[var(--muted)]" };
  if (c.status === "no_website" || c.status === "unreadable") return { text: c.statusText, tone: "bg-[var(--warn-bg)] text-[var(--warn)]" };
  return { text: "Not checked yet", tone: "bg-[var(--subtle)] text-[var(--text-2)]" };
}

/**
 * A search's workspace (docs/mvp/18 §4): live status, time and AI tokens, the rated shortlist of every
 * company it found (best buyers first, each with what it would buy and why), verified buyers and activity.
 */
export function SearchLiveWorkspace({ runId, initial }: { runId: string; initial: SearchWorkspaceData }) {
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<Filter>("likely");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tick, setTick] = useState(0);
  const [confirmStop, setConfirmStop] = useState(false);
  const product = data.run.product ?? data.run.query;
  const live = data.running || data.counts.checking > 0;

  useEffect(() => {
    const controller = new AbortController();
    if (tick === 0) return () => controller.abort();
    apiJson<SearchWorkspaceData>(`/api/mvp/research/${runId}/workspace`, { signal: controller.signal }).then(setData).catch(() => undefined);
    return () => controller.abort();
  }, [runId, tick]);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [live]);

  const act = useCallback(async (key: string, body: unknown) => {
    setBusy(key); setNote("");
    try { const r = await apiJson<{ message: string }>(`/api/mvp/research/${runId}/companies`, { method: "POST", body }); setNote(r.message); setTick((n) => n + 1); }
    catch (e) { setNote(e instanceof Error ? e.message : "That did not work. Try again."); }
    finally { setBusy(null); }
  }, [runId]);

  const stop = async () => {
    setBusy("stop"); setNote("");
    try {
      await apiJson(`/api/mvp/runs/${runId}`, { method: "POST", body: { action: "cancel" } });
      setConfirmStop(false);
      setData((d) => ({ ...d, running: false, phase: "Stopped", run: { ...d.run, status: "cancelled", statusText: "Stopped by you" } }));
      setTick((n) => n + 1);
    } catch (e) { setNote(e instanceof Error ? e.message : "The search could not be stopped."); }
    finally { setBusy(null); }
  };

  const relevant = data.companies.filter((c) => c.relevant);
  const lists: Record<Filter, FoundCompany[]> = {
    likely: relevant.filter((c) => c.opportunityId || (c.rating ?? 0) >= 45),
    all: relevant,
    not: data.companies.filter((c) => !c.relevant),
  };
  const shown = lists[filter];
  const unrated = data.companies.filter((c) => c.rating === null || c.guessed).length;
  const nextToCheck = relevant.filter((c) => !c.opportunityId && CHECKABLE.includes(c.status) && (c.rating === null || c.rating >= 25)).slice(0, 5);
  const markets = data.run.markets.map(marketName);
  const u = data.usage;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard" className="inline-flex w-fit items-center gap-1 text-[14px] text-[var(--accent)] hover:underline"><ArrowLeft size={15} aria-hidden />Dashboard</Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">{data.run.query}</h1>
          <p className="page-subtitle">{product.toLowerCase() !== data.run.query.toLowerCase() ? `${product} · ` : ""}{markets.join(" · ")} · Started {when(data.run.createdAt)}</p>
          <p className="mt-3 inline-flex items-center gap-2 text-[14px] font-medium" role="status" aria-live="polite">
            {data.running ? <Loader2 size={16} className="animate-spin text-[var(--accent)]" aria-hidden />
              : data.run.status === "done" ? <CheckCircle2 size={16} className="text-[var(--good)]" aria-hidden />
              : data.run.status === "cancelled" ? <CircleSlash size={16} className="text-[var(--muted)]" aria-hidden />
              : <TriangleAlert size={16} className="text-[var(--warn)]" aria-hidden />}
            {data.running ? `Running · ${data.phase}` : data.run.statusText}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.running && !confirmStop ? <button type="button" className="btn btn-secondary h-10 px-4" onClick={() => setConfirmStop(true)}><Square size={14} aria-hidden />Stop search</button> : null}
          <Link href="/find" className="btn btn-secondary h-10 px-4"><Plus size={16} aria-hidden />New search</Link>
          <Link href={`/crm?run=${runId}`} className="btn btn-primary h-10 px-4">See leads ({data.counts.verified})<ArrowRight size={16} aria-hidden /></Link>
        </div>
      </header>

      {data.running && confirmStop ? (
        <div role="alertdialog" aria-label="Stop this search?" className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-[14px]"><span className="font-semibold">Stop this search?</span> <span className="text-[var(--text-2)]">Companies and buyers found so far are kept. No more pages are read and no more AI tokens are used.</span></p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmStop(false)} disabled={busy === "stop"}>Keep running</button>
            <button type="button" className="btn btn-danger" onClick={() => void stop()} disabled={busy === "stop"}>{busy === "stop" ? "Stopping…" : "Stop search"}</button>
          </div>
        </div>
      ) : null}

      <section aria-label="Search status" className="card grid grid-cols-2 divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
        <Stat label="Time" value={data.minutes === null ? "—" : `${data.minutes} min`} sub={data.running ? "and counting" : data.run.finishedAt ? `Ended ${clock(data.run.finishedAt)} UTC` : undefined} />
        <Stat label="AI tokens used" value={compact(u.tokens)} sub={u.tokenLimit ? `of ${compact(u.tokenLimit)} for this search · ${u.aiCalls} calls` : `${u.aiCalls} AI calls`} ratio={u.tokenLimit ? u.tokens / u.tokenLimit : null} />
        <Stat label="Pages read" value={String(u.pagesRead)} sub={u.pageLimit ? `of ${u.pageLimit} allowed` : undefined} ratio={u.pageLimit ? u.pagesRead / u.pageLimit : null} />
        <Stat label="Companies found" value={String(data.counts.found)} sub={data.counts.notBuyers ? `${data.counts.notBuyers} other names set aside` : undefined} />
        <Stat label="Likely buyers" value={String(data.counts.likely)} sub={`rated from what the sources say`} />
        <Stat label="Verified buyers" value={String(data.counts.verified)} sub="own website shows matching work" />
      </section>

      {data.run.error ? <p role="alert" className="rounded-xl bg-[var(--bad-bg)] px-4 py-3 text-[14px] text-[var(--bad)]">{data.run.error}</p> : null}
      {!data.running && data.run.stopReason ? <p className="rounded-xl bg-[var(--warn-bg)] px-4 py-3 text-[13px] text-[var(--warn)]">{data.run.stopReason} Results are a batch, not the whole market.</p> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="shortlist" className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5">
            <div>
              <h2 id="shortlist" className="text-[19px] font-semibold tracking-[-0.015em]">Shortlist</h2>
              <p className="mt-0.5 text-[13px] text-[var(--muted)]">Every company this search found, best buyers of {product} first.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {unrated ? <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void act("rate", { action: "rate" })}>
                {busy === "rate" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />}Rate {unrated} with AI</button> : null}
              {nextToCheck.length > 1 ? <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void act("bulk", { candidateIds: nextToCheck.map((c) => c.id) })}>
                {busy === "bulk" ? "Starting…" : `Check top ${nextToCheck.length}`}</button> : null}
            </div>
          </div>
          <div role="tablist" aria-label="Show" className="mx-5 mb-3 inline-flex rounded-[10px] bg-[var(--subtle)] p-0.5">
            {([["likely", "Likely buyers"], ["all", "All found"], ["not", "Not buyers"]] as [Filter, string][]).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}
                className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition ${filter === key ? "bg-white text-[var(--text)] shadow-sm" : "text-[var(--text-2)] hover:text-[var(--text)]"}`}>
                {label} <span className="tabular-nums text-[var(--muted)]">{lists[key].length}</span>
              </button>
            ))}
          </div>
          {note ? <p role="status" className="mx-5 mb-3 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[13px] text-[var(--info)]">{note}</p> : null}
          {!shown.length ? (
            <p className="border-t border-[var(--line)] px-5 py-8 text-[14px] text-[var(--muted)]">
              {data.running ? "Companies appear here as the search names them." : filter === "likely" && unrated ? "Rate the companies to see the likely buyers." : "Nothing here."}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]" aria-label="Shortlisted companies">
              {shown.slice(0, 150).map((c) => {
                const status = statusLine(c);
                const likely = (c.rating ?? 0) >= 45;
                return (
                  <li key={c.id} className="flex gap-3 px-5 py-4" data-testid="shortlist-row">
                    <Avatar name={c.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          {c.opportunityId ? <Link href={`/opportunities/${c.opportunityId}?returnTo=${encodeURIComponent(`/find?run=${runId}`)}`} className="text-[15px] font-semibold hover:text-[var(--accent)]">{c.name}</Link>
                            : <span className="text-[15px] font-semibold">{c.name}</span>}
                          <p className="text-[13px] text-[var(--text-2)]">{c.ratingRole ?? "Role not rated yet"}{c.website ? <span className="text-[var(--muted)]"> · {c.website}</span> : null}</p>
                        </div>
                        {c.rating !== null ? <RatingBadge score={c.rating} /> : <span className="rounded-full bg-[var(--subtle)] px-2.5 py-1 text-[12px] text-[var(--muted)]">Not rated</span>}
                      </div>
                      {c.ratingReason ? <p className="mt-1.5 text-[14px] text-[var(--text)]"><span className="font-semibold">{likely ? `Will buy ${product}: ` : c.rating === 0 ? "Not a buyer: " : "Unlikely: "}</span>{c.ratingReason}</p>
                        : c.quote ? <p className="mt-1.5 text-[13px] text-[var(--text-2)]">“{c.quote.slice(0, 180)}{c.quote.length > 180 ? "…" : ""}”</p> : null}
                      {c.alsoBuys.length ? <p className="mt-1 text-[13px] text-[var(--text-2)]"><span className="text-[var(--muted)]">Also buys: </span>{c.alsoBuys.join(", ")}</p> : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                        <span className={`rounded-full px-2 py-0.5 font-medium ${status.tone}`}>{status.text}</span>
                        {c.source?.url ? <a href={c.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--accent)]">Found in {(c.source.title ?? host(c.source.url)).slice(0, 60)}<ExternalLink size={12} aria-hidden /></a> : null}
                        <span className="ml-auto flex gap-2">
                          {c.opportunityId ? <Link href={`/opportunities/${c.opportunityId}?returnTo=${encodeURIComponent(`/find?run=${runId}`)}`} className="btn btn-secondary btn-sm">Open lead<ArrowRight size={13} aria-hidden /></Link>
                            : CHECKABLE.includes(c.status) ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void act(c.id, { candidateId: c.id })} aria-label={`Check ${c.name} now`}>{busy === c.id ? "Starting…" : "Check now"}</button> : null}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="verified" className="card overflow-hidden">
            <h2 id="verified" className="px-5 pb-2 pt-5 text-[17px] font-semibold tracking-[-0.01em]">Verified buyers</h2>
            {data.buyers.length ? <ul className="divide-y divide-[var(--line)]">{data.buyers.map((b) => (
              <li key={b.opportunityId}>
                <Link href={`/opportunities/${b.opportunityId}?returnTo=${encodeURIComponent(`/find?run=${runId}`)}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--hover)]">
                  <Avatar name={b.name} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{b.name}</span><span className="block text-[12px] text-[var(--muted)]">Email: {b.email}</span></span>
                  <RatingBadge score={b.fit} />
                </Link>
              </li>))}</ul>
              : <p className="px-5 pb-5 text-[13px] text-[var(--muted)]">{data.running ? "A company becomes a verified buyer when its own website shows matching work." : "None yet. Check the top rated companies in the shortlist."}</p>}
          </section>
          <section aria-labelledby="activity" className="card overflow-hidden">
            <h2 id="activity" className="px-5 pb-2 pt-5 text-[17px] font-semibold tracking-[-0.01em]">Activity</h2>
            <ol className="max-h-[420px] space-y-3 overflow-y-auto px-5 pb-5">
              {data.events.slice(0, 20).map((e) => <li key={e.id} className="text-[13px]"><span className="tabular-nums text-[var(--muted)]">{clock(e.ts)}</span> <span className="text-[var(--text-2)]">{e.message}</span></li>)}
              {!data.events.length ? <li className="text-[13px] text-[var(--muted)]">No activity yet.</li> : null}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
