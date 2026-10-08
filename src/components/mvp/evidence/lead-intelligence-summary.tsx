import Link from 'next/link';
import type {LeadRow} from '@/mvp/buyers/types';
import {marketName} from '@/mvp/config/markets';

/** Facts are already original-text checked by the shared evidence API. No catalogue expansion. */
export function LeadIntelligenceSummary({lead,leadId,workspace}:{lead:LeadRow;leadId?:string;workspace:string|null}){
  const fullProfile=leadId&&/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(leadId)?`/buyers/${leadId}`:null;
  const trigger=lead.trigger;
  return <>
    <section aria-label="What we can sell them" className="rounded-xl border border-blue-100 bg-blue-50 p-4">
      <h3 className="font-bold">What we can sell them</h3>
      <p className="mt-2 text-base font-semibold">{lead.sellSummary||'Product fit not established'}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">Only this search’s product. A supported potential application, not a confirmed purchase order.</p>
    </section>
    <section aria-label="Work and buying trigger" className="rounded-xl border border-[var(--line)] p-4">
      <h3 className="font-bold">Work & buying trigger</h3>
      <p className="mt-2 text-sm">{trigger?.title||'No source-backed buying trigger established.'}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-[var(--muted)]">Date</dt><dd>{trigger?.date||'Not established'}</dd></div>
        <div><dt className="text-xs text-[var(--muted)]">Value</dt><dd>{trigger?.valueText||'Not established'}</dd></div>
        <div><dt className="text-xs text-[var(--muted)]">Project</dt><dd>{trigger?.projectName||'Not named in evidence'}</dd></div>
        <div><dt className="text-xs text-[var(--muted)]">Project owner</dt><dd>{trigger?.ownerName||'Not established'}</dd></div>
        <div><dt className="text-xs text-[var(--muted)]">Where the work is</dt><dd>{lead.operatingCountry?marketName(lead.operatingCountry):'Not established'}</dd></div>
        <div><dt className="text-xs text-[var(--muted)]">Headquarters</dt><dd>{lead.hqCountry?marketName(lead.hqCountry):'Not established'}</dd></div>
      </dl>
      {trigger?.kind==='capability'?<p className="mt-3 text-xs text-amber-800">Relevant company services only; a recent award or active order has not been verified.</p>:null}
    </section>
    <nav aria-label="Buyer details and next steps" className="flex flex-col items-start gap-2">
      {workspace?<Link href={`${workspace}&tab=conversation`} className="btn btn-secondary btn-sm">Email & meeting progress →</Link>:null}
      {fullProfile?<><Link href={fullProfile} className="btn btn-secondary btn-sm">Full buyer profile & supply chain →</Link><p className="text-xs text-[var(--muted)]">Full company context includes other deals. This search’s product and automation stay in the workspace.</p></>:null}
    </nav>
  </>;
}
