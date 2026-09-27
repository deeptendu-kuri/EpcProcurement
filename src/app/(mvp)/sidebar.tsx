"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, FlaskConical, LogOut, Search, Settings, UsersRound } from "lucide-react";

const NAV = [
  { href: "/find", label: "Find", icon: Search },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function MvpSidebar({ demoMode, children }: { demoMode: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-screen bg-[#f6f8fb] md:flex">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3">
        Skip to content
      </a>
      <aside className="flex shrink-0 flex-col border-b border-[#e1e6ef] bg-white md:sticky md:top-0 md:h-screen md:w-[220px] md:border-b-0 md:border-r">
        <div className="flex h-14 items-center gap-2.5 border-b border-[#e4e7ec] px-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#2563eb] text-white">
            <Building2 size={17} />
          </span>
          <span className="truncate text-sm font-bold text-[#101828]">Buyer Intelligence</span>
        </div>

        <nav aria-label="Main navigation" className="flex gap-1 px-3 py-3 md:flex-1 md:flex-col">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors ${
                isActive(item.href)
                  ? "border border-[#c7d7fe] bg-[#eef4ff] text-[#1d4ed8]"
                  : "text-[#344054] hover:bg-[#f5f7fb] hover:text-[#101828]"
              }`}
            >
              <item.icon size={17} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center justify-between gap-2 border-t border-[#e4e7ec] px-3 py-3 md:flex-col md:items-stretch">
          {demoMode ? (
            <span
              title="No AI keys configured: facts come from the rules-based extractor and drafts from templates."
              className="inline-flex items-center gap-1.5 rounded-md border border-[#fedf89] bg-[#fffaeb] px-2 py-1 text-xs font-bold text-[#b54708]"
            >
              <FlaskConical size={13} />
              Demo mode: AI simulated
            </span>
          ) : null}
          <form method="post" action="/api/mvp/logout">
            <button
              type="submit"
              className="focus-ring inline-flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm font-semibold text-[#475467] hover:bg-[#f5f7fb]"
            >
              <LogOut size={16} />
              Log out
            </button>
          </form>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6">{children}</div>
      </main>
    </div>
  );
}
