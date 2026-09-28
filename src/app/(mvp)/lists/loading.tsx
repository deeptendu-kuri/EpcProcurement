export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex h-dvh">
      <span className="sr-only">Loading SuperSearch…</span>
      <div className="hidden w-[300px] shrink-0 flex-col gap-3 border-r border-[var(--line)] p-5 lg:flex">
        <div className="skeleton h-7 w-40" />
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton h-16" />)}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-9 w-full max-w-3xl" />
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton h-14" />)}
      </div>
    </div>
  );
}
