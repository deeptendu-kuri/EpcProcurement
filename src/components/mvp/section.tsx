/** A collapsible lead-page section (09 §4.3: each section can be collapsed). Uses native <details>. */
export function Section({
  id,
  title,
  aside,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  aside?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={defaultOpen} className="surface group scroll-mt-40 rounded-xl">
      <summary className="focus-ring flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 [&::-webkit-details-marker]:hidden">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#475467]">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">▸</span>
          {title}
        </h2>
        {aside ? <div className="text-sm text-[#475467]">{aside}</div> : null}
      </summary>
      <div className="border-t border-[#edf1f6] px-4 py-3 text-[15px] text-[#344054]">{children}</div>
    </details>
  );
}

/** Grey "Not found" for unknown values (09 §5). */
export function NotFound({ text = "Not found" }: { text?: string }) {
  return <span className="text-[#98a2b3]">{text}</span>;
}
