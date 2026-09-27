/** Placeholder — replaced by the UI builder (docs/mvp/09 §4.3, 12 §1 F3). */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section className="surface rounded-xl p-5">
      <h1 className="text-xl font-bold text-[#101828]">Lead</h1>
      <p className="mt-2 text-sm text-[#667085]">The lead page with proof for {id} is coming in the next build step.</p>
    </section>
  );
}
