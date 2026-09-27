import { NextResponse } from "next/server";
import { listSavedSearches } from "@/mvp/saved-searches";
import { getRunQueue, savedSearchJob } from "@/mvp/scheduler";
import { NO_STORE, serverError } from "../_shared/http";

/**
 * POST /api/mvp/refresh — "Refresh now" on the Overview: queue every active saved search (one run at a
 * time) → 202 { queued, tickets }. `queued` is 0 when there is no active saved search.
 */
export async function POST() {
  try {
    const active = (await listSavedSearches()).filter((search) => search.active);
    const queue = getRunQueue();
    const tickets = active.map((search) => queue.enqueue(savedSearchJob(search)));
    return NextResponse.json(
      { queued: tickets.length, tickets: tickets.map((ticket) => ({ ticketId: ticket.id, runId: ticket.runId, state: ticket.state })) },
      { status: 202, headers: NO_STORE },
    );
  } catch (error) {
    return serverError("refresh", error, "Refresh could not start. Try again in a moment.");
  }
}
