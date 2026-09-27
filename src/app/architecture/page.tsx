import { AppShell } from "@/components/app-shell";

const modules = [
  "Authentication",
  "Companies",
  "Search Discovery",
  "Sources",
  "Content Processing",
  "AI Classification",
  "AI Structured Extraction",
  "Projects",
  "Tenders",
  "Signals",
  "Company Normalization",
  "Buyer Scoring",
  "Evidence",
  "Dashboard",
  "Search & Filters",
  "Company Detail",
  "Signal Timeline",
  "Trade Verification Adapter",
  "Jobs",
  "Monitoring",
];

export default function ArchitecturePage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-5">
        <header className="border-b border-[#d0d5dd] pb-5">
          <h1 className="text-3xl font-bold">System Architecture</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667085]">
            The platform is designed as independent modules with central contracts, server-only integrations, and secure database persistence.
          </p>
        </header>
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {modules.map((module) => (
            <div key={module} className="border border-[#d0d5dd] bg-white p-4 text-sm font-semibold">{module}</div>
          ))}
        </section>
        <section className="border border-[#d0d5dd] bg-white p-5">
          <h2 className="text-lg font-bold">Pipeline</h2>
          <div className="mt-4 grid gap-2 text-sm md:grid-cols-5">
            {["Market search", "Content extraction", "AI classify/extract", "Signal database", "Buyer score"].map((step) => (
              <div key={step} className="border border-[#e4e7ec] bg-[#f8fafc] p-3 text-center font-semibold">{step}</div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
