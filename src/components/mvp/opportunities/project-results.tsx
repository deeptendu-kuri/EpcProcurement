import Link from "next/link";
import type {Opportunity} from "@/mvp/opportunities";
import {marketName} from "@/mvp/config/markets";

export function ProjectResults({rows,returnTo}:{rows:Opportunity[];returnTo:string}) {
  const projects=new Map<string,{name:string;country:string|null;rows:Opportunity[]}>();
  for(const row of rows) {
    const key=row.project_id||`company-${row.id}`;
    const project=projects.get(key)??{name:row.project_name||"Company opportunity — no identified project",country:row.project_country??null,rows:[]};
    project.rows.push(row);projects.set(key,project);
  }
  if(!rows.length)return null;
  return <section aria-label="Projects and buying companies" className="flex flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Projects & potential buyers</h2><span className="text-sm text-[var(--text-2)]">{rows.length} product-specific opportunities · saved automatically</span></div>
    {[...projects.entries()].map(([key,p])=><article className="card p-5" key={key}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase text-[var(--text-2)]">{p.rows[0].project_id?"Identified project":"Company-level evidence"}</p><h3 className="mt-1 text-xl font-bold">{p.name}</h3><p className="mt-1 text-sm text-[var(--text-2)]">{p.country?marketName(p.country):"Project country not identified"}</p></div><span className="chip">{p.rows[0].product_name}</span></div>
      <ul className="mt-4 divide-y divide-[var(--line)]">{p.rows.map(o=><li key={o.id} className="py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-bold">{o.name}</h4><p className="mt-1 text-xs text-[var(--text-2)]">Buyer company: {marketName(o.country)} · Search keyword: {o.keyword}</p></div><Link href={`/opportunities/${o.id}?returnTo=${encodeURIComponent(returnTo)}`} className="btn btn-primary">View contacts & conversation →</Link></div><p className="mt-2 text-sm">{o.buying_reason}</p><div className="mt-3 flex flex-wrap gap-2"><span className="chip">{o.qualification==="approved"?"Product fit reviewed":o.qualification==="rejected"?"Not relevant":"Product fit needs review"}</span><span className="chip">{o.validated_emails?`${o.validated_emails} validated email(s)`:"Contact check needed"}</span>{o.sent?<span className="chip">Demo email provider accepted</span>:null}{o.is_sample?<span className="chip">Sample — not a real buyer</span>:null}</div></li>)}</ul>
    </article>)}
  </section>;
}
