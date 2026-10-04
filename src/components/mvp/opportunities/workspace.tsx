"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Opportunity } from "@/mvp/opportunities";
import { CONTACT_ROLES, journey, verifiedProspect } from "@/mvp/opportunities/workflow";
import type { BuyerView } from "@/mvp/buyers/types";
import { DEMO_CONTACT_EMAIL, type DemoEmailInfo } from "@/mvp/email/config";
import { DraftPanel, type DraftContact } from "../draft-panel";
import { apiJson } from "../api-client";
import { PageHeader } from "../page-header";
import { formatDateTime } from "../labels";
import { marketName } from "@/mvp/config/markets";
import type { EnrichmentView } from "@/mvp/enrichment";
import { ContactEnrichment } from "./contact-enrichment";

interface Props {
  opportunity: Opportunity; buyer: BuyerView; returnTo: string; demoEmail: DemoEmailInfo;
  events: { id: number; body: string; created_at: string }[];
  drafts: { id: string; subject: string | null; body: string | null; delivery_state: string | null; delivery_recipient: string | null; campaign_status: string | null; created_at: string }[];
  points: { person_id: string; value: string; verified_at: string | null; source: string }[];
  enrichment?: EnrichmentView;
}
export function OpportunityWorkspace({ opportunity: o, buyer, returnTo, events, drafts, points, demoEmail, enrichment }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [compose, setCompose] = useState(false);
  const [summary, setSummary] = useState(o.summary);
  const [ownerName, setOwner] = useState(o.owner_name);
  const [nextAction, setAction] = useState(o.next_action);
  const [followUpAt, setFollowUp] = useState(o.follow_up_at?.slice(0,16) ?? "");
  const progress = journey(o.qualification, o.validated_emails, o.sent, o.is_sample);
  const slots = buyer.team.filter(s => s.role === o.contact_role);
  const contacts: DraftContact[] = slots.filter(s => s.person).map(s => ({ id: s.person!.id, name: s.person!.name, detail: s.person!.title || s.title,
    country: buyer.country, rule: null, companyName: buyer.name, email: points.find(p => p.person_id === s.person!.id)?.value ?? null }));
  if (demoEmail.enabled) contacts.push({ id: null, name: "Demo procurement contact", detail: CONTACT_ROLES.find(r => r.id === o.contact_role)?.name,
    email: DEMO_CONTACT_EMAIL, country: buyer.country, rule: null, companyName: buyer.name, isDemo: true });
  const patch = async (body: object) => {
    setBusy(true); setError(null); setSaved(false);
    try { await apiJson(`/api/mvp/opportunities/${o.id}`, { method: "PATCH", body }); setSaved(true); router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save."); }
    finally { setBusy(false); }
  };
  return <div className="flex flex-col gap-5">
    <Link href={returnTo} className="self-start text-sm font-semibold text-[var(--accent-2)]">← Back to filtered CRM results</Link>
    <PageHeader title={o.name} subtitle={`${o.product_name} · ${marketName(o.country)} · Keyword: ${o.keyword}`} />
    {o.is_sample ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Sample data — not a real buyer or validated contact.</p> : null}
    <section className="card p-4" aria-label="Lead journey">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-[#6b7280]">Next step</p><h2 className="text-lg font-bold">{progress.stage}</h2></div>
        {o.qualification === "pending" ? <button disabled={busy} onClick={() => patch({ qualification: "approved" })} className="btn btn-primary">Confirm product buyer fit</button> : o.qualification === "rejected" ? <button disabled={busy} onClick={() => patch({ qualification: "pending" })} className="btn btn-secondary">Reopen fit review</button> : <button className="btn btn-primary" onClick={() => document.getElementById(o.sent ? "conversation" : "contacts")?.scrollIntoView({ behavior: "smooth" })}>{progress.action}</button>}
      </div>
      <ol className="mt-4 grid gap-2 text-xs sm:grid-cols-5">{["Review fit", "Validate contact", "Review email", "Conversation", "Meeting"].map((step, i) => <li key={step} aria-current={i === progress.step ? "step" : undefined} className={`rounded-lg border p-2 ${i === progress.step ? "border-[var(--accent)] bg-[var(--accent-soft)] font-bold" : "border-[var(--line)] text-[#6b7280]"}`}>{i + 1}. {step}{i === 4 ? " · not connected" : ""}</li>)}</ol>
      {o.sent ? <p className="mt-2 text-xs text-[#b54708]">Demo delivery only: the buyer was not contacted. Awaiting replies/meeting automation is not active.</p> : null}
    </section>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}{saved ? <p role="status" className="text-sm text-green-700">Saved successfully.</p> : null}
    <div role="tablist" aria-label="Lead workspace" className="flex gap-2">{["overview", "conversation", "activity"].map(t => <button key={t} role="tab" aria-selected={tab === t} aria-controls={`panel-${t}`} id={`tab-${t}`} className={`btn ${tab === t ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    {tab === "overview" ? <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" className="flex flex-col gap-4">
      <section className="card p-4"><h2 className="font-bold">Why they might buy {o.product_name}</h2><p className="mt-2 text-sm">{o.buying_reason}</p><p className="mt-2 text-xs text-[#6b7280]">This is an evidence-backed potential fit, not proof of a purchase commitment.</p>
        <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy || o.qualification === "approved"} className="btn btn-primary" onClick={() => patch({ qualification: "approved" })}>Confirm product buyer fit</button><button disabled={busy || o.qualification === "rejected"} className="btn btn-secondary" onClick={() => patch({ qualification: "rejected" })}>Not relevant for this product</button></div>
        <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">View supporting evidence ({o.evidence_ids.length})</summary><ul className="mt-2 space-y-3">{buyer.proof.filter(p => o.evidence_ids.includes(p.evidenceId)).map(p => <li key={p.evidenceId} className="rounded-lg bg-[var(--subtle)] p-3 text-sm"><p>{p.sentence}</p>{p.url && /^https?:\/\//.test(p.url) ? <a href={p.url} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent-2)] underline">{p.source} — open source</a> : <span className="text-xs">{p.source}</span>}</li>)}</ul></details>
      </section>
      <section id="contacts" className="card p-4"><h2 className="font-bold">Contact: {CONTACT_ROLES.find(r => r.id === o.contact_role)?.name}</h2>
        {!contacts.some(c => !c.isDemo) ? <p className="mt-2 text-sm text-[#6b7280]">No named contact found for the requested role yet. The lookup below can find relevant buying-team contacts; unrelated employees are not substituted.</p> : null}
        <p className="mt-3 text-sm">{verifiedProspect(o.qualification, o.validated_emails, o.is_sample) ? "This prospect meets the verified CRM criteria." : "Review current contact role and validate email to qualify for Verified CRM. Sending a demo email does not qualify a contact."}</p>
        <ContactEnrichment opportunityId={o.id} sample={o.is_sample} initial={enrichment} />
        <div className="mt-3 flex flex-wrap gap-2"><Link className="btn btn-secondary" href={`/buyers/${o.lead_id}`}>Find / add a contact (advanced)</Link><button disabled={o.qualification !== "approved" || !demoEmail.enabled} className="btn btn-primary" onClick={() => setCompose(true)}>Contact lead / Preview demo email</button></div>
        {o.qualification !== "approved" ? <p className="mt-2 text-xs text-[#b54708]">Review buyer fit to unlock the email preview.</p> : null}
        <p className="mt-2 text-xs text-[#6b7280]">Demo sends only to {demoEmail.recipient || "the configured test inbox"}. It does not email scraped contacts or move them into Verified CRM.</p>
      </section>
    </div> : null}
    <section id="conversation" role={tab === "conversation" ? "tabpanel" : undefined} aria-labelledby={tab === "conversation" ? "tab-conversation" : undefined} className={`card p-4 ${tab === "activity" ? "hidden" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">Conversation & CRM notes</h2><Link href="/outreach" className="btn btn-secondary btn-sm">Track email automation →</Link></div>
      {tab === "conversation" ? <ul className="mt-3 space-y-3">{drafts.length ? drafts.map(d => <li key={d.id} className="rounded-lg border border-[var(--line)] p-3 text-sm"><p className="font-semibold">{d.subject || "Blocked draft"}</p><p className="text-xs text-[#6b7280]">{formatDateTime(d.created_at)} · {d.delivery_state === "sent" ? `Provider accepted demo email to ${d.delivery_recipient}` : d.campaign_status ? `Automation: ${d.campaign_status} — see Outreach` : d.delivery_state === "failed" ? "Delivery unconfirmed — review before resending" : "Draft / awaiting delivery"}</p><details className="mt-2"><summary>Read email</summary><p className="mt-2 whitespace-pre-wrap">{d.body}</p></details></li>) : <li className="text-sm text-[#6b7280]">No emails for this product opportunity yet.</li>}</ul> : null}
      <form className="mt-3 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); patch({ summary, ownerName, nextAction, followUpAt: followUpAt ? new Date(`${followUpAt}:00Z`).toISOString() : null }); }}>
        <div><label htmlFor="opportunity-summary" className="text-sm font-semibold">Summary</label><textarea id="opportunity-summary" value={summary} onChange={e => setSummary(e.target.value)} maxLength={4000} className="input mt-1 min-h-24 w-full p-2 font-normal" placeholder="Notes from your review or conversation. No reply is inferred." /></div>
        <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm font-semibold">Sales owner<input className="input mt-1 w-full p-2" value={ownerName} onChange={e => setOwner(e.target.value)} maxLength={120} /></label><label className="text-sm font-semibold">Next action<input className="input mt-1 w-full p-2" value={nextAction} onChange={e => setAction(e.target.value)} maxLength={300} /></label><label className="text-sm font-semibold">Manual follow-up reminder (UTC)<input type="datetime-local" className="input mt-1 w-full p-2" value={followUpAt} onChange={e => setFollowUp(e.target.value)} /></label></div>
        <button disabled={busy} className="btn btn-primary self-start">{busy ? "Saving…" : "Save CRM notes"}</button>
      </form><p className="mt-3 text-xs text-[#6b7280]">Inbound replies, automatic follow-ups and calendar booking are not connected. The reminder saves a date; it does not send mail or book a meeting.</p>
    </section>
    {tab === "activity" ? <section role="tabpanel" id="panel-activity" aria-labelledby="tab-activity" className="card p-4"><h2 className="font-bold">Activity for this opportunity</h2><ul className="mt-3 space-y-2">{events.length ? events.map(e => <li key={e.id} className="text-sm">{e.body}<p className="text-xs text-[#6b7280]">{formatDateTime(e.created_at)}</p></li>) : <li className="text-sm text-[#6b7280]">No changes yet. Email history is in Conversation.</li>}</ul></section> : null}
    {compose ? <DraftPanel leadId={o.lead_id} opportunityId={o.id} contacts={contacts} demoEmail={demoEmail} autoGenerate initialContactKey={contacts.find(c => !c.isDemo)?.id ?? "demo"} onClose={() => setCompose(false)} onSent={() => { setTab("conversation"); router.refresh(); }} /> : null}
  </div>;
}
