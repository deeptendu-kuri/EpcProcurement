"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import type { LeadClass } from "@/mvp/types";
import { apiJson } from "../api-client";
import { CLASS_LABELS } from "../labels";

interface SearchResult {
  id: string;
  buyerName: string;
  projectName: string | null;
  country: string | null;
  score: number | null;
  class: LeadClass;
}

export const GLOBAL_SEARCH_ID = "global-search";

/** Top-bar search (docs/mvp/13 §2): company or project → jumps to the lead. "/" focuses it. */
export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await apiJson<{ results: SearchResult[] }>(`/api/mvp/search?q=${encodeURIComponent(text)}`, { signal: controller.signal });
        setResults(data.results);
        setActive(data.results.length ? 0 : -1);
        setOpen(true);
      } catch {
        // aborted or offline: keep the old list
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    (document.getElementById(GLOBAL_SEARCH_ID) as HTMLInputElement | null)?.blur();
    router.push(href);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = results[active];
      if (hit) go(`/buyers/${hit.id}`);
      else if (query.trim()) go(`/search?q=${encodeURIComponent(query.trim())}`);
    } else if (event.key === "Escape") {
      setOpen(false);
      event.currentTarget.blur();
    }
  };

  const showList = open && query.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative w-full max-w-md" data-tour="global-search">
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" aria-hidden />
      <input
        id={GLOBAL_SEARCH_ID}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label="Search buyers by company or project"
        placeholder="Search saved leads…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (event.target.value.trim().length < 2) {
            setResults([]);
            setOpen(false);
          }
        }}
        onFocus={() => {
          if (results.length) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        className="input h-9 w-full pl-8 pr-10 text-sm"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
        {loading ? <Loader2 size={14} className="animate-spin text-[#9ca3af]" aria-hidden /> : <span className="hidden sm:inline-flex"><kbd className="kbd">/</kbd></span>}
      </span>
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching buyers"
          className="pop-in absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-80 overflow-auto rounded-xl border border-[var(--line)] bg-white p-1 shadow-lg"
        >
          {results.length ? (
            results.map((result, index) => (
              <li
                key={result.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  go(`/buyers/${result.id}`);
                }}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${index === active ? "bg-[var(--accent-soft)]" : ""}`}
              >
                <span className="w-7 shrink-0 text-right font-bold tabular-nums text-[#111827]">{result.score ?? "–"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[#111827]">{result.buyerName}</span>
                  <span className="block truncate text-xs text-[#6b7280]">
                    {[result.projectName, result.country ? marketName(result.country) : null].filter(Boolean).join(" · ") || "No project yet"}
                  </span>
                </span>
                <span className="chip shrink-0">{CLASS_LABELS[result.class]}</span>
              </li>
            ))
          ) : (
            <li className="px-3 py-3 text-sm text-[#6b7280]">{loading ? "Searching…" : "No buyers match. Press Enter to search SuperSearch."}</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
