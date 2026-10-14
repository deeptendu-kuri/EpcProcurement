"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { apiJson } from "@/components/mvp/api-client";
import type { OurProduct } from "@/mvp/products/our-products";

/**
 * Settings → Our products (docs/mvp/22 §3.15): what he specialises in. Shortcuts on the Dashboard and the
 * "We also supply…" line in emails; never a limit on what he can search.
 */
export function OurProductsEditor({ initial }: { initial: OurProduct[] }) {
  const [products, setProducts] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const { product } = await apiJson<{ product: OurProduct }>("/api/mvp/products", { method: "POST", body: { name } });
      setProducts((list) => [...list.filter((p) => p.id !== product.id), product]);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The product could not be saved.");
    } finally { setBusy(false); }
  }
  async function remove(product: OurProduct) {
    setBusy(true); setError(null);
    try {
      await apiJson(`/api/mvp/products/${product.id}`, { method: "DELETE" });
      setProducts((list) => list.filter((p) => p.id !== product.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The product could not be removed.");
    } finally { setBusy(false); }
  }

  return (
    <section className="card flex flex-col gap-4 p-5" aria-labelledby="our-products">
      <div>
        <h2 id="our-products" className="text-[17px] font-semibold">Our products</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          What you specialise in. They appear on the Dashboard as one-click searches and in emails as what else you supply.
          You can still search any product, in any country, from Find buyers.
        </p>
      </div>
      {products.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Your products">
          {products.map((p) => (
            <li key={p.id} className="chip gap-1 pr-1">
              <Link href={`/find?q=${encodeURIComponent(p.name)}`} className="inline-flex items-center gap-1" title={`Search buyers of ${p.name}`}>
                <Search size={12} aria-hidden />{p.name}
              </Link>
              <button type="button" onClick={() => remove(p)} disabled={busy} aria-label={`Remove ${p.name}`} className="rounded p-0.5 hover:bg-[var(--hover)]">
                <X size={13} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-[var(--muted)]">No products yet. Add what you sell.</p>}
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <label htmlFor="new-product" className="sr-only">Product name</label>
        <input id="new-product" className="control h-10 min-w-[240px] flex-1 px-3" placeholder="e.g. Shell and tube heat exchangers"
          value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary h-10 px-4" disabled={busy || name.trim().length < 2}><Plus size={15} aria-hidden />Add product</button>
      </form>
      {error ? <p role="alert" className="text-sm text-[var(--bad,#b42318)]">{error}</p> : null}
    </section>
  );
}
