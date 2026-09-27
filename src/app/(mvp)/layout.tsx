import "driver.js/dist/driver.css";
import { connection } from "next/server";
import { isDemoMode } from "@/mvp/config/env";
import { getAppStatus } from "@/mvp/scheduler/status";
import type { AppStatus } from "@/mvp/types";
import { AppShell } from "@/components/mvp/shell/app-shell";

const NO_STATUS: AppStatus = { lastFinishedAt: null, newGenuine: 0, queue: { running: false, waiting: 0, runId: null } };

/**
 * CRM shell for the app (docs/mvp/13 §2): sidebar, top bar, toasts, shortcuts and the guided tour.
 * /login renders without it (handled in AppShell).
 */
export default async function MvpLayout({ children }: { children: React.ReactNode }) {
  await connection(); // env (demo mode) and status are read per request, not baked in at build time
  let status = NO_STATUS;
  try {
    status = await getAppStatus();
  } catch (error) {
    console.error("[layout] status unavailable", error);
  }
  return (
    <AppShell demoMode={isDemoMode()} initialStatus={status}>
      {children}
    </AppShell>
  );
}
