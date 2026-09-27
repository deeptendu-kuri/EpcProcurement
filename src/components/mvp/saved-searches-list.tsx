"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pause, Play, Trash2, Zap } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import type { SavedSearchView } from "@/mvp/types";
import { apiJson } from "./api-client";
import { formatDateTime } from "./labels";
import { EVENTS, emit } from "./shell/events";
import { useToast } from "./shell/toast";

/** Saved searches with Run now / Pause / Delete (docs/mvp/13 §7). */
export function SavedSearchesList({ searches }: { searches: SavedSearchView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(id);
    try {
      await fn();
      toast.show({ message, tone: "success" });
      emit(EVENTS.refreshStatus);
      startTransition(() => router.refresh());
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : "That did not work.", tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="saved-searches" aria-labelledby="saved-searches-title" className="card scroll-mt-20">
      <div className="card-header">
        <h2 id="saved-searches-title" className="card-title">Saved searches</h2>
        <span className="text-xs text-[#9ca3af]">checked every 5 min · one search at a time</span>
      </div>
      {searches.length ? (
        <ul className="divide-y divide-[#f0f1f3]">
          {searches.map((search) => (
            <li key={search.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
              <div className="min-w-0 flex-[1_1_240px]">
                <p className="truncate font-semibold text-[#111827]">{search.name}</p>
                <p className="truncate text-xs text-[#6b7280]">
                  “{search.query}” · {search.markets.map(marketName).join(", ")} ·{" "}
                  {!search.active ? "Paused" : search.refresh_hours ? `every ${search.refresh_hours} h` : "manual"} ·{" "}
                  {search.last_run_at ? `last run ${formatDateTime(search.last_run_at)}` : "not run yet"}
                  {search.lastRunNewLeads !== null ? ` · ${search.lastRunNewLeads} new` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" disabled={busy === search.id} className="btn btn-secondary btn-sm" onClick={() => act(search.id, () => apiJson(`/api/mvp/saved-searches/${search.id}/run`, { method: "POST" }), "Search queued. Progress shows under Recent searches.")}>
                  <Zap size={13} aria-hidden /> Run now
                </button>
                <button
                  type="button"
                  disabled={busy === search.id}
                  className="btn btn-ghost btn-sm"
                  onClick={() => act(search.id, () => apiJson(`/api/mvp/saved-searches/${search.id}`, { method: "PATCH", body: { active: !search.active } }), search.active ? "Paused." : "Resumed.")}
                >
                  {search.active ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
                  {search.active ? "Pause" : "Resume"}
                </button>
                {confirmDelete === search.id ? (
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => act(search.id, () => apiJson(`/api/mvp/saved-searches/${search.id}`, { method: "DELETE" }), "Saved search deleted.")}>
                    Confirm delete
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Delete ${search.name}`} onClick={() => setConfirmDelete(search.id)}>
                    <Trash2 size={13} aria-hidden />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-5 text-sm text-[#6b7280]">No saved searches yet. Run a search above, then click “Save this search”.</p>
      )}
    </section>
  );
}
