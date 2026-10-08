"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleHelp,
  CircleUser,
  Compass,
  FlaskConical,
  Keyboard,
  LayoutDashboard,
  ListChecks,
  Mail,
  Loader2,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  X,
  Zap,
} from "lucide-react";
import type { AppStatus } from "@/mvp/types";
import { apiJson } from "../api-client";
import { TourController } from "../tour/tour-controller";
import { EVENTS, emit, isTypingTarget, safeStorage } from "./events";
import { GLOBAL_SEARCH_ID, GlobalSearch } from "./global-search";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { statusLabel } from "./time-ago";
import { ToastProvider } from "./toast";

/** Menu (docs/mvp/14 §10): Overview · SuperSearch · Lead lists · Pipeline · Settings · Help. */
export const NAV = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, tour: "nav-overview", also: [] as string[] },
  { href: "/find", label: "New search", icon: Compass, tour: "nav-find", also: [] as string[] },
  { href: "/crm", label: "Leads", icon: ListChecks, tour: "nav-crm", also: ["/opportunities","/buyers","/pipeline"] },
  { href: "/search", label: "SuperSearch", icon: Search, tour: "nav-search", also: ["/lists"] },
  { href: "/outreach", label: "Email automation", icon: Mail, tour: "nav-outreach", also: [] as string[] },
  { href: "/settings", label: "Settings", icon: Settings, tour: "nav-settings", also: [] as string[] },
] as const;

/** Pages that use the whole screen (own top bar and filter panel, like the mockup). */
const FULL_BLEED = ["/search", "/lists"];

const COLLAPSED_KEY = "mvp.sidebar.collapsed";
const STATUS_POLL_MS = 60_000;

interface StatusContextValue {
  status: AppStatus;
  /** Re-read /api/mvp/status now. */
  refresh: () => void;
  /** Current time, ticking every 30 s (for "x min ago"). */
  now: number;
}

const EMPTY_STATUS: AppStatus = { lastFinishedAt: null, newGenuine: 0, queue: { running: false, waiting: 0, runId: null } };
const StatusContext = createContext<StatusContextValue>({ status: EMPTY_STATUS, refresh: () => undefined, now: 0 });

/** Last refresh, new Genuine leads and whether a search is running (from the shell). */
export function useAppStatus(): StatusContextValue {
  return useContext(StatusContext);
}

