"use client";
import Link from "next/link";
import { Building2, ChevronRight, Mail, Network, ShieldCheck, Users } from "lucide-react";
import type { BuyerView } from "@/mvp/buyers/types";
import type { Opportunity } from "@/mvp/opportunities";
import type { EnrichmentView } from "@/mvp/enrichment";
import { CONTACT_ROLES, verifiedProspect } from "@/mvp/opportunities/workflow";
import { marketName } from "@/mvp/config/markets";

export const WORKSPACE_TABS = [
  { id: "overview", name: "Overview", icon: Building2 },
  { id: "contacts", name: "Contacts", icon: Users },
  { id: "chain", name: "Subcontractors & supply chain", icon: Network },
  { id: "conversation", name: "Email & meetings", icon: Mail },
  { id: "activity", name: "Activity", icon: ShieldCheck },
] as const;
export type WorkspaceTab = typeof WORKSPACE_TABS[number]["id"];
export interface ContactPoint { person_id: string; value: string; verified_at: string | null; source: string; kind?: string }
export function namedContacts(buyer: BuyerView, enrichment?: EnrichmentView) {
  const people = new Map<string, { id: string; name: string; title: string | null }>();
  for (const slot of buyer.team) if (slot.person) people.set(slot.person.id, slot.person);
  for (const person of enrichment?.contacts ?? []) people.set(person.id, person);
  return [...people.values()];
}
export function OpportunityRail({ opportunity: o, buyer, enrichment, points, busy, selectTab, patch, recipient,demoOutreach=false }: {
  opportunity: Opportunity; buyer: BuyerView; enrichment?: EnrichmentView; points: ContactPoint[];
  busy: boolean; selectTab: (tab: WorkspaceTab) => void; patch: (body: object) => Promise<void>; recipient: string | null;
  demoOutreach?:boolean;
}) {
  const people = namedContacts(buyer, enrichment);
  const verified = verifiedProspect(o.qualification, o.validated_emails, o.is_sample);
  return <aside aria-label="Lead context and actions" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
    <section className="card overflow-hidden"><div className="border-b border-[var(--line)] bg-[var(--accent-soft)] p-4"><p className="eyebrow">Lead status</p><h2 className="mt-1 font-bold">{verified ? "Validated buyer contact ready" : "Potential buyer"}</h2><p className="mt-1 text-xs text-[var(--text-2)]">Buyer fit and email validation are separate checks.</p></div><div className="space-y-3 p-4">
      <label className="block text-xs font-semibold">Product-fit review<select aria-label="Product-fit review" value={o.qualification} disabled={busy} onChange={e => void patch({ qualification: e.target.value })} className="input mt-1 w-full px-2"><option value="pending">Needs review</option><option value="approved">Product fit reviewed</option><option value="rejected">Not relevant</option></select></label>
      <dl className="space-y-2 text-xs"><div className="flex justify-between gap-2"><dt className="text-[var(--text-2)]">Named contacts</dt><dd className="font-semibold">{people.length}</dd></div><div className="flex justify-between gap-2"><dt className="text-[var(--text-2)]">Eligible validated emails</dt><dd className="font-semibold">{o.validated_emails}</dd></div><div className="flex justify-between gap-2"><dt className="text-[var(--text-2)]">{o.discovery_version ? "Research priority" : "Reference score"}</dt><dd className="font-semibold">{o.fit_score === undefined ? "" : `${o.fit_score}/100`}</dd></div></dl><p className="text-[11px] text-[var(--text-2)]">Scores help prioritise. They are not purchase probabilities and never decide whether an email can be sent.</p><button className="btn btn-primary w-full" onClick={() => selectTab(o.sent||demoOutreach&&o.qualification==='approved'&&!o.is_sample ? "conversation" : "contacts")}>{o.sent ? "Open email conversation" : demoOutreach&&o.qualification==='approved'&&!o.is_sample?'Continue to email demo':"View contacts & roles"}<ChevronRight size={14} aria-hidden /></button>
    </div></section>
    <section className="card p-4" aria-label="Contacts at this company"><div className="flex items-center justify-between gap-2"><h2 className="font-bold">Company contacts</h2><span className="chip">{people.length} found</span></div>{people.length ? <ul className="mt-3 divide-y divide-[var(--line)]">{people.slice(0,4).map(p => {
      const email = points.find(cp => cp.person_id === p.id && (!cp.kind || cp.kind === "email")); const phone = points.find(cp => cp.person_id === p.id && cp.kind === "phone");
      return <li key={p.id} className="py-2 text-xs"><button className="text-left font-semibold text-[var(--accent-2)] hover:underline" onClick={() => selectTab("contacts")}>{p.name}</button><p className="mt-1 text-[var(--text-2)]">{p.title || ""}</p>{email ? <p className="mt-1 break-all">{email.value}</p> : <p aria-label="Email not found" className="mt-1 text-[var(--text-2)]"></p>}{phone ? <p className="mt-1">{phone.value} · phone not validated</p> : null}</li>;
    })}</ul> : <p className="mt-3 text-sm text-[var(--text-2)]">No named contacts yet. Procurement, directors and technical roles remain visible in Contacts.</p>}<button onClick={() => selectTab("contacts")} className="mt-3 text-sm font-semibold text-[var(--accent-2)]">View all contacts & roles →</button></section>
    <section className="card p-4" aria-label="Search and project context"><h2 className="font-bold">Lead context</h2><dl className="mt-3 space-y-3 text-xs"><div><dt className="text-[var(--text-2)]">Product / keyword</dt><dd className="mt-1 font-semibold">{o.product_name} · {o.keyword}</dd></div><div><dt className="text-[var(--text-2)]">Company location</dt><dd className="mt-1">{o.country ? marketName(o.country) : ""}</dd></div><div><dt className="text-[var(--text-2)]">Project</dt><dd className="mt-1">{o.project_name || ""}</dd></div><div><dt className="text-[var(--text-2)]">Contact priority, not a restriction</dt><dd className="mt-1">{CONTACT_ROLES.find(r => r.id === o.contact_role)?.name || "Buying team"}</dd></div><div><dt className="text-[var(--text-2)]">Sales owner / next action</dt><dd className="mt-1">{[o.owner_name,o.next_action].filter(Boolean).join(" · ")}</dd></div></dl><Link href={`/find?run=${encodeURIComponent(o.run_id)}`} className="mt-3 inline-block text-sm font-semibold text-[var(--accent-2)]">View original search progress →</Link></section>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><p className="font-semibold">Approved-inbox demo</p><p className="mt-1 break-words">Email goes only to {recipient || "the configured demo inbox"}. Sending it does not verify a buyer&apos;s email. Related companies are not automatically enrolled.</p></div>
  </aside>;
}
