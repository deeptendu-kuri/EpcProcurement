"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlaskConical, Loader2, Search } from "lucide-react";
import { apiJson } from "./api-client";
import { EVENTS, emit } from "./shell/events";
import { useToast } from "./shell/toast";

interface TicketResponse {
  ticketId: string;
  runId: string | null;
  position: number;
}

/** Where to watch a queued run: the Find page shows its progress (or its place in line). */
export function progressHref(ticket: Pick<TicketResponse, "ticketId" | "runId">): string {
  return ticket.runId ? `/find?run=${ticket.runId}` : `/find?ticket=${encodeURIComponent(ticket.ticketId)}`;
}

/**
 * "Load sample leads" (docs/mvp/13 U8): runs the pipeline over the offline sample documents. The leads
 * it makes carry the "Sample data" badge. Opens the Find page to show progress.
 */
export function LoadSampleButton({ variant = "secondary", className = "" }: { variant?: "primary" | "secondary"; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const ticket = await apiJson<TicketResponse>("/api/mvp/sample", { method: "POST" });
      toast.show({
        message: ticket.position > 0 ? `Sample leads will load after the search in progress.` : "Loading sample leads…",
      });
      emit(EVENTS.refreshStatus);
      router.push(progressHref(ticket));
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : "Sample leads could not be loaded.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={load}
      disabled={busy}
      data-tour="load-sample"
      className={`btn ${variant === "primary" ? "btn-primary" : "btn-secondary"} ${className}`}
      title="Adds example leads built from fictional documents, marked “Sample data”"
    >
      {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <FlaskConical size={15} aria-hidden />}
      Load sample leads
    </button>
  );
}

/** Empty state with an icon, a sentence and next actions (never a blank screen). */
export function EmptyState({
  icon,
  title,
  text,
  showSample = false,
  showFind = true,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  text?: string;
  showSample?: boolean;
  showFind?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon ? <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--subtle)] text-[#6b7280]">{icon}</span> : null}
      <div>
        <h2 className="text-base font-semibold text-[#111827]">{title}</h2>
        {text ? <p className="mx-auto mt-1 max-w-md text-sm text-[#6b7280]">{text}</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {showFind ? (
          <Link href="/find" className="btn btn-primary">
            <Search size={15} aria-hidden />
            Find opportunities
          </Link>
        ) : null}
        {showSample ? <LoadSampleButton /> : null}
        {children}
      </div>
      {showSample ? <p className="text-xs text-[#9ca3af]">Sample leads come from fictional example documents and are marked “Sample data”.</p> : null}
    </div>
  );
}