function useStatus(initial: AppStatus): StatusContextValue {
  const [status, setStatus] = useState(initial);
  const [now, setNow] = useState(0);
  const refresh = useCallback(() => {
    apiJson<AppStatus>("/api/mvp/status")
      .then((next) => {
        setStatus(next);
        setNow(Date.now());
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const poll = setInterval(refresh, STATUS_POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const onEvent = () => refresh();
    window.addEventListener(EVENTS.refreshStatus, onEvent);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener(EVENTS.refreshStatus, onEvent);
    };
  }, [refresh]);

  // Poll faster while a search runs, so "Updated x min ago" changes as soon as it finishes.
  useEffect(() => {
    if (!status.queue.running && !status.queue.waiting) return;
    const fast = setInterval(refresh, 5000);
    return () => clearInterval(fast);
  }, [status.queue.running, status.queue.waiting, refresh]);

  return useMemo(() => ({ status, refresh, now }), [status, refresh, now]);
}

function isActive(pathname: string, href: string, also: readonly string[] = []): boolean {
  return [href, ...also].some((base) => pathname === base || pathname.startsWith(`${base}/`));
}

function Menu_({ label, icon, children, align = "left", collapsed = false, tour }: {
  label: string;
  icon: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  collapsed?: boolean;
  tour?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative" data-tour={tour}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={collapsed ? label : undefined}
        className="nav-item w-full"
      >
        {icon}
        <span className={collapsed ? "sr-only" : ""}>{label}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className={`pop-in absolute z-50 min-w-52 rounded-xl border border-[var(--line)] bg-white p-1 shadow-lg ${
            align === "right" ? "right-0 top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)] left-0"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type={onClick ? "button" : "submit"}
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-[#374151] hover:bg-[var(--subtle)]"
    >
      {icon}
      {children}
    </button>
  );
}

function SidebarContent({
  pathname,
  collapsed,
  newGenuine,
  demoMode,
  onNavigate,
  onToggleCollapsed,
}: {
  pathname: string;
  collapsed: boolean;
  newGenuine: number;
  demoMode: boolean;
  onNavigate?: () => void;
  onToggleCollapsed?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className={`flex h-16 shrink-0 items-center gap-2.5 ${collapsed ? "justify-center px-2" : "border-b border-[var(--line)] px-4"}`}>
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2563eb] to-[#7c3aed] text-white shadow-sm">
          <Zap size={17} aria-hidden />
        </span>
        {!collapsed ? <span className="min-w-0 flex-1 truncate text-sm font-bold text-[#111827]">Buyer Intelligence</span> : null}
        {onToggleCollapsed && !collapsed ? (
          <button type="button" onClick={onToggleCollapsed} aria-label="Collapse sidebar" title="Collapse sidebar" className="btn btn-ghost btn-sm btn-icon">
            <PanelLeftClose size={16} />
          </button>
        ) : null}
      </div>

      <nav aria-label="Main navigation" className={`flex flex-1 flex-col overflow-y-auto p-2 ${collapsed ? "items-center gap-2" : "gap-0.5"}`}>
        {NAV.map((item) => {
          const active = isActive(pathname, item.href, item.also);
          const badge = item.href === "/crm" && newGenuine > 0 ? newGenuine : null;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              data-tour={item.tour}
              className={`nav-item relative ${collapsed ? "h-10 w-10 justify-center rounded-[10px] px-0" : ""}`}
            >
              <item.icon size={17} aria-hidden />
              <span className={collapsed ? "sr-only" : "flex-1"}>{item.label}</span>
              {badge ? (
                <span
                  className={`count-badge count-badge-accent ${collapsed ? "absolute -right-0.5 -top-0.5 scale-90" : ""}`}
                  title={`${badge} new ${badge === 1 ? "buyer" : "buyers"} ready to approach`}
                >
                  {badge > 99 ? "99+" : badge}
                  <span className="sr-only"> new buyers ready to approach</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 border-t border-[var(--line)] p-2">
        {demoMode ? (
          <span
            title="No AI keys configured: facts come from the rules-based extractor and drafts from templates."
            className={`mb-1 inline-flex items-center gap-1.5 rounded-lg border border-[#fedf89] bg-[#fffaeb] px-2 py-1.5 text-xs font-bold text-[#b54708] ${collapsed ? "justify-center" : ""}`}
          >
            <FlaskConical size={13} aria-hidden />
            <span className={collapsed ? "sr-only" : ""}>Demo mode: AI simulated</span>
          </span>
        ) : null}
        <Menu_ label="Help" icon={<CircleHelp size={17} aria-hidden />} collapsed={collapsed} tour="nav-help">
          {(close) => (
            <>
              <MenuItem
                icon={<Compass size={15} aria-hidden />}
                onClick={() => {
                  close();
                  onNavigate?.();
                  emit(EVENTS.startTour);
                }}
              >
                Take the tour
              </MenuItem>
              <MenuItem
                icon={<Keyboard size={15} aria-hidden />}
                onClick={() => {
                  close();
                  onNavigate?.();
                  emit(EVENTS.openShortcuts);
                }}
              >
                Keyboard shortcuts
              </MenuItem>
            </>
          )}
        </Menu_>
        <Menu_ label="Account" icon={<CircleUser size={17} aria-hidden />} collapsed={collapsed}>
          {() => (
            <form method="post" action="/api/mvp/logout">
              <MenuItem icon={<LogOut size={15} aria-hidden />}>Log out</MenuItem>
            </form>
          )}
        </Menu_>
        {onToggleCollapsed && collapsed ? (
          <button type="button" onClick={onToggleCollapsed} aria-label="Expand sidebar" title="Expand sidebar" className="nav-item justify-center">
            <PanelLeftOpen size={17} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The CRM shell (docs/mvp/13 §2): collapsible sidebar (hamburger on phones), top bar with global search,
 * "Search now" and "Updated x min ago", user menu, toasts, keyboard shortcuts and the guided tour.
 * /login renders without it.
 */
export function AppShell({ demoMode, initialStatus, children }: { demoMode: boolean; initialStatus: AppStatus; children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const statusValue = useStatus(initialStatus);
  const { status, now } = statusValue;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    // Restore the collapsed sidebar after hydration (per browser).
    const timer = setTimeout(() => {
      // Visible navigation labels are the default; collapse only by explicit preference.
      if (safeStorage.get(COLLAPSED_KEY) === "1") setCollapsed(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      safeStorage.set(COLLAPSED_KEY, value ? "0" : "1");
      return !value;
    });
  }, []);

  useEffect(() => {
    const openShortcuts = () => setShortcutsOpen(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key === "/") {
        const input = document.getElementById(GLOBAL_SEARCH_ID) as HTMLInputElement | null;
        if (input) {
          event.preventDefault();
          input.focus();
        }
      } else if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener(EVENTS.openShortcuts, openShortcuts);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(EVENTS.openShortcuts, openShortcuts);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (pathname === "/login") return <>{children}</>;

  const searching = status.queue.running || status.queue.waiting > 0;
  const fullBleed = FULL_BLEED.some((base) => pathname === base || pathname.startsWith(`${base}/`));

  return (
    <StatusContext.Provider value={statusValue}>
      <ToastProvider>
        <div className="min-h-screen md:flex">
          <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-white focus:p-3">
            Skip to content
          </a>

          <aside
            className={`hidden shrink-0 border-r border-[var(--line)] bg-white transition-[width] duration-200 md:sticky md:top-0 md:block md:h-screen ${
              collapsed ? "md:w-16" : "md:w-60"
            }`}
          >
            <SidebarContent
              pathname={pathname}
              collapsed={collapsed}
              newGenuine={status.newGenuine}
              demoMode={demoMode}
              onToggleCollapsed={toggleCollapsed}
            />
          </aside>

          {mobileOpen ? (
            <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
              <button type="button" aria-label="Close menu" className="backdrop absolute inset-0" onClick={() => setMobileOpen(false)} />
              <div className="slide-in-left relative h-full w-72 max-w-[85vw] bg-white shadow-lg">
                <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu" className="btn btn-ghost btn-sm btn-icon absolute right-2 top-3 z-10">
                  <X size={16} />
                </button>
                <SidebarContent
                  pathname={pathname}
                  collapsed={false}
                  newGenuine={status.newGenuine}
                  demoMode={demoMode}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <header className={`sticky top-0 z-30 flex h-14 items-center ${fullBleed ? "md:hidden" : ""} gap-2 border-b border-[var(--line)] bg-white/90 px-3 backdrop-blur sm:gap-3 lg:px-6`}>
              {/* Wrapper carries md:hidden: the unlayered .btn display rule would beat a utility on the button itself. */}
              <span className="contents md:hidden">
                <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu" className="btn btn-ghost btn-icon">
                  <Menu size={18} />
                </button>
              </span>
              <GlobalSearch />
              <div className="ml-auto flex items-center gap-2">
                <span
                  className="hidden items-center gap-1.5 whitespace-nowrap text-xs font-medium text-[#6b7280] lg:inline-flex"
                  data-tour="updated-ago"
                  title={status.lastFinishedAt ? new Date(status.lastFinishedAt).toUTCString() : "No finished search yet"}
                >
                  {searching ? <Loader2 size={13} className="animate-spin text-[var(--accent)]" aria-hidden /> : null}
                  {searching ? "Searching…" : statusLabel(status.lastFinishedAt, now)}
                </span>
                {pathname !== "/find" ? <Link href="/find" className="btn btn-primary" data-tour="topbar-search-now" title="Start a new product search">
                  <Search size={15} aria-hidden />
                  <span className="hidden sm:inline">New search</span>
                </Link> : null}
              </div>
            </header>

            <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
              {fullBleed ? (
                <div key={pathname} className="fade-in w-full">
                  {children}
                </div>
              ) : (
                <div key={pathname} className="fade-in mx-auto w-full max-w-[1440px] px-4 py-5 lg:px-6">
                  {children}
                </div>
              )}
            </main>
          </div>
        </div>
        {shortcutsOpen ? <ShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
        <TourController />
      </ToastProvider>
    </StatusContext.Provider>
  );
}
