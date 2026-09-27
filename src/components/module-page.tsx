import { CheckCircle2, Clock3, ShieldCheck, type LucideIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { ModuleAction } from "@/components/module-action";
import { ResponsiveTable } from "@/components/responsive-table";

interface ModuleMetric {
  label: string;
  value: string;
  detail: string;
}

interface ModuleRow {
  title: string;
  status: string;
  detail: string;
}

interface ModulePageProps {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  primaryAction: string;
  metrics: ModuleMetric[];
  rows: ModuleRow[];
}

export function ModulePage({ eyebrow, title, description, icon: Icon, primaryAction, metrics, rows }: ModulePageProps) {
  const readyCount = rows.filter((row) => row.status === "Ready").length;
  const pendingCount = rows.length - readyCount;
  const badgeTone = (status: string) => {
    if (status === "Ready") return "green";
    if (status === "Queued" || status.startsWith("Requires")) return "amber";
    return "neutral";
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-5">
        <header className="surface rounded-xl px-5 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="max-w-4xl">
              <div className="flex items-center gap-2 text-xs font-bold uppercase text-[#2563eb]">
                <Icon size={15} />
                {eyebrow}
              </div>
              <h1 className="mt-2 text-3xl font-bold tracking-normal text-[#101828]">{title}</h1>
              <p className="mt-2 text-sm leading-6 text-[#475467]">{description}</p>
            </div>
            <ModuleAction label={primaryAction} moduleTitle={title} />
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="surface rounded-lg p-4 transition-colors hover:border-[#cbd5e1] hover:bg-[#fbfcfe]">
              <div className="text-xs font-bold uppercase text-[#667085]">{metric.label}</div>
              <div className="mt-2 text-2xl font-bold text-[#101828]">{metric.value}</div>
              <p className="mt-1 text-sm leading-6 text-[#667085]">{metric.detail}</p>
            </div>
          ))}
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="surface overflow-hidden rounded-xl">
            <div className="flex items-center justify-between border-b border-[#e4e7ec] bg-white px-4 py-3">
              <div>
                <h2 className="font-bold text-[#101828]">Workspace Controls</h2>
                <p className="mt-1 text-xs text-[#667085]">Visible operating state for this workflow.</p>
              </div>
              <Badge tone="neutral">Client-safe view</Badge>
            </div>
            <div className="overflow-x-auto">
              <ResponsiveTable className="w-full text-left text-sm">
                <thead className="table-head text-xs uppercase">
                  <tr>
                    <th className="w-[30%] px-4 py-3">Control</th>
                    <th className="w-[20%] px-4 py-3">Status</th>
                    <th className="px-4 py-3">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.title} className="border-t border-[#e4e7ec] align-top hover:bg-[#f8fafc]">
                      <td className="px-4 py-4 font-bold text-[#101828]">{row.title}</td>
                      <td className="px-4 py-4">
                        <Badge tone={badgeTone(row.status)}>{row.status}</Badge>
                      </td>
                      <td className="max-w-3xl px-4 py-4 leading-6 text-[#475467]">{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
          </section>

          <aside className="grid gap-4">
            <section className="surface rounded-xl p-4">
              <div className="text-xs font-bold uppercase text-[#667085]">Workflow Summary</div>
              <div className="mt-4 space-y-3">
                <SummaryRow icon={CheckCircle2} label="Ready workflows" value={String(readyCount)} tone="green" />
                <SummaryRow icon={Clock3} label="Pending setup" value={String(pendingCount)} tone="amber" />
                <SummaryRow icon={ShieldCheck} label="Data policy" value="Verified-first" tone="blue" />
              </div>
            </section>
            <section className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-[#1e3a8a]"><ShieldCheck size={16} />Source-backed workspace</div>
              <p className="mt-2 text-sm leading-6 text-[#475467]">Provider names stay hidden. Unverified contact claims remain marked as pending until a trusted source confirms them.</p>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function SummaryRow({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: "green" | "amber" | "blue" }) {
  const toneClass = tone === "green" ? "bg-[#ecfdf3] text-[#027a48]" : tone === "amber" ? "bg-[#fffaeb] text-[#b54708]" : "bg-[#eff6ff] text-[#1d4ed8]";
  return (
    <div className="flex items-center gap-3 rounded-md border border-[#e4e7ec] bg-[#fbfcfe] p-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${toneClass}`}><Icon size={16} /></span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-[#344054]">{label}</span>
      <span className="text-sm font-bold text-[#101828]">{value}</span>
    </div>
  );
}
