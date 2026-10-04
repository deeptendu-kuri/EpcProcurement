"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EnrichmentInput, EnrichmentView } from "@/mvp/enrichment";
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
    <p className="mt-1 text-sm text-[#6b7280]">1. Confirm the website. 2. Find relevant named contacts. 3. Review their current role and check the email.</p>
    {sample ? <p className="mt-2 text-sm text-amber-800">Sample data cannot use live contact lookup or become a verified buyer.</p>
      : !view.configured ? <p className="mt-2 text-sm text-amber-800">Hunter is not connected. Add HUNTER_API_KEY to the server environment and restart. No fake validation is used.</p> : null}
    <form className="mt-3 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); if (confirmed) void perform({ action: "search", domain, domainConfirmed: true }); }}>
      <label className="text-sm font-semibold">Official company website domain<input value={domain} onChange={e => { setDomain(e.target.value); setConfirmed(false); }} placeholder="company.com" maxLength={253} className="input mt-1 w-full p-2" disabled={busy || sample} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy || sample} className="mt-1" />I checked that this website belongs to this buying company, not the project owner or a similarly named company.</label>
      <button disabled={busy || sample || !view.configured || !confirmed || !domain.trim()} className="btn btn-secondary self-start">{busy ? "Checking contact…" : "Find contacts with Hunter"}</button>
    </form>
    <p className="mt-2 text-xs text-[#6b7280]">At most 5 addresses per lookup. Daily request cap and cached results protect the free quota. Email lookup does not validate phone numbers.</p>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    {message ? <p role="status" className="mt-3 text-sm text-green-700">{message}</p> : null}
    {view.contacts.length ? <ul className="mt-4 space-y-3">{view.contacts.map(c => <li key={`${c.id}:${c.point_id ?? "none"}`} className="rounded-lg bg-[var(--subtle)] p-3 text-sm">
      <p className="font-semibold">{c.name} {c.title ? `· ${c.title}` : ""}</p><p className="mt-1">{c.email || "No email found yet"}</p>
      <p className="mt-1 text-xs">Role/employment: {c.confirmed_at ? "reviewed by user" : "needs review"} · Email: {c.validation_status === "valid" && c.verified_at ? `provider-validated on ${formatDateTime(c.verified_at)}` : c.validation_status === "not_checked" || !c.validation_status ? "not checked" : `${c.validation_status} — not validated`}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || sample} onClick={() => perform({ action: "confirm_role", personId: c.id })}>I reviewed their current company / role</button>
        {!c.email ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy || sample || !view.configured || !view.domainConfirmed} onClick={() => perform({ action: "find", personId: c.id })}>Find this person&apos;s email</button> : c.point_id ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy || sample || !view.configured || !view.domainConfirmed} onClick={() => perform({ action: "verify", personId: c.id, pointId: c.point_id! })}>Check email with Hunter</button> : null}
      </div>
    </li>)}</ul> : <p className="mt-3 text-sm text-[#6b7280]">No saved named contacts yet. A lookup may legitimately return none.</p>}
  </div>;
}
