import { describe, expect, it } from "vitest";
import { mergeWorkspaceCache, restoreSearchFilters, rowsForAction } from "./crm-workspace";

describe("CRM workspace contracts", () => {
  it("does not replace a hidden selection with visible records", () => {
    expect(rowsForAction([{ id: "b" }], ["a"], (row) => row.id)).toEqual([]);
  });
  it("exports visible rows only when selection is empty", () => {
    expect(rowsForAction([{ id: "b" }], [], (row) => row.id)).toEqual([{ id: "b" }]);
  });
  it("preserves fields owned by other screens", () => {
    expect(JSON.parse(mergeWorkspaceCache('{"savedSearchLibrary":[1],"crmActivities":[2]}', { listMembership: {} })))
      .toEqual({ savedSearchLibrary: [1], crmActivities: [2], listMembership: {} });
  });
  it("recovers malformed cache safely", () => {
    expect(JSON.parse(mergeWorkspaceCache("broken", { notes: "kept" }))).toEqual({ notes: "kept" });
  });
  it("restores legacy searches without leaking previous filters", () => {
    expect(restoreSearchFilters().jobTitles).toEqual([]);
    expect(restoreSearchFilters().skipOwned).toBe(false);
  });
  it("round trips all advanced search filters", () => {
    const filters = { ...restoreSearchFilters(), jobTitles: ["Director"], industries: ["Water"], employees: ["500+"], emailStatuses: ["Verified"], skipOwned: true, verifiedOnly: false, oneLeadPerCompany: false, sortMode: "company" as const };
    expect(restoreSearchFilters(JSON.parse(JSON.stringify(filters)))).toEqual(filters);
  });
});
