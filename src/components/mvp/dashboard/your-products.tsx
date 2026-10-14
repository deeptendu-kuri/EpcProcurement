import Link from "next/link";
import { Package, Search, Settings2 } from "lucide-react";
import type { OurProduct } from "@/mvp/products/our-products";

/** Dashboard quick access (docs/mvp/22 §3.15): his products as one-click searches; managed in Settings. */
export function YourProducts({ products }: { products: OurProduct[] }) {
  return (
    <section aria-labelledby="your-products" className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="your-products" className="flex items-center gap-2 text-[17px] font-semibold"><Package size={17} aria-hidden />Your products</h2>
        <Link href="/settings?tab=products" className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--accent)]"><Settings2 size={14} aria-hidden />Manage</Link>
      </div>
      {products.length ? (
        <ul className="flex flex-wrap gap-2">
          {products.map((p) => (
            <li key={p.id}>
              <Link href={`/find?q=${encodeURIComponent(p.name)}`} className="chip gap-1 hover:bg-[var(--hover)]" title={`Search buyers of ${p.name}`}>
                <Search size={12} aria-hidden />{p.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-[14px] text-[var(--muted)]">Add the products you specialise in, in Settings.</p>}
      <p className="text-[12px] text-[var(--muted)]">Click one to search its buyers. You can search any other product too, from Find buyers.</p>
    </section>
  );
}
