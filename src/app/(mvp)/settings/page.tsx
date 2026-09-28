import Link from "next/link";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { getCatalogue, getStrengths } from "@/mvp/config/buyers-config";
import { getClientProfile } from "@/mvp/config/profile";
import { marketName } from "@/mvp/config/markets";
import { disciplineLabel, formatDate, formatMoney } from "@/components/mvp/labels";
import { PageHeader } from "@/components/mvp/page-header";

/** Human names for the portal registration keys in client-profile.json. */
const REGISTRATION_NAMES: Record<string, string> = {
  gem_cppp: "GeM / CPPP (India)",
  etimad: "Etimad (Saudi Arabia)",
  aramco_ariba: "Aramco supplier registration (Ariba)",
  adnoc_supplier_hub: "ADNOC Supplier Hub (UAE)",
  adgpg_esupply: "ADGPG / Dubai eSupply (UAE)",
  magnet_jqs: "Magnet JQS (Norway)",
  eperolehan: "ePerolehan (Malaysia)",
  espd_ready: "ESPD self-declaration ready (EU / Norway)",
};

function humanKey(key: string): string {
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
      </div>
      <div className="px-4 py-3 text-sm text-[var(--text-2)]">{children}</div>
    </section>
  );
}

function List({ items, empty = "None" }: { items: string[]; empty?: string }) {
  return items.length ? <>{items.join(", ")}</> : <span className="text-[#98a2b3]">{empty}</span>;
}

const TABS = [
  { id: "profile", label: "Company profile" },
  { id: "catalogue", label: "Catalogue" },
  { id: "strengths", label: "Strengths" },
] as const;
type SettingsTab = (typeof TABS)[number]["id"];

function ExampleNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="note" className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm font-semibold text-[#b54708]">
      {children}
    </p>
  );
}

