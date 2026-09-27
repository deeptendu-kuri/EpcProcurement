import Link from "next/link";

export default function LeadNotFound() {
  return (
    <section className="surface flex flex-col items-center gap-3 rounded-xl px-4 py-12 text-center">
      <h1 className="text-xl font-bold text-[#101828]">Lead not found</h1>
      <p className="text-sm text-[#475467]">It may have been merged with another lead or removed.</p>
      <Link href="/leads" className="btn-primary focus-ring inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold">
        Back to leads
      </Link>
    </section>
  );
}
