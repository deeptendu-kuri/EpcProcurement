"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleSlash, Flag, Loader2, Pause, Play, Square, TriangleAlert } from "lucide-react";
import { apiJson } from "../api-client";
import { useToast } from "../shell/toast";

import type { SearchKind } from "../run-steps";
export type { SearchKind };
const KIND: Record<SearchKind, { label: string; tone: string }> = {
  running: { label: "Running", tone: "bg-[var(--info-bg)] text-[var(--info)]" },
  paused: { label: "Paused", tone: "bg-[var(--warn-bg)] text-[var(--warn)]" },
  finished: { label: "Finished", tone: "bg-[var(--good-bg)] text-[var(--good)]" },
  partial: { label: "Finished · partial", tone: "bg-[var(--good-bg)] text-[var(--good)]" },
  stopped: { label: "Stopped", tone: "bg-[var(--subtle)] text-[var(--text-2)]" },
  failed: { label: "Failed", tone: "bg-[var(--bad-bg)] text-[var(--bad)]" },
};
export function SearchStatusChip({ kind }: { kind: SearchKind }) {
  const Icon = kind === "running" ? Loader2 : kind === "paused" ? Pause : kind === "stopped" ? CircleSlash : kind === "failed" ? TriangleAlert : CheckCircle2;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${KIND[kind].tone}`}>
      <Icon size={12} className={kind === "running" ? "animate-spin" : undefined} aria-hidden />{KIND[kind].label}
    </span>
  );
}

type Action = "pause" | "resume" | "finish" | "cancel";
const CONFIRM: Partial<Record<Action, { title: string; text: string; button: string }>> = {
  finish: { title: "Finish this search now?", text: "Likely buyers already rated are saved as leads and automatic email can start. Nothing more is searched.", button: "Finish now" },
  cancel: { title: "Stop this search?", text: "Leads found so far are kept. Nothing more is searched and no email starts.", button: "Stop search" },
};
const DONE: Record<Action, string> = { pause: "Search paused", resume: "Search resumed", finish: "Search finished. Leads are ready", cancel: "Search stopped" };

/**
 * Pause / Resume / Finish now / Stop for one search (research/control.ts). Finish and Stop ask first.
 * `onDone` gets the new state; without it the page is refreshed.
 */
export function SearchControls({ runId, kind, onDone, size = "md" }: { runId: string; kind: SearchKind; onDone?: (kind: SearchKind) => void; size?: "sm" | "md" }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  if (kind !== "running" && kind !== "paused") return null;
  const btn = size === "sm" ? "btn btn-secondary btn-sm" : "btn btn-secondary h-10 px-4";
  const run = async (action: Action) => {
    setBusy(action);
    try {
      await apiJson(`/api/mvp/runs/${runId}`, { method: "POST", body: { action } });
      setConfirm(null);
      toast.show({ message: DONE[action], tone: "success" });
      const next: SearchKind = action === "pause" ? "paused" : action === "resume" ? "running" : action === "finish" ? "finished" : "stopped";
      if (onDone) onDone(next); else router.refresh();
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : "That did not work. Try again.", tone: "error" });
    } finally { setBusy(null); }
  };
  const ask = confirm ? CONFIRM[confirm] : null;
  if (ask && confirm) {
    return (
      <div role="alertdialog" aria-label={ask.title} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[13px]">
        <span className="min-w-0 flex-1"><span className="font-semibold">{ask.title}</span> <span className="text-[var(--text-2)]">{ask.text}</span></span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(null)} disabled={busy !== null}>Keep going</button>
        <button type="button" className={`btn btn-sm ${confirm === "cancel" ? "btn-danger" : "btn-primary"}`} onClick={() => void run(confirm)} disabled={busy !== null}>
          {busy === confirm ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}{ask.button}</button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Search controls">
      {kind === "running" ? <button type="button" className={btn} disabled={busy !== null} onClick={() => void run("pause")}>
        {busy === "pause" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Pause size={14} aria-hidden />}Pause</button>
        : <button type="button" className={btn} disabled={busy !== null} onClick={() => void run("resume")}>
        {busy === "resume" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Play size={14} aria-hidden />}Resume</button>}
      <button type="button" className={btn} disabled={busy !== null} onClick={() => setConfirm("finish")}><Flag size={14} aria-hidden />Finish now</button>
      <button type="button" className={btn} disabled={busy !== null} onClick={() => setConfirm("cancel")}><Square size={13} aria-hidden />Stop</button>
    </div>
  );
}
