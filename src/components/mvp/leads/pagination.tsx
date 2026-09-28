"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZES, pageNumbers, pageRange, type PageSize } from "./url-state";

/** "Showing 1–25 of 132", page size 10 / 25 / 50, Previous / numbers / Next (docs/mvp/13 §4). */
export function Pagination({
  page,
  size,
  total,
  onPage,
  onSize,
}: {
  page: number;
  size: number;
  total: number;
  onPage: (page: number) => void;
  /** Omit to hide the page-size picker (fixed page size). */
  onSize?: (size: PageSize) => void;
}) {
  const { from, to, pages } = pageRange(page, size, total);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm text-[#6b7280]" data-tour="leads-pages">
      <p className="tabular-nums" aria-live="polite">
        Showing <span className="font-semibold text-[#111827]">{from}–{to}</span> of <span className="font-semibold text-[#111827]">{total}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onSize ? <label htmlFor="page-size" className="flex items-center gap-1.5">
          Per page
          <select id="page-size" value={size} onChange={(event) => onSize(Number(event.target.value) as PageSize)} className="control h-8 px-2 text-sm">
            {PAGE_SIZES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label> : null}
        <div className="flex items-center gap-1">
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="btn btn-secondary btn-sm" aria-label="Previous page">
            <ChevronLeft size={14} aria-hidden />
            <span className="hidden sm:inline">Previous</span>
          </button>
          {pageNumbers(page, pages).map((value, index) =>
            value === "…" ? (
              <span key={`gap-${index}`} className="px-1" aria-hidden>…</span>
            ) : (
              <button
                key={value}
                type="button"
                onClick={() => onPage(value)}
                aria-current={value === page ? "page" : undefined}
                aria-label={`Page ${value}`}
                className={`btn btn-sm min-w-8 tabular-nums ${value === page ? "btn-primary" : "btn-ghost"}`}
              >
                {value}
              </button>
            ),
          )}
          <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="btn btn-secondary btn-sm" aria-label="Next page">
            <span className="hidden sm:inline">Next</span>
            <ChevronRight size={14} aria-hidden />
          </button>
        </div>
      </div>
    </nav>
  );
}
