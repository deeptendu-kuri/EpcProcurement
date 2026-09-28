"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import type { LeadStatus, RejectReason } from "@/mvp/types";
import { patchLead } from "../api-client";
import { REJECT_REASON_LABELS, STATUS_LABELS } from "../labels";
import { EVENTS, emit } from "../shell/events";
import { useToast } from "../shell/toast";

/**
 * Accept / reject / move a lead with an optimistic status, an Undo toast and rollback on error
 * (docs/mvp/13 §2). Every change goes through PATCH /api/mvp/leads/[id], which records an activity.
 */
export function useLeadActions() {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [overrides, setOverrides] = useState<Record<string, LeadStatus>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const setOverride = useCallback((id: string, status: LeadStatus | null) => {
    setOverrides((current) => {
      const next = { ...current };
      if (status) next[id] = status;
      else delete next[id];
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
    emit(EVENTS.refreshStatus);
  }, [router]);

  const change = useCallback(
    async (id: string, from: LeadStatus, to: LeadStatus, options: { rejectReason?: RejectReason; label?: string } = {}) => {
      if (from === to) return;
      setOverride(id, to);
      setBusy((current) => ({ ...current, [id]: true }));
      try {
        await patchLead(id, { status: to, ...(to === "rejected" ? { rejectReason: options.rejectReason ?? "other" } : {}) });
        const message =
          to === "rejected"
            ? `Marked not relevant${options.rejectReason ? ` (${REJECT_REASON_LABELS[options.rejectReason]})` : ""}`
            : to === "accepted" && from === "new"
              ? "Marked as a good lead"
              : `Moved to ${STATUS_LABELS[to]}`;
        toast.show({
          message: options.label ? `${message}: ${options.label}` : message,
          action: {
            label: "Undo",
            onClick: () => {
              setOverride(id, from);
              patchLead(id, { status: from, rejectReason: null })
                .then(() => {
                  toast.show({ message: `Back to ${STATUS_LABELS[from]}` });
                  refresh();
                })
                .catch((error: unknown) => {
                  setOverride(id, to);
                  toast.show({ message: error instanceof Error ? error.message : "Undo failed.", tone: "error" });
                });
            },
          },
        });
        refresh();
      } catch (error) {
        setOverride(id, null); // roll back
        toast.show({ message: error instanceof Error ? error.message : "Could not update the buyer.", tone: "error" });
      } finally {
        setBusy((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      }
    },
    [refresh, setOverride, toast],
  );

  return {
    /** Status to show for a lead (optimistic value while a change is saving). */
    statusOf: (id: string, status: LeadStatus) => overrides[id] ?? status,
    isBusy: (id: string) => Boolean(busy[id]),
    accept: (id: string, from: LeadStatus, label?: string) => change(id, from, "accepted", { label }),
    reject: (id: string, from: LeadStatus, reason: RejectReason, label?: string) => change(id, from, "rejected", { rejectReason: reason, label }),
    move: (id: string, from: LeadStatus, to: LeadStatus, label?: string) => change(id, from, to, { label }),
  };
}
