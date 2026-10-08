import Link from "next/link";
import type { Opportunity } from "@/mvp/opportunities";
import { marketName } from "@/mvp/config/markets";
import { ACTIVITY_GROUPS, activityGroup, activityLabel } from "@/mvp/opportunities/workflow";

export function ProjectResults({ rows, returnTo }: { rows: Opportunity[]; returnTo: string }) {
  if (!rows.length) return null;
  const grouped = ACTIVITY_GROUPS.map(group => {
    const projects = new Map<string, { name: string; country: string | null; rows: Opportunity[] }>();
    for (const row of rows.filter(o => activityGroup(o.activity_status) === group.id).sort((a,b) => (b.fit_score ?? 0) - (a.fit_score ?? 0))) {
      const key = row.project_id || `company-${row.id}`;
      const project = projects.get(key) ?? { name: row.project_name || row.name, country: row.project_id ? row.project_country ?? null : row.country, rows: [] };
      project.rows.push(row); projects.set(key, project);
    }
    return { ...group, projects };
  }).filter(group => group.projects.size);
  return <section aria-label="Projects and buying companies" className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Your potential buyers</h2><span className="text-sm text-[var(--text-2)]">{rows.length} product-specific opportunities · saved automatically</span></div>
    {grouped.map(group => <section key={group.id} aria-label={group.label} className="flex flex-col gap-4"><div><h2 className="font-bold">{group.label}</h2><p className="mt-1 text-xs text-[var(--text-2)]">{group.explanation}</p></div>{[...group.projects.entries()].map(([key,p]) => <article className="card p-5" key={key}>
      <div className="flex flex-wrap items-start justify-between gap-2"><div>
        <p className="text-xs font-semibold uppercase text-[var(--text-2)]">{p.rows[0].project_id ? "Project-linked potential buyer" : "Company-level potential buyer · current requirement unconfirmed"}</p>
        <h3 className="mt-1 text-xl font-bold">{p.name}</h3><p className="mt-1 text-sm text-[var(--text-2)]">{p.country ? marketName(p.country) : ""}</p>
      </div><span className="chip">{p.rows[0].product_name}</span></div>
      <ul className="mt-4 divide-y divide-[var(--line)]">{p.rows.map(o => <li key={o.id} className="py-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-bold">{o.name}</h4><p className="mt-1 text-xs text-[var(--text-2)]">{o.country ? `${marketName(o.country)} · ` : ""}Search: {o.keyword}</p></div><Link href={`/opportunities/${o.id}?returnTo=${encodeURIComponent(returnTo)}`} className="btn btn-primary">Open full lead workspace →</Link></div>
        <div className="mt-3 rounded-lg bg-[var(--accent-soft)] p-3"><p className="text-xs font-semibold uppercase text-[var(--text-2)]">What we can sell them</p><p className="mt-1 font-bold text-[var(--accent-2)]">{o.product_name}</p><p className="mt-1 text-sm">{o.buying_reason.replace("Company-level services evidence; no awarded project established.","Company-level opportunity; no specific project name established.")}</p><p className="mt-1 text-xs text-[var(--text-2)]">Potential application · current purchase and specifications unconfirmed</p></div>
        <div className="mt-3 flex flex-wrap gap-2"><span className="chip">{o.qualification === "approved" ? "Product fit reviewed" : o.qualification === "rejected" ? "Not relevant" : "Checking product fit"}</span><span className="chip">{o.material_fit_kind === "explicit" ? "Explicit material use" : "Potential material application"}</span><span className="chip">{activityLabel(o.activity_status)}</span>{o.activity_date ? <span className="chip">Activity date: {o.activity_date.slice(0,10)}</span> : null}{o.fit_score!==undefined?<span className="chip">{o.discovery_version ? "Priority" : "Reference score"}: {o.fit_score}/100 · not a purchase probability or sending gate</span>:null}<span className="chip">{o.validated_emails ? `${o.validated_emails} validated email(s)` : "Buyer contact not yet validated"}</span>{o.sent ? <span className="chip">Demo email provider accepted · buyer not contacted</span> : null}{o.is_sample ? <span className="chip">Sample — not a real buyer</span> : null}</div>
        {o.public_contacts?.length ? <div aria-label={`Published company contacts for ${o.name}`} className="mt-3 rounded-lg border border-[var(--line)] p-3"><p className="text-xs font-semibold">Published company phone / inbox</p><div className="mt-2 flex flex-wrap gap-3 text-sm">{o.public_contacts.filter(c => /^https?:\/\//i.test(c.source_url)).slice(0,4).map(c => <a key={`${c.kind}:${c.value}`} href={c.source_url} target="_blank" rel="noreferrer" className="break-all text-[var(--accent-2)] underline" title="Read original contact source">{c.value}</a>)}</div><p className="mt-2 text-xs text-[var(--text-2)]">Company contacts, not verified personal details.</p></div> : null}
        {o.named_contact_count !== undefined ? <p className="mt-2 text-xs text-[var(--text-2)]">{o.named_contact_count} named contact(s) · Missing contacts never hide a relevant company.</p> : null}
        {o.source_urls?.length ? <div className="mt-3 flex flex-wrap gap-3 text-sm">{o.source_urls.filter(url => /^https?:\/\//i.test(url)).map((url,i) => <a key={url} href={url} target="_blank" rel="noreferrer" className="font-semibold text-[var(--accent-2)] underline">Read supporting source {i+1} ↗</a>)}</div> : null}
      </li>)}</ul>
    </article>)}</section>)}
  </section>;
}
