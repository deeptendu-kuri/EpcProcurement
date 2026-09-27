import { describe, expect, it } from "vitest";
import { countersLine, mergeCounters, progressPercent, stepIndex } from "./run-steps";

describe("run progress helpers", () => {
  it("maps pipeline stages onto collecting → reading → checking → scoring", () => {
    expect(stepIndex([], "queued")).toBe(0);
    expect(stepIndex(["collect", "read", "filter"], "running")).toBe(1);
    expect(stepIndex(["collect", "read", "extract", "info"], "running")).toBe(2);
    expect(stepIndex(["collect", "score"], "running")).toBe(3);
    expect(stepIndex(["collect"], "done")).toBe(4);
    expect(progressPercent(4, {}, "done")).toBe(100);
    expect(progressPercent(0, { sourcesTotal: 4, sourcesDone: 2 }, "running")).toBeLessThan(25);
  });

  it("builds the counters line from what is known", () => {
    expect(countersLine({ sourcesTotal: 5, sourcesDone: 2, sourcesFailed: 1, itemsRead: 24, relevant: 6, newLeads: 3 })).toBe(
      "Searched 3 of 5 sources · read 24 items · 6 relevant · 3 new leads",
    );
    expect(countersLine({ itemsRead: 1, newLeads: 1 })).toBe("Read 1 items · 1 new lead");
    expect(countersLine({})).toBe("");
  });

  it("lets the run row's counters win over older event counters", () => {
    expect(mergeCounters({ newLeads: 3 }, [{ itemsRead: 5, newLeads: 1 }, null])).toEqual({ itemsRead: 5, newLeads: 3 });
  });
});
