import { SquareKanban } from "lucide-react";
import { leadFacets, listLeads } from "@/mvp/repo";
import type { LeadFilter } from "@/mvp/types";
import { EmptyState } from "@/components/mvp/empty-state";
import { PageHeader } from "@/components/mvp/page-header";
import { parseLeadsState } from "@/components/mvp/leads/url-state";
import { BOARD_STATUSES } from "@/components/mvp/pipeline/board-state";
import { PipelineBoard } from "@/components/mvp/pipeline/pipeline-board";
import { PipelineFilters } from "@/components/mvp/pipeline/pipeline-filters";

interface PipelinePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Pipeline board (docs/mvp/13 §5): follow leads from New to Won. Filters (search, market, category, type) live in the URL. */
export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const state = parseLeadsState(await searchParams);
  const filter: LeadFilter = {
    statuses: [...BOARD_STATUSES],
    q: state.q || undefined,
    market: state.market || undefined,
    discipline: state.category || undefined,
    kind: state.kind || undefined,
    sort: "score",
    limit: 500,
  };
  const [{ items }, facets, any] = await Promise.all([
    listLeads(filter),
    leadFacets({ statuses: [...BOARD_STATUSES] }),
    listLeads({ statuses: [...BOARD_STATUSES], limit: 1 }),
  ]);
  const filtered = Boolean(state.q || state.market || state.category || state.kind);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Pipeline" subtitle="Drag a lead to its next step, or use its status menu. Every move is saved in the lead's activity." />
      {any.total > 0 ? <PipelineFilters state={state} facets={facets} /> : null}
      {items.length ? (
        <PipelineBoard items={items} />
      ) : filtered ? (
        <div data-tour="pipeline-board">
          <EmptyState icon={<SquareKanban size={20} aria-hidden />} title="No leads match these filters" text="Clear a filter to see more of your pipeline." />
        </div>
      ) : (
        <div data-tour="pipeline-board">
          <EmptyState icon={<SquareKanban size={20} aria-hidden />} title="No leads in the pipeline yet" text="Accept leads on the Leads page, or load sample leads to try the board." showSample />
        </div>
      )}
    </div>
  );
}
