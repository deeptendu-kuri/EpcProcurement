"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CampaignView } from "@/mvp/email/campaigns";
import { apiJson } from "../api-client";

const labels = { queued: "Queued — not sent", sending: "Sending", accepted: "Sent — provider accepted", paused: "Paused", cancelled: "Cancelled", review: "Needs review" };
export function CampaignList({ campaigns, workerEnabled }: { campaigns: CampaignView[]; workerEnabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!campaigns.some(c => c.status === "queued" || c.status === "sending")) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [campaigns, router]);
  async function action(id: string, action: "pause" | "resume" | "cancel") {
    setBusy(id); setError(null);
    try { await apiJson(`/api/mvp/outreach/campaigns/${id}`, { method: "PATCH", body: { action } }); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update campaign."); }
    finally { setBusy(null); }
  }
  return <div className="flex flex-col gap-4">
    <div className="card p-4 text-sm"><p className="font-semibold">Earlier manually approved test-inbox emails</p>
      <p className="mt-1 text-[#667085]">Review buyer fit → open Contact → review email → approve → automatic delivery. No scraped buyer is emailed.</p>
      <p className="mt-2 text-[#667085]">{workerEnabled ? "Automatic worker enabled while this server is awake. Jobs survive restarts." : "Automatic worker is off. Approved emails remain queued until the authenticated worker is enabled or triggered."} Free hosting can sleep; a timed delivery is not guaranteed.</p>
      <p className="mt-2 text-[#667085]">This older queue does not process replies or schedule meetings. Use the automatic conversations above for the email → reply → meeting workflow.</p>
    </div>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {!campaigns.length ? <section className="card p-6"><h2 className="font-bold">No approved emails yet</h2><p className="mt-2 text-sm text-[#667085]">Choose a lead, approve its buyer fit, then click Contact to review an email.</p><Link href="/crm" className="btn btn-primary mt-4">Open leads</Link></section> : campaigns.map(c => <article key={c.id} className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={`/opportunities/${c.opportunity_id}?returnTo=${encodeURIComponent(`/crm?search=${c.run_id}`)}`} className="font-bold text-[var(--accent)]">{c.name}</Link><p className="mt-1 text-sm text-[#667085]">{c.product_name} · Keyword: {c.keyword}</p></div><span className="rounded-md bg-[var(--subtle)] px-3 py-2 text-sm font-semibold" role="status">{labels[c.status]}</span></div>
      <p className="mt-3 text-sm font-semibold">{c.subject}</p><p className="mt-1 text-xs text-[#667085]">To: {c.recipient} · Attempts: {c.attempts}</p>
      {c.provider_message_id ? <p className="mt-2 break-all text-xs text-[#667085]">Provider ID: {c.provider_message_id}. Acceptance is not proof of inbox delivery; check your inbox.</p> : null}
      {c.last_error ? <p className="mt-2 text-sm text-red-700">{c.last_error}</p> : null}
      {c.status === "queued" || c.status === "paused" ? <div className="mt-3 flex flex-wrap gap-2"><button className="btn btn-secondary btn-sm" disabled={busy === c.id} onClick={() => void action(c.id, c.status === "paused" ? "resume" : "pause")}>{c.status === "paused" ? "Resume" : "Pause"}</button>{!c.attempts ? <button className="btn btn-secondary btn-sm" disabled={busy === c.id} onClick={() => void action(c.id, "cancel")}>Cancel unsent email</button> : null}</div> : null}
    </article>)}
  </div>;
}
