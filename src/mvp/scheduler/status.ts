import { getAppStatusCounts } from "@/mvp/repo";
import type { AppStatus } from "@/mvp/types";
import { getRunQueue } from "./index";

/** Top-bar status: last finished run ("Updated x min ago"), new Genuine leads, and the run queue. */
export async function getAppStatus(): Promise<AppStatus> {
  const counts = await getAppStatusCounts();
  const { running, waiting } = getRunQueue().snapshot();
  return {
    lastFinishedAt: counts.lastFinishedAt,
    newGenuine: counts.newGenuine,
    queue: { running: Boolean(running), waiting: waiting.length, runId: running?.runId ?? null },
  };
}
