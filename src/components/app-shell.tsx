"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BarChart3, Building2, DatabaseZap, Download, Gauge, ListChecks, Menu, Radio, Search, Settings, UsersRound, X } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navigationRef = useRef<HTMLDialogElement>(null);
  const isActive = (href: string) => pathname === href
    || (href !== "/legacy" && pathname.startsWith(`${href}/`))
    || (href === "/legacy/leads" && pathname.startsWith("/legacy/companies/"));
  useEffect(() => {
    const dialog = navigationRef.current;
    if (!mobileNavOpen || !dialog) return;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [mobileNavOpen]);
  const navGroups = [
    {
      label: "Workspace",
      items: [
        { href: "/legacy", label: "Dashboard", icon: Gauge },
        { href: "/legacy/discovery", label: "SuperSearch", icon: Search },
        { href: "/legacy/leads", label: "Leads CRM", icon: UsersRound },
        { href: "/legacy/lead-lists", label: "Lead Lists", icon: ListChecks },
      ],
    },
    {
      label: "Operations",
      items: [
        { href: "/legacy/signals", label: "Signals", icon: Radio },
        { href: "/legacy/enrichment", label: "Enrichment", icon: DatabaseZap },
        { href: "/legacy/exports", label: "Exports", icon: Download },
      ],
    },
    {
      label: "System",
      items: [
        { href: "/legacy/usage", label: "Run Health", icon: BarChart3 },
        { href: "/legacy/settings", label: "Settings", icon: Settings },
      ],
    },
  ] as const;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f6f8fb]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3">Skip to content</a>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#e1e6ef] bg-white px-4 shadow-sm xl:hidden">
        <Link href="/legacy" className="flex min-w-0 items-center gap-2.5" aria-label="Industrial Buyer AI dashboard">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#2563eb] text-white">
            <Building2 size={17} />
          </span>
          <span className="truncate text-sm font-bold text-[#101828]">Industrial Buyer AI</span>
        </Link>
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(true)}
          className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#d0d5dd] bg-white text-[#344054]"
        >
          <Menu size={19} />
        </button>
      </header>

      {mobileNavOpen ? (
        <dialog ref={navigationRef} aria-label="Main navigation" onCancel={(event) => { event.preventDefault(); setMobileNavOpen(false); }} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0">
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => setMobileNavOpen(false)} className="absolute inset-0 bg-[#101828]/35" />
          <aside className="relative flex h-full w-[min(320px,86vw)] flex-col overflow-y-auto border-r border-[#e1e6ef] bg-white shadow-xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#e4e7ec] px-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#2563eb] text-white"><Building2 size={17} /></span>
                <span className="text-sm font-bold text-[#101828]">Industrial Buyer AI</span>
              </div>
              <button type="button" autoFocus aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-[#475467] hover:bg-[#f5f7fb]">
                <X size={19} />
              </button>
            </div>
            <nav className="space-y-5 px-3 py-4">
              {navGroups.map((group) => (
                <div key={group.label}>
                  <div className="px-3 pb-2 text-[11px] font-bold uppercase text-[#98a2b3]">{group.label}</div>
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={isActive(item.href) ? "page" : undefined}
                        onClick={() => setMobileNavOpen(false)}
                        className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors ${
                          isActive(item.href) ? "border border-[#c7d7fe] bg-[#eef4ff] text-[#1d4ed8]" : "text-[#344054] hover:bg-[#f5f7fb]"
                        }`}
                      >
                        <item.icon size={17} />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </aside>
        </dialog>
      ) : null}

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[240px] flex-col border-r border-[#e1e6ef] bg-white/96 text-[#101828] shadow-[8px_0_28px_rgb(16_24_40_/_0.04)] backdrop-blur xl:flex">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[#e4e7ec] px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2563eb] text-white shadow-sm">
            <Building2 size={19} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">Industrial Buyer AI</div>
            <div className="text-xs text-[#667085]">Search, enrich, export</div>
          </div>
        </div>
        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-normal text-[#98a2b3]">{group.label}</div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors ${
                      isActive(item.href) ? "border border-[#c7d7fe] bg-[#eef4ff] text-[#1d4ed8] shadow-sm" : "text-[#344054] hover:bg-[#f5f7fb] hover:text-[#101828]"
                    }`}
                  >
                    <item.icon size={17} />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <main id="main-content" tabIndex={-1} className="min-w-0 xl:pl-[240px]">
        <div className="mx-auto max-w-[1760px] px-3 py-4 sm:px-5 lg:px-6">{children}</div>
      </main>
    </div>
  );
}
