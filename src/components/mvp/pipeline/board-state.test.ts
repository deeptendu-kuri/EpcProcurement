import { describe, expect, it } from "vitest";
import type { LeadListItem, LeadStatus } from "@/mvp/types";
import { BOARD_STATUSES, columnSummary, groupByStatus, isBoardStatus } from "./board-state";

const lead = (id: string, status: LeadStatus, score: number | null = 50) => ({ id, status, score }) as LeadListItem;

describe("pipeline board state (docs/mvp/13 §5)", () => {
  it("has the seven board columns and leaves Rejected out", () => {
    expect(BOARD_STATUSES).toEqual(["new", "accepted", "contacted", "rfq", "quoted", "won", "lost"]);
    expect(isBoardStatus("rejected")).toBe(false);
    expect(isBoardStatus("rfq")).toBe(true);
  });

  it("groups leads by their optimistic status and keeps order", () => {
    const items = [lead("a", "new"), lead("b", "accepted"), lead("c", "new"), lead("d", "rejected")];
    const moved = groupByStatus(items, (id, status) => (id === "a" ? "contacted" : status));
    expect(moved.new.map((item) => item.id)).toEqual(["c"]);
    expect(moved.contacted.map((item) => item.id)).toEqual(["a"]);
    expect(moved.accepted.map((item) => item.id)).toEqual(["b"]);
    expect(Object.values(moved).flat().some((item) => item.id === "d")).toBe(false);
  });

  it("summarises a column", () => {
    expect(columnSummary([lead("a", "new", 80), lead("b", "new", 61), lead("c", "new", null)])).toEqual({ count: 3, averageScore: 71 });
    expect(columnSummary([])).toEqual({ count: 0, averageScore: null });
  });
});
