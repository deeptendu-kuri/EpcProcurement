"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EnrichmentInput, EnrichmentView } from "@/mvp/enrichment";
import { uniquePublishedContacts } from "@/mvp/opportunities/workflow";
import { apiJson } from "../api-client";
import { formatDateTime } from "../labels";

export function ContactEnrichment({ opportunityId, sample, initial }: { opportunityId: string; sample: boolean; initial?: EnrichmentView }) {
  const router = useRouter();
  const [view, setView] = useState<EnrichmentView>(initial ?? { configured: false, domain: null, domainConfirmed: false, contacts: [] });
  const [domain, setDomain] = useState(view.domain ?? "");
  const [confirmed, setConfirmed] = useState(view.domainConfirmed);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function perform(body: EnrichmentInput) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiJson<{ message: string; view: EnrichmentView }>(`/api/mvp/opportunities/${opportunityId}/enrichment`, { method: "POST", body });
      setView(result.view); setMessage(result.message); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Contact lookup failed."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 rounded-xl border border-[var(--line)] p-4" aria-label="Contact discovery and validation">
    <h3 className="font-semibold">Find & validate company contacts</h3>
    <p className="mt-1 text-sm text-[#6b7280]">Find published company phone numbers, business inboxes and named contacts with role tags. Then review the person&apos;s current role and validate their email separately.</p>
    {sample ? <p className="mt-2 text-sm text-amber-800">Sample data cannot use live contact lookup or become a verified buyer.</p>
      : !view.configured ? <p className="mt-2 text-sm text-amber-800">Contact verification is not connected. Configure Emailable or Hunter on the server. No fake validation is used.</p> : null}
    <form className="mt-3 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); if (confirmed) void perform({ action: "search", domain, domainConfirmed: true }); }}>
      <label className="text-sm font-semibold">Official company website domain<input value={domain} onChange={e => { setDomain(e.target.value); setConfirmed(false); }} placeholder="company.com" maxLength={253} className="input mt-1 w-full p-2" disabled={busy || sample} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy || sample} className="mt-1" />I checked that this website belongs to this buying company, not the project owner or a similarly named company.</label>
      <button disabled={busy || sample || !view.configured || !confirmed || !domain.trim()} className="btn btn-secondary self-start">{busy ? "Checking contact…" : view.discoveryProvider==="Public website research"?"Find published company contacts":"Find contacts with Hunter"}</button>
      <button type="button" disabled={busy || sample || !confirmed || !domain.trim()} className="btn btn-secondary self-start" onClick={()=>void perform({action:"search",domain,domainConfirmed:true,websiteOnly:true})}>Read website phone & inbox · no search credits</button>
    </form>
    <p className="mt-2 text-xs text-[#6b7280]">API contact research is capped and cached. Direct official-page phone/inbox reads use no search or verification credits. Email lookup does not validate phone numbers.</p>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    {message ? <p role="status" className="mt-3 text-sm text-green-700">{message}</p> : null}
    {view.companyContacts?.length ? <section className="mt-4 rounded-lg border border-[var(--line)] p-3" aria-label="Published company phone numbers and inboxes"><h4 className="font-semibold">Company phone numbers & business inboxes</h4><p className="mt-1 text-xs text-[var(--text-2)]">Published on the official website. Not a named employee&apos;s contact, not provider-validated, and never used to send this demo to a buyer.</p><ul className="mt-3 space-y-2">{uniquePublishedContacts(view.companyContacts).map(c=><li key={`${c.kind}:${c.value}:${c.source_url}`} className="flex flex-wrap items-center justify-between gap-2 text-sm"><div><span className="text-xs text-[var(--text-2)]">{c.kind === "phone" ? "Company telephone" : "Company inbox"} · </span><span className="font-semibold break-all">{c.value}</span></div><a href={c.source_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[var(--accent-2)] underline">Official source ↗</a></li>)}</ul></section> : null}
    {view.contacts.length ? <ul className="mt-4 space-y-3">{view.contacts.map(c => <li key={`${c.id}:${c.point_id ?? "none"}`} className="rounded-lg bg-[var(--subtle)] p-3 text-sm">
      <p className="font-semibold">{c.name} {c.title ? `· ${c.title}` : ""}</p><p className="mt-1">{c.email || ""}</p>
      <p className="mt-1 text-xs">Role/employment: {c.confirmed_at ? "reviewed by user" : "needs review"} · Email: {c.validation_status === "valid" && c.verified_at ? `provider-validated on ${formatDateTime(c.verified_at)}` : c.validation_status === "not_checked" || !c.validation_status ? "not checked" : `${c.validation_status} — not validated`}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <a href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${c.name} ${domain}`)}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Look up on LinkedIn ↗</a>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || sample} onClick={() => perform({ action: "confirm_role", personId: c.id })}>I reviewed their current company / role</button>
        {!c.email ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy || sample || !view.configured || !view.domainConfirmed} onClick={() => perform({ action: "find", personId: c.id })}>Find this person&apos;s email</button> : c.point_id ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy || sample || !view.configured || !view.domainConfirmed} onClick={() => perform({ action: "verify", personId: c.id, pointId: c.point_id! })}>Check email with {view.verificationProvider||"Hunter"}</button> : null}
      </div>
    </li>)}</ul> : <p className="mt-3 text-sm text-[#6b7280]">No saved named contacts yet. A lookup may legitimately return none.</p>}
  </div>;
}
