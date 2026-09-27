import { connection } from "next/server";
import { isDemoMode } from "@/mvp/config/env";
import { MvpSidebar } from "./sidebar";

/**
 * Shell for the showcase slice: left sidebar (Find, Leads, Settings), demo-mode badge, logout.
 * /login renders without the sidebar (handled in MvpSidebar).
 */
export default async function MvpLayout({ children }: { children: React.ReactNode }) {
  await connection(); // env (demo mode) is read per request, not baked in at build time
  return <MvpSidebar demoMode={isDemoMode()}>{children}</MvpSidebar>;
}
