"use client";

import { useEffect, useState } from "react";

export const LEAD_SECTIONS = [
  { id: "why", label: "Why" },
  { id: "project", label: "Project" },
  { id: "supply-chain", label: "Project chain" },
  { id: "people", label: "People" },
  { id: "buyer-history", label: "Buyer history" },
  { id: "score", label: "Buyer fit" },
  { id: "compliance", label: "Can you sell?" },
  { id: "activity", label: "Activity" },
] as const;

/** In-page section nav (docs/mvp/13 §6): scrolls to a section and highlights the one in view. */
export function LeadSectionNav() {
  const [active, setActive] = useState<string>(LEAD_SECTIONS[0].id);

  useEffect(() => {
    const elements = LEAD_SECTIONS.map((section) => document.getElementById(section.id)).filter((el): el is HTMLElement => Boolean(el));
    if (!elements.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-180px 0px -55% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Sections" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {LEAD_SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={active === section.id ? "true" : undefined}
              onClick={(event) => {
                const target = document.getElementById(section.id);
                if (!target) return;
                event.preventDefault();
                if (target instanceof HTMLDetailsElement) target.open = true;
                target.scrollIntoView({ behavior: "smooth", block: "start" });
                history.replaceState(null, "", `#${section.id}`);
                setActive(section.id);
              }}
              className={`inline-flex h-8 items-center rounded-lg px-2.5 text-[0.8125rem] font-semibold transition-colors ${
                active === section.id ? "bg-[var(--accent-soft)] text-[var(--accent-2)]" : "text-[var(--text-3)] hover:bg-[var(--subtle)] hover:text-[var(--foreground)]"
              }`}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
