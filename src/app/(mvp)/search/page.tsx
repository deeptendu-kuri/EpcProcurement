import { SearchWorkspace } from "@/components/mvp/search/search-workspace";
import { catalogueOptions, marketOptions } from "@/components/mvp/search/page-data";
import { parseSearchState } from "@/components/mvp/search/search-state";
import { demoEmailEnabled } from "@/mvp/email/config";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** SuperSearch (docs/mvp/14 §10): the main work screen. Filters, page and the open buyer live in the URL. */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const state = parseSearchState(await searchParams);
  return <SearchWorkspace tab="search" state={state} catalogue={catalogueOptions()} markets={marketOptions()} demoEmail={demoEmailEnabled()} />;
}
