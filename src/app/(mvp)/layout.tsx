import "driver.js/dist/driver.css";
import { connection } from "next/server";
import { isDemoMode } from "@/mvp/config/env";
import type { AppStatus } from "@/mvp/types";
import { AppShell } from "@/components/mvp/shell/app-shell";

const NO_STATUS: AppStatus = { lastFinishedAt: null, newGenuine: 0, queue: { running: false, waiting: 0, runId: null } };

/**
 * CRM shell for the app (docs/mvp/13 §2): sidebar, top bar, toasts, shortcuts and the guided tour.
 * /login renders without it (handled in AppShell).
 */
export default async function MvpLayout({ children }: { children: React.ReactNode }) {
  await connection(); // read environment at runtime, without putting database status on the navigation path
  return (
    <AppShell demoMode={isDemoMode()} initialStatus={NO_STATUS}>
      {children}
    </AppShell>
  );
}
