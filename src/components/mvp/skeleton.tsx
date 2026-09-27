/** Skeleton rows while a screen loads (09 §5: never a blank screen). */
export function SkeletonRows({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}…</span>
      <div className="h-8 w-48 animate-pulse rounded-md bg-[#eaecf0]" />
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="surface flex flex-col gap-2 rounded-xl p-4">
          <div className="h-4 w-1/3 animate-pulse rounded bg-[#eaecf0]" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-[#f2f4f7]" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-[#f2f4f7]" />
        </div>
      ))}
    </div>
  );
}
