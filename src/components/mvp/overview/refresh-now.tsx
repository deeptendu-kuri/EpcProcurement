"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { apiJson } from "../api-client";
import { useAppStatus } from "../shell/app-shell";
import { EVENTS, emit } from "../shell/events";
import { statusLabel } from "../shell/time-ago";
import { useToast } from "../shell/toast";

/** "Updated 12 min ago [Refresh now]" (docs/mvp/13 §3): runs every active saved search now. */
export function RefreshNow() {
  const router = useRouter();
  const toast = useToast();
  const { status, now } = useAppStatus();
  const [busy, setBusy] = useState(false);
  const searching = status.queue.running || status.queue.waiting > 0;

  const refresh = async () => {
    setBusy(true);
    try {
      const result = await apiJson<{ queued: number }>("/api/mvp/refresh", { method: "POST" });
      if (!result.queued) {
        toast.show({ message: "No saved searches yet. Save a search on Find to refresh it automatically." });
        router.push("/find");
      } else {
        toast.show({ message: `Refreshing ${result.queued} saved ${result.queued === 1 ? "search" : "searches"}…` });
        emit(EVENTS.refreshStatus);
      }
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : "Refresh could not start.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2" data-tour="overview-updated">
      <span className="text-sm text-[#6b7280]">
        {searching ? "Searching now…" : statusLabel(status.lastFinishedAt, now)}
      </span>
      <button type="button" onClick={refresh} disabled={busy} className="btn btn-secondary">
        {busy || searching ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
        Refresh now
      </button>
    </div>
  );
}
