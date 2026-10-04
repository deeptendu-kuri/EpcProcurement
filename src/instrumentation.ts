/**
 * Runs once when the Next.js server starts (docs/mvp/13 §7). Starts the saved-search scheduler in the
 * Node.js runtime only; the scheduler guards itself against a second start (globalThis) and does not
 * run during `next build`. Set MVP_SCHEDULER=off to disable it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startScheduler } = await import("./mvp/scheduler");
    startScheduler();
    const { startOutreachWorker } = await import("./mvp/email/worker");
    startOutreachWorker();
    const { startFunnelWorker } = await import("./mvp/automation/worker");
    startFunnelWorker();
  } catch (error) {
    console.error("[instrumentation] scheduler did not start", error);
  }
}
