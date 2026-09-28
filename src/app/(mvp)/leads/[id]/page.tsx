import { redirect } from "next/navigation";

/** The lead page moved to /buyers/[id] (docs/mvp/14 §10). */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/buyers/${encodeURIComponent(id)}`);
}
