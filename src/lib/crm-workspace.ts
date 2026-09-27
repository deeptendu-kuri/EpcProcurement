export interface SearchFilters {
  jobTitles: string[];
  industries: string[];
  employees: string[];
  emailStatuses: string[];
  verifiedOnly: boolean;
  skipOwned: boolean;
  oneLeadPerCompany: boolean;
  sortMode: "score" | "company" | "contact";
}

export function restoreSearchFilters(filters?: Partial<SearchFilters>): SearchFilters {
  return {
    jobTitles: filters?.jobTitles ?? [], industries: filters?.industries ?? [],
    employees: filters?.employees ?? [], emailStatuses: filters?.emailStatuses ?? [],
    verifiedOnly: filters?.verifiedOnly ?? true, skipOwned: filters?.skipOwned ?? false,
    oneLeadPerCompany: filters?.oneLeadPerCompany ?? true, sortMode: filters?.sortMode ?? "score",
  };
}

export function rowsForAction<T>(visible: T[], selected: string[], id: (row: T) => string): T[] {
  return selected.length ? visible.filter((row) => selected.includes(id(row))) : visible;
}

// Each screen owns only part of this shared cache. Never replace unrelated fields.
export function mergeWorkspaceCache(raw: string | null, patch: object): string {
  let previous: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) previous = parsed as Record<string, unknown>;
  } catch { /* A malformed cache must not prevent saving current work. */ }
  return JSON.stringify({ ...previous, ...patch });
}