/** Product catalogue (docs/mvp/14 §3): what "What we can sell them" matches against. */
function CatalogueTab() {
  let catalogue: ReturnType<typeof getCatalogue> | null = null;
  try {
    catalogue = getCatalogue();
  } catch (error) {
    console.error("[settings] catalogue unavailable", error);
  }
  if (!catalogue) return <Card title="Catalogue"><p className="text-[#98a2b3]">The catalogue could not be read.</p></Card>;
  const categories = [...new Set(catalogue.items.map((item) => item.category))];
  return (
    <div className="flex flex-col gap-4">
      {catalogue.isExample ? <ExampleNote>Example — replace with your own. This is an example catalogue of pipes and construction materials; edit it to match what you really sell.</ExampleNote> : null}
      {categories.map((category) => (
        <Card key={category} title={category}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-2 py-2 font-semibold">Item</th>
                  <th className="px-2 py-2 font-semibold">Standards</th>
                  <th className="px-2 py-2 font-semibold">Customs (HS) headings</th>
                  <th className="px-2 py-2 font-semibold">Matching words</th>
                </tr>
              </thead>
              <tbody>
                {catalogue.items
                  .filter((item) => item.category === category)
                  .map((item) => (
                    <tr key={item.id} className="data-table-row align-top">
                      <td className="px-2 py-2 font-semibold text-[#101828]">{item.name}</td>
                      <td className="px-2 py-2"><List items={item.standards} empty="—" /></td>
                      <td className="px-2 py-2 tabular-nums"><List items={item.hs} empty="—" /></td>
                      <td className="px-2 py-2 text-xs"><List items={item.keywords.slice(0, 8)} empty="—" />{item.keywords.length > 8 ? ` +${item.keywords.length - 8} more` : ""}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Strengths (docs/mvp/14 §4): "Why you" only shows one when its condition matches verified facts. */
function StrengthsTab() {
  let config: ReturnType<typeof getStrengths> | null = null;
  try {
    config = getStrengths();
  } catch (error) {
    console.error("[settings] strengths unavailable", error);
  }
  if (!config) return <Card title="Strengths"><p className="text-[#98a2b3]">The strengths could not be read.</p></Card>;
  return (
    <div className="flex flex-col gap-4">
      {config.isExample ? <ExampleNote>Example — replace with your own. “Why you” shows a strength to a buyer only when its condition is met by verified facts.</ExampleNote> : null}
      <Card title="Your strengths">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-2 py-2 font-semibold">Strength</th>
                <th className="px-2 py-2 font-semibold">A benefit to the buyer when…</th>
              </tr>
            </thead>
            <tbody>
              {config.strengths.map((strength) => (
                <tr key={strength.id} className="data-table-row align-top">
                  <td className="px-2 py-2 font-semibold text-[#101828]">{strength.text}</td>
                  <td className="px-2 py-2">{strength.when || <span className="text-[#98a2b3]">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

interface SettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Settings (read-only for now): the company profile, the product catalogue and your strengths. */
export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const requested = typeof params.tab === "string" ? params.tab : "profile";
  const tab: SettingsTab = TABS.some((item) => item.id === requested) ? (requested as SettingsTab) : "profile";
  const profile = getClientProfile();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Settings"
        subtitle="Your company profile, what you sell and why buyers should choose you."
        actions={
          <span className="chip">
            <Info size={13} aria-hidden /> Read-only for now
          </span>
        }
      >
        <nav aria-label="Settings sections" className="segmented-control self-start">
          {TABS.map((item) => (
            <Link key={item.id} href={item.id === "profile" ? "/settings" : `/settings?tab=${item.id}`} aria-current={tab === item.id ? "page" : undefined} className="segmented-item">
              {item.label}
            </Link>
          ))}
        </nav>
      </PageHeader>

      {tab === "catalogue" ? <CatalogueTab /> : tab === "strengths" ? <StrengthsTab /> : <ProfileTab profile={profile} />}
    </div>
  );
}

function ProfileTab({ profile }: { profile: ReturnType<typeof getClientProfile> }) {
  return (
    <div className="flex flex-col gap-4">

      {profile.is_example ? (
        <p role="note" className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm font-semibold text-[#b54708]">
          This is an example profile. Replace it with your company’s real data before relying on the results.
        </p>
      ) : null}

      <Card title="Company">
        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr]">
          <dt className="font-semibold text-[#667085]">Name</dt>
          <dd>{profile.company_name}</dd>
          <dt className="font-semibold text-[#667085]">Disciplines</dt>
          <dd><List items={profile.disciplines.map(disciplineLabel)} /></dd>
          <dt className="font-semibold text-[#667085]">Adjacent disciplines</dt>
          <dd><List items={profile.adjacent_disciplines.map(disciplineLabel)} /></dd>
          <dt className="font-semibold text-[#667085]">Sectors</dt>
          <dd><List items={profile.sectors.map(disciplineLabel)} /></dd>
          <dt className="font-semibold text-[#667085]">Project size</dt>
          <dd className="tabular-nums">
            {profile.min_project_value_usd ? `Minimum ${formatMoney(profile.min_project_value_usd, "USD")}` : "No minimum"}
            {profile.sweet_spot_min_usd && profile.sweet_spot_max_usd
              ? ` · sweet spot ${formatMoney(profile.sweet_spot_min_usd, "USD")} – ${formatMoney(profile.sweet_spot_max_usd, "USD")}`
              : ""}
          </dd>
          <dt className="font-semibold text-[#667085]">Ports served</dt>
          <dd><List items={profile.served_ports} /></dd>
          <dt className="font-semibold text-[#667085]">Regions served</dt>
          <dd><List items={profile.served_regions} /></dd>
        </dl>
      </Card>

      <Card title="Products">
        {profile.products.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-2 py-2 font-semibold">Name</th>
                  <th className="px-2 py-2 font-semibold">Discipline</th>
                  <th className="px-2 py-2 font-semibold">Customs (HS) codes</th>
                  <th className="px-2 py-2 font-semibold">Keywords</th>
                  <th className="px-2 py-2 font-semibold">Spec range</th>
                </tr>
              </thead>
              <tbody>
                {profile.products.map((product) => {
                  const spec = [
                    product.spec_ranges.standard?.join(", "),
                    product.spec_ranges.grade?.join(", "),
                    product.spec_ranges.od_in ? `${product.spec_ranges.od_in[0]}–${product.spec_ranges.od_in[1]} in` : null,
                  ].filter(Boolean);
                  return (
                    <tr key={product.id} className="data-table-row align-top">
                      <td className="px-2 py-2 font-semibold text-[#101828]">
                        {product.name}
                        {!product.active ? <span className="ml-2 text-xs text-[#98a2b3]">(paused)</span> : null}
                      </td>
                      <td className="px-2 py-2">{disciplineLabel(product.discipline)}</td>
                      <td className="px-2 py-2 tabular-nums"><List items={product.hs_codes} empty="—" /></td>
                      <td className="px-2 py-2"><List items={product.keywords} empty="—" /></td>
                      <td className="px-2 py-2">{spec.length ? spec.join(" · ") : <span className="text-[#98a2b3]">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[#98a2b3]">No products yet.</p>
        )}
      </Card>

      <Card title="Markets">
        <ul className="flex flex-wrap gap-2">
          {profile.markets.map((code) => (
            <li key={code} className="quiet-chip px-2.5 py-1 text-sm font-semibold">{marketName(code)}</li>
          ))}
        </ul>
      </Card>

      <Card title="Eligibility">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <h3 className="text-sm font-bold text-[#101828]">Certifications</h3>
            <ul className="mt-1 space-y-0.5 text-sm">
              {profile.certifications.map((cert) => <li key={cert}>{cert}</li>)}
              {!profile.certifications.length ? <li className="text-[#98a2b3]">None</li> : null}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#101828]">Portal registrations</h3>
            <ul className="mt-1 space-y-0.5 text-sm">
              {Object.entries(profile.registrations).map(([key, registered]) => (
                <li key={key} className="flex items-center gap-1.5">
                  {registered ? (
                    <CheckCircle2 size={14} className="text-[#067647]" aria-label="Registered" />
                  ) : (
                    <XCircle size={14} className="text-[#98a2b3]" aria-label="Not registered" />
                  )}
                  {REGISTRATION_NAMES[key] ?? humanKey(key)}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#101828]">Local content</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {Object.entries(profile.local_content).map(([country, values]) => (
                <li key={country}>
                  <span className="font-semibold">{marketName(country)}:</span>{" "}
                  {Object.entries(values)
                    .map(([key, value]) => {
                      const shown =
                        value === null || value === undefined || value === ""
                          ? "not set"
                          : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
                            ? formatDate(value)
                            : String(value);
                      return `${humanKey(key)} ${shown}`;
                    })
                    .join(" · ")}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {profile.excluded_company_names.length ? (
        <Card title="Exclusions">
          <List items={profile.excluded_company_names} />
        </Card>
      ) : null}
    </div>
  );
}
