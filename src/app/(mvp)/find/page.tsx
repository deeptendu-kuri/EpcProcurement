import Link from "next/link";
import { PackageSearch } from "lucide-react";
import { getActiveProducts, getClientProfile } from "@/mvp/config/profile";
import { marketName } from "@/mvp/config/markets";
import { isUuid, listRecentRuns } from "@/mvp/repo";
import { FindForm } from "@/components/mvp/find-form";
import { RecentRuns } from "@/components/mvp/recent-runs";

interface FindPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Find (docs/mvp/09 §4.1, 12 §1 F1): Search now with live progress, plus recent searches. */
export default async function FindPage({ searchParams }: FindPageProps) {
  const params = await searchParams;
  const profile = getClientProfile();
  const products = getActiveProducts();
  const runParam = typeof params.run === "string" && isUuid(params.run) ? params.run : null;

  if (!products.length) {
    return (
      <section className="surface flex flex-col items-center gap-3 rounded-xl px-4 py-12 text-center">
        <PackageSearch size={28} className="text-[#98a2b3]" aria-hidden />
        <h1 className="text-xl font-bold text-[#101828]">Find opportunities</h1>
        <p className="text-sm text-[#475467]">Add your products in Settings so we know what to look for.</p>
        <Link href="/settings" className="btn-primary focus-ring inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold">
          Open Settings
        </Link>
      </section>
    );
  }

  const runs = await listRecentRuns(10);
  const suggestions = [...new Set(products.flatMap((product) => [product.name, ...product.keywords.slice(0, 2)]))].slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-[#101828]">Find opportunities</h1>
      <FindForm
        markets={profile.markets.map((code) => ({ code, name: marketName(code) }))}
        suggestions={suggestions}
        initialRunId={runParam}
      />
      <RecentRuns runs={runs} />
    </div>
  );
}
