"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleSlash, ExternalLink, Loader2, Pause, Plus, Sparkles, TriangleAlert } from "lucide-react";
import type { SearchWorkspaceData } from "@/mvp/research/workspace";
import type { FoundCompany } from "@/mvp/research/found";
import { marketName } from "@/mvp/config/markets";
import { apiJson } from "../api-client";
import { Avatar, RatingBadge } from "../search/results-table";
import { SearchControls, type SearchKind } from "./search-controls";

const POLL_MS = 4000;
type Filter = "likely" | "all" | "not";
type TypeFilter = "any" | "end_user" | "chain" | "owner" | "reseller";
/** Doc 19 buyer types, in the words the client uses. */
export const BUYER_TYPE_LABEL: Record<NonNullable<FoundCompany["buyerType"]>, string> = {
  end_user: "Uses it", contractor: "Main contractor", subcontractor: "Subcontractor", owner: "Owner / operator",
  reseller: "Stockist / reseller", competitor: "Competitor", not_buyer: "Not a buyer",
};
const TYPE_TONE: Record<NonNullable<FoundCompany["buyerType"]>, string> = {
  end_user: "bg-[var(--good-bg)] text-[var(--good)]", contractor: "bg-[var(--info-bg)] text-[var(--info)]", subcontractor: "bg-[var(--info-bg)] text-[var(--info)]",
  owner: "bg-[var(--accent-soft)] text-[var(--accent)]", reseller: "bg-[var(--warn-bg)] text-[var(--warn)]", competitor: "bg-[var(--bad-bg)] text-[var(--bad)]", not_buyer: "bg-[var(--subtle)] text-[var(--muted)]",
};
const inType = (c: FoundCompany, t: TypeFilter) => t === "any" || (t === "chain" ? c.buyerType === "contractor" || c.buyerType === "subcontractor" : c.buyerType === t);
const CHECKABLE: FoundCompany["status"][] = ["not_checked", "no_website", "unreadable"];
/** Stockists and traders are listed as secondary and never checked or saved as leads. */
const secondary = (c: FoundCompany) => c.buyerType === "reseller" && !c.opportunityId;
const checkable = (c: FoundCompany) => CHECKABLE.includes(c.status) && !secondary(c);
/** A likely or listed lead that is saved but not yet proven by its own website can be verified. */
const verifiable = (c: FoundCompany) => Boolean(c.opportunityId) && (c.verification === "rating" || c.verification === "listing") && c.status !== "checking" && !secondary(c);
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
  if (secondary(c)) return { text: "Stockist · secondary, not a lead", tone: "bg-[var(--subtle)] text-[var(--text-2)]" };
  if (c.opportunityId && c.verification === "rating") return { text: "Lead · likely, not verified", tone: "bg-[var(--warn-bg)] text-[var(--warn)]" };
  if (c.opportunityId && c.verification === "listing") return { text: "Lead · its listed work", tone: "bg-[var(--info-bg)] text-[var(--info)]" };
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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("any");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tick, setTick] = useState(0);
  const product = data.run.product ?? data.run.query;
  // A paused search is polled too: steps already running finish and their leads appear.
  const live = data.running || data.paused || data.counts.checking > 0;

  useEffect(() => {
    const controller = new AbortController();
    if (tick === 0) return () => controller.abort();
    apiJson<SearchWorkspaceData>(`/api/mvp/research/${runId}/workspace`, { signal: controller.signal }).then((next) => { if (next?.run) setData(next); }).catch(() => undefined);
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

  const kind: SearchKind = data.paused ? "paused" : data.running ? "running" : "finished";
  // Show the new state at once; the next poll brings the details.
  const controlled = (next: SearchKind) => {
    setData((d) => ({ ...d, running: next === "running", paused: next === "paused",
      phase: next === "paused" ? "Paused" : next === "running" ? "Starting" : next === "stopped" ? "Stopped" : "Finished",
      run: { ...d.run, status: next === "stopped" ? "cancelled" : next === "finished" ? "done" : d.run.status, statusText: next === "stopped" ? "Stopped by you" : next === "finished" ? "Finished" : d.run.statusText } }));
    setTick((n) => n + 1);
  };

  const relevant = data.companies.filter((c) => c.relevant);
  const lists: Record<Filter, FoundCompany[]> = {
    likely: relevant.filter((c) => c.opportunityId || (c.rating ?? 0) >= 45),
    all: relevant,
    not: data.companies.filter((c) => !c.relevant),
  };
  const shown = filter === "not" ? lists.not : lists[filter].filter((c) => inType(c, typeFilter));
  const typeCounts = (["end_user", "chain", "owner", "reseller"] as TypeFilter[]).map((t) => [t, lists[filter === "not" ? "all" : filter].filter((c) => inType(c, t)).length] as const);
  const unrated = data.companies.filter((c) => c.rating === null || c.guessed).length;
  const nextToCheck = relevant.filter((c) => (c.opportunityId ? verifiable(c) : checkable(c)) && (c.rating === null || c.rating >= 25)).slice(0, 5);
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
            {data.paused ? <Pause size={16} className="text-[var(--warn)]" aria-hidden />
              : data.running ? <Loader2 size={16} className="animate-spin text-[var(--accent)]" aria-hidden />
              : data.run.status === "done" ? <CheckCircle2 size={16} className="text-[var(--good)]" aria-hidden />
              : data.run.status === "cancelled" ? <CircleSlash size={16} className="text-[var(--muted)]" aria-hidden />
              : <TriangleAlert size={16} className="text-[var(--warn)]" aria-hidden />}
            {data.paused ? `Paused · ${data.leads} ${data.leads === 1 ? "lead" : "leads"} saved` : data.running ? `Running · ${data.phase}` : data.run.statusText}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SearchControls runId={runId} kind={kind} onDone={controlled} />
          <Link href="/find" className="btn btn-secondary h-10 px-4"><Plus size={16} aria-hidden />New search</Link>
          <Link href={`/crm?run=${runId}`} className="btn btn-primary h-10 px-4">See leads ({data.leads})<ArrowRight size={16} aria-hidden /></Link>
        </div>
      </header>

      {data.paused ? (
        <p className="rounded-xl bg-[var(--warn-bg)] px-4 py-3 text-[14px] text-[var(--warn)]">
          {data.run.stopReason ?? "Paused."} Verified leads can be emailed now. <Link href={`/crm?run=${runId}`} className="font-medium underline">Review the leads</Link>, then Resume to search further or Finish now.
        </p>
      ) : data.running && data.pauseAfter ? (
        <p className="text-[13px] text-[var(--muted)]">Pauses on its own at {data.pauseAfter} leads ({data.leads} so far).</p>
      ) : null}

      <section aria-label="Search status" className="card grid grid-cols-2 divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
        <Stat label="Time" value={data.minutes === null ? "—" : `${data.minutes} min`} sub={data.running ? "and counting" : data.run.finishedAt ? `Ended ${clock(data.run.finishedAt)} UTC` : undefined} />
        <Stat label="AI tokens used" value={compact(u.tokens)} sub={u.tokenLimit ? `of ${compact(u.tokenLimit)} for this search · ${u.aiCalls} calls` : `${u.aiCalls} AI calls`} ratio={u.tokenLimit ? u.tokens / u.tokenLimit : null} />
        <Stat label="Pages read" value={String(u.pagesRead)} sub={u.pageLimit ? `of ${u.pageLimit} allowed` : undefined} ratio={u.pageLimit ? u.pagesRead / u.pageLimit : null} />
        <Stat label="Companies found" value={String(data.counts.found)} sub={data.counts.notBuyers ? `${data.counts.notBuyers} other names set aside` : undefined} />
        <Stat label="Likely buyers" value={String(data.counts.likely)} sub={`rated from what the sources say`} />
        <Stat label="Verified buyers" value={String(data.counts.verified)} sub="own website shows matching work" />
      </section>

      {data.countries.length > 1 ? (
        <section aria-label="Countries" className="flex flex-wrap gap-2">
          {data.countries.map((c) => (
            <span key={c.code} className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[13px]">
              <span className="font-medium">{marketName(c.code)}</span>
              <span className="tabular-nums text-[var(--muted)]">{c.searchesDone}/{c.searchesTotal} searches{c.verified ? ` · ${c.verified} verified` : ""}</span>
              {data.running && c.searchesDone < c.searchesTotal ? <Loader2 size={12} className="animate-spin text-[var(--accent)]" aria-hidden /> : null}
            </span>
          ))}
        </section>
      ) : null}

      {data.run.error ? <p role="alert" className="rounded-xl bg-[var(--bad-bg)] px-4 py-3 text-[14px] text-[var(--bad)]">{data.run.error}</p> : null}
      {!data.running && !data.paused && data.run.stopReason ? <p className="rounded-xl bg-[var(--warn-bg)] px-4 py-3 text-[13px] text-[var(--warn)]">{data.run.stopReason} Results are a batch, not the whole market.</p> : null}

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
          {filter !== "not" ? (
            <div className="mx-5 mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Buyer type">
              {([["any", "All types"], ...typeCounts.map(([t]) => [t, t === "end_user" ? "Use it" : t === "chain" ? "Contractors & subcontractors" : t === "owner" ? "Owners" : "Stockists"])] as [TypeFilter, string][]).map(([t, label]) => {
                const n = t === "any" ? null : typeCounts.find(([k]) => k === t)?.[1] ?? 0;
                if (n === 0 && typeFilter !== t) return null;
                return <button key={t} type="button" aria-pressed={typeFilter === t} onClick={() => setTypeFilter(t)}
                  className={`rounded-full border px-2.5 py-1 text-[12.5px] ${typeFilter === t ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent)]" : "border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--hover)]"}`}>
                  {label}{n !== null ? <span className="ml-1 tabular-nums text-[var(--muted)]">{n}</span> : null}</button>;
              })}
            </div>
          ) : null}
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
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[11.5px]">
                            {c.buyerType ? <span className={`rounded-full px-2 py-0.5 font-medium ${TYPE_TONE[c.buyerType]}`}>{BUYER_TYPE_LABEL[c.buyerType]}</span> : null}
                            {c.match === "named" ? <span className="rounded-full bg-[var(--good-bg)] px-2 py-0.5 font-medium text-[var(--good)]">Names {data.variant.length ? data.variant.join(" · ") : "this product"}</span>
                              : c.match === "product" ? <span className="rounded-full bg-[var(--subtle)] px-2 py-0.5 text-[var(--text-2)]">Mentions {product}</span> : null}
                            {c.worksUnder ? <span className="rounded-full bg-[var(--subtle)] px-2 py-0.5 text-[var(--text-2)]">Works under {c.worksUnder}</span> : null}
                          </div>
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
                          {verifiable(c) ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void act(c.id, { candidateId: c.id })} aria-label={`Verify ${c.name}`}>{busy === c.id ? "Starting…" : "Verify"}</button> : null}
                          {c.opportunityId ? <Link href={`/opportunities/${c.opportunityId}?returnTo=${encodeURIComponent(`/find?run=${runId}`)}`} className="btn btn-secondary btn-sm">Open lead<ArrowRight size={13} aria-hidden /></Link>
                            : checkable(c) ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void act(c.id, { candidateId: c.id })} aria-label={`Check ${c.name} now`}>{busy === c.id ? "Starting…" : "Check now"}</button> : null}
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
