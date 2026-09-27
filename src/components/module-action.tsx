import Link from "next/link";

export function ModuleAction({ label, moduleTitle }: { label: string; moduleTitle: string }) {
  const destination = label === "Export CSV"
    ? { href: "/lead-lists", label: "Choose a list to export" }
    : label === "Queue Enrichment"
      ? { href: "/leads", label: "Open lead pipeline" }
      : null;

  if (destination) return <Link href={destination.href} className="btn-primary focus-ring inline-flex min-h-10 w-fit items-center justify-center rounded-md px-4 text-sm font-semibold">{destination.label}</Link>;

  return (
    <>
      <button type="button" disabled title={`${moduleTitle}: configuration is not yet available`} className="control inline-flex h-10 w-fit cursor-not-allowed items-center justify-center rounded-md px-4 text-sm font-semibold opacity-60">
        {label}
      </button>

      <span className="text-xs text-[#667085]">Configuration not yet available</span>

    </>
  );
}
