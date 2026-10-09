import { redirect } from "next/navigation";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** SuperSearch is the Leads page now (docs/mvp/17 §4.4); old links keep their filters. */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => typeof v === "string" ? [[k, v]] : Array.isArray(v) ? v.map((x) => [k, x]) : []));
  if (!query.has("run")) query.set("run", "all");
  redirect(`/crm?${query.toString()}`);
}
