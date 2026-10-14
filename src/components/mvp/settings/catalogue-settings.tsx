import type { ReactNode } from "react";
import type { OurProduct } from "@/mvp/products/our-products";
import { OurProductsEditor } from "./our-products";

/** One editable product list; the example search reference remains separate and read-only. */
export function CatalogueSettings({ products, reference }: { products: OurProduct[]; reference: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <OurProductsEditor initial={products} />
      <details className="card p-5">
        <summary className="cursor-pointer font-semibold">Reference materials &amp; standards (read-only)</summary>
        <p className="mt-2 text-sm text-[var(--muted)]">
          This example reference library adds technical context. Adding a product above saves it to your
          Dashboard and email context; it does not change these standards or limit what you can search.
        </p>
        <div className="mt-4">{reference}</div>
      </details>
    </div>
  );
}
