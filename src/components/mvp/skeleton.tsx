/** Skeleton loaders (docs/mvp/13 §2: never a blank screen). */

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/** Title + a few card rows (generic page). */
export function SkeletonRows({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}…</span>
      <SkeletonBlock className="h-7 w-48" />
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="card flex flex-col gap-2 p-4">
          <SkeletonBlock className="h-4 w-1/3" />
          <SkeletonBlock className="h-4 w-2/3" />
          <SkeletonBlock className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Tabs, filter bar and table rows (Leads). */
export function SkeletonTable({ rows = 8, label = "Loading leads" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">{label}…</span>
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-7 w-32" />
        <SkeletonBlock className="h-9 w-24" />
      </div>
      <SkeletonBlock className="h-9 w-full max-w-xl" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonBlock key={index} className="h-9 w-28" />
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="border-b border-[var(--line)] bg-[#fafafb] px-4 py-3">
          <SkeletonBlock className="h-3 w-2/3" />
        </div>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-4 border-b border-[#f0f1f3] px-4 py-3 last:border-0">
            <SkeletonBlock className="h-5 w-8" />
            <SkeletonBlock className="h-5 w-14" />
            <SkeletonBlock className="h-4 flex-1" />
            <SkeletonBlock className="hidden h-4 w-24 sm:block" />
            <SkeletonBlock className="hidden h-4 w-20 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** KPI tiles and two chart cards (Overview). */
export function SkeletonDashboard() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading overview…</span>
      <SkeletonBlock className="h-7 w-40" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="card flex flex-col gap-3 p-4">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-7 w-12" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="card flex flex-col gap-3 p-4">
            <SkeletonBlock className="h-4 w-32" />
            {Array.from({ length: 4 }, (__, row) => (
              <SkeletonBlock key={row} className="h-3 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Columns of cards (Pipeline board). */
export function SkeletonBoard() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading the pipeline…</span>
      <SkeletonBlock className="h-7 w-36" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex w-64 shrink-0 flex-col gap-2 rounded-xl bg-[#f1f2f4] p-2">
            <SkeletonBlock className="h-4 w-20" />
            {Array.from({ length: 3 - (index % 2) }, (__, card) => (
              <div key={card} className="card flex flex-col gap-2 p-3">
                <SkeletonBlock className="h-3 w-3/4" />
                <SkeletonBlock className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Two-column lead page. */
export function SkeletonLead() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading the lead…</span>
      <div className="card flex flex-col gap-3 p-4">
        <SkeletonBlock className="h-3 w-16" />
        <SkeletonBlock className="h-6 w-2/3" />
        <SkeletonBlock className="h-4 w-1/3" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="card flex flex-col gap-2 p-4">
              <SkeletonBlock className="h-3 w-32" />
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="h-4 w-4/5" />
            </div>
          ))}
        </div>
        <div className="card flex flex-col gap-3 p-4">
          <SkeletonBlock className="h-9 w-full" />
          <SkeletonBlock className="h-9 w-full" />
          <SkeletonBlock className="h-20 w-full" />
        </div>
      </div>
    </div>
  );
}
