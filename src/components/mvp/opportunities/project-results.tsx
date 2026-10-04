import Link from "next/link";
import type { Opportunity } from "@/mvp/opportunities";
import { marketName } from "@/mvp/config/markets";

export function ProjectResults({ rows, returnTo }: { rows: Opportunity[]; returnTo: string }) {
  const projects = new Map<string, { name: string; country: string | null; rows: Opportunity[] }>();
  for (const row of rows) {
    const key = row.project_id || `company-${row.id}`;
    const project = projects.get(key) ?? { name: row.project_name || row.name, country: row.project_id ? row.project_country ?? null : row.country, rows: [] };
    project.rows.push(row); projects.set(key, project);
  }
  if (!rows.length) return null;
  return <section aria-label="Projects and buying companies" className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Your potential buyers</h2><span className="text-sm text-[var(--text-2)]">{rows.length} product-specific opportunities · saved automatically</span></div>
    {[...projects.entries()].map(([key,p]) => <article className="card p-5" key={key}>
      <div className="flex flex-wrap items-start justify-between gap-2"><div>
        <p className="text-xs font-semibold uppercase text-[var(--text-2)]">{p.rows[0].project_id ? "Project-linked potential buyer" : "Company-level potential buyer · current requirement unconfirmed"}</p>
        <h3 className="mt-1 text-xl font-bold">{p.name}</h3><p className="mt-1 text-sm text-[var(--text-2)]">{p.country ? marketName(p.country) : "Project location not established"}</p>
      </div><span className="chip">{p.rows[0].product_name}</span></div>
      <ul className="mt-4 divide-y divide-[var(--line)]">{p.rows.map(o => <li key={o.id} className="py-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-bold">{o.name}</h4><p className="mt-1 text-xs text-[var(--text-2)]">Company location: {marketName(o.country)} · Search: {o.keyword}</p></div><Link href={`/opportunities/${o.id}?returnTo=${encodeURIComponent(returnTo)}`} className="btn btn-primary">Open contacts & conversation →</Link></div>
        <p className="mt-2 text-sm">{o.buying_reason}</p>
        <div className="mt-3 flex flex-wrap gap-2"><span className="chip">{o.qualification === "approved" ? "Product fit reviewed" : o.qualification === "rejected" ? "Not relevant" : "Checking product fit"}</span><span className="chip">{o.validated_emails ? `${o.validated_emails} validated email(s)` : "Buyer contact not yet validated"}</span>{o.sent ? <span className="chip">Demo email provider accepted · buyer not contacted</span> : null}{o.is_sample ? <span className="chip">Sample — not a real buyer</span> : null}</div>
        {o.source_urls?.length ? <div className="mt-3 flex flex-wrap gap-3 text-sm">{o.source_urls.filter(url => /^https?:\/\//i.test(url)).map((url,i) => <a key={url} href={url} target="_blank" rel="noreferrer" className="font-semibold text-[var(--accent-2)] underline">Read supporting source {i+1} ↗</a>)}</div> : null}
      </li>)}</ul>
    </article>)}
  </section>;
}
