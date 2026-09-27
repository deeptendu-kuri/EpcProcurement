import { Activity, CheckCircle2, Clock3, Flame, Search, ShieldCheck, Sparkles } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { Metric } from "@/components/metric";

export default function UsagePage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-5">
        <header className="premium-panel rounded-xl px-5 py-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase text-[#2563eb]"><Activity size={15} />System Operations</div>
          <h1 className="mt-2 text-3xl font-bold text-[#101828]">Run Health & Usage</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667085]">
            Provider usage is designed to be tracked internally so discovery runs stay bounded and auditable.
          </p>
        </header>
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Search requests" value="0" detail="Tracked per run" />
          <Metric label="Crawled pages" value="0" detail="Dedup before crawl" />
          <Metric label="AI requests" value="0" detail="Classify before extraction" />
          <Metric label="Failed jobs" value="0" detail="Retries capped" />
        </section>
        <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="surface overflow-hidden rounded-xl">
            <div className="flex items-center justify-between border-b border-[#e4e7ec] px-4 py-3">
              <div>
                <h2 className="font-bold text-[#101828]">Processing Safeguards</h2>
                <p className="mt-1 text-xs text-[#667085]">Controls applied before discovery work consumes provider capacity.</p>
              </div>
              <Badge tone="green">Active</Badge>
            </div>
            <div className="divide-y divide-[#e4e7ec]">
              {[
                { icon: Search, title: "URL deduplication", text: "Normalized URLs and content hashes prevent repeat crawling and repeat AI extraction." },
                { icon: Sparkles, title: "Layered relevance", text: "Relevance classification runs before structured extraction so weak pages are rejected early." },
                { icon: Flame, title: "Bounded retries", text: "Jobs remain idempotent and retryable, with attempts capped by the discovery workflow." },
              ].map((item) => (
                <article key={item.title} className="flex gap-4 p-4 hover:bg-[#f8fafc]">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#eff6ff] text-[#2563eb]"><item.icon size={18} /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-[#101828]">{item.title}</h3><Badge tone="green">Enabled</Badge></div>
                    <p className="mt-1 text-sm leading-6 text-[#667085]">{item.text}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="border-t border-[#e4e7ec] bg-[#fbfcfe] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-[#344054]"><Clock3 size={16} />Recent Run Activity</div>
              <div className="mt-3 rounded-md border border-dashed border-[#cfd7e4] bg-white px-4 py-6 text-center text-sm text-[#667085]">No completed discovery runs are recorded in this view yet.</div>
            </div>
          </div>

          <aside className="surface rounded-xl p-4">
            <div className="flex items-center gap-2"><ShieldCheck size={17} className="text-[#2563eb]" /><h2 className="font-bold text-[#101828]">Runtime Policy</h2></div>
            <p className="mt-1 text-sm leading-6 text-[#667085]">Client-safe controls for predictable discovery runs.</p>
            <div className="mt-4 space-y-3">
              <PolicyRow label="Request limits" value="Bounded" />
              <PolicyRow label="Duplicate processing" value="Blocked" />
              <PolicyRow label="Failed job retries" value="Capped" />
              <PolicyRow label="Provider names" value="Hidden" />
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-md border border-[#d1fadf] bg-[#ecfdf3] p-3 text-sm leading-5 text-[#027a48]"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />Evidence-backed safeguards are active.</div>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] px-3 py-2.5">
      <span className="text-sm font-semibold text-[#475467]">{label}</span>
      <span className="text-xs font-bold uppercase text-[#2563eb]">{value}</span>
    </div>
  );
}
