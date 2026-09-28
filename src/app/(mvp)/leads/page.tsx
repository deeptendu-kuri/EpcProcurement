import { redirect } from "next/navigation";

interface LeadsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Leads became Buyers on SuperSearch (docs/mvp/14 §10). Old links keep working; a text search carries over. */
export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  redirect(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
}
