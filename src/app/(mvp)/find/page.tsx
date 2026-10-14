import Link from "next/link";
import { getClientProfile } from "@/mvp/config/profile";
import { marketName } from "@/mvp/config/markets";
import { getRun, isUuid } from "@/mvp/repo";
import { listSavedSearches } from "@/mvp/saved-searches";
import { FindForm } from "@/components/mvp/find-form";
import { PageHeader } from "@/components/mvp/page-header";
import { SavedSearchesList } from "@/components/mvp/saved-searches-list";
import {funnelStatus} from '@/mvp/automation/config';
import {AutomationReadiness} from '@/components/mvp/outreach/automation-readiness';
import { SearchLiveWorkspace } from "@/components/mvp/research/search-live-workspace";
import { searchWorkspace } from "@/mvp/research/workspace";
import { aiAllowance } from "@/mvp/llm/quota";
import { groqBlockedModels } from "@/mvp/llm/groq";

interface FindPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Find (docs/mvp/18 §4): the search form, or with ?run=… that search's live workspace. */
export default async function FindPage({ searchParams }: FindPageProps) {
  const params = await searchParams;
  const profile = getClientProfile();
  const runParam = typeof params.run === "string" && isUuid(params.run) ? params.run : null;
  const ticketParam = typeof params.ticket === "string" ? params.ticket.slice(0, 200) : null;
  // "Run again" from the Dashboard: the form starts with that search's material and countries.
  const againParam = typeof params.again === "string" && isUuid(params.again) ? params.again : null;

  // docs/mvp/22: any product can be searched; no product list is needed first.
  if (runParam) {
    const workspace = await searchWorkspace(runParam);
    if (workspace) return <SearchLiveWorkspace key={runParam} runId={runParam} initial={workspace} />;
  }
  const [saved, selectedRun,automation] = await Promise.all([listSavedSearches(), runParam ?? againParam ? getRun((runParam ?? againParam)!) : Promise.resolve(null),funnelStatus()]);
  // Warn before a search starts if the free AI allowance cannot cover it (Groq counts the last 24 hours, per model).
  const ai = await aiAllowance(undefined, groqBlockedModels()).catch(() => null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Find buyers" subtitle="Type any product, the way you would in Google. Pick the countries; we find its open tenders and the companies that buy it, with proof." />
      <AutomationReadiness status={automation}/>
      <FindForm
        markets={profile.markets.map((code) => ({ code, name: marketName(code) }))}
        initialRunId={runParam}
        initialTicketId={ticketParam}
        initialInput={selectedRun?.adhoc_query ?? null}
        aiLeft={ai?.groq ? ai.left : null}
      />
      <details className="card p-4"><summary className="cursor-pointer text-sm font-semibold">Scheduled searches ({saved.length})</summary><div className="mt-4"><SavedSearchesList searches={saved} /></div></details>
      <Link href="/dashboard" className="self-start text-sm text-[var(--muted)] underline">See all your searches on the Dashboard</Link>
    </div>
  );
}
