import { describe, expect, it } from "vitest";
import { countersLine, mergeCounters, progressPercent, runStatusText, stepIndex } from "./run-steps";

describe("run progress helpers", () => {
  it("never describes paused research as a fully finished search",()=>{
    expect(runStatusText('done',{researchState:'partial'})).toBe('Finished · partial coverage');
    expect(runStatusText('done',{coverageIncomplete:true})).toBe('Finished · partial coverage');
    expect(runStatusText('done')).toBe('Finished');
    expect(runStatusText('running',{coverageIncomplete:true})).toBe('Running');
    expect(runStatusText('failed',{researchState:'partial'})).toBe('Stopped');
  });
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
      "Completed 3 of 5 source checks · read 24 items · 6 candidate pages · 3 new raw lead records",
    );
    expect(countersLine({ itemsRead: 1, newLeads: 1 })).toBe("Read 1 items · 1 new raw lead records");
    expect(countersLine({ newLeads: 15, scopedProspects: 0 })).toBe("0 buyer prospects saved");
    expect(countersLine({ scopedProspects: 2,deferredPages:4,buyerAnalysisFailed:1 })).toBe("2 buyer prospects saved · 4 pages deferred by budget · 1 analysis failures");
    expect(countersLine({})).toBe("");
  });

  it("lets the run row's counters win over older event counters", () => {
    expect(mergeCounters({ newLeads: 3 }, [{ itemsRead: 5, newLeads: 1 }, null])).toEqual({ itemsRead: 5, newLeads: 3 });
    expect(mergeCounters({coverageIncomplete:false,researchState:"done",researchStopReason:null},[{coverageIncomplete:true,researchState:"partial",researchStopReason:"budget"}])).toMatchObject({coverageIncomplete:false,researchState:"done",researchStopReason:null});
  });
});
