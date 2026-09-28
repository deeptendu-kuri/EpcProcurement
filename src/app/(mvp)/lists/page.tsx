import { SearchWorkspace } from "@/components/mvp/search/search-workspace";
import { catalogueOptions, marketOptions } from "@/components/mvp/search/page-data";
import { DEFAULT_SEARCH } from "@/components/mvp/search/search-state";

/** Lead lists (docs/mvp/14 §10): buyers saved into named lists from SuperSearch. */
export default function ListsPage() {
  return <SearchWorkspace tab="lists" state={DEFAULT_SEARCH} catalogue={catalogueOptions()} markets={marketOptions()} />;
}
