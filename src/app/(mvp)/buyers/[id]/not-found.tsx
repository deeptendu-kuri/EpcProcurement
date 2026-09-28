import Link from "next/link";

export default function BuyerNotFound() {
  return (
    <section className="surface flex flex-col items-center gap-3 rounded-xl px-4 py-12 text-center">
      <h1 className="text-xl font-bold text-[#101828]">Buyer not found</h1>
      <p className="text-sm text-[#475467]">It may have been merged with another buyer or removed.</p>
      <Link href="/search" className="btn btn-primary">
        Back to SuperSearch
      </Link>
    </section>
  );
}
