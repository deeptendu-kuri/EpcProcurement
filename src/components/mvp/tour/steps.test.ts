import {describe,expect,it} from "vitest";
import {TOUR_LENGTH,TOUR_STEPS,onStepPage,progressText,stepPath,tourSelector} from "./steps";
describe("optional search-scoped guide",()=>{
  it("has six unique steps from a search through a meeting",()=>{
    expect(TOUR_LENGTH).toBe(6);expect(new Set(TOUR_STEPS.map(s=>s.id)).size).toBe(6);
    expect(TOUR_STEPS.map(s=>s.page)).toEqual(["/overview","/find","/crm","lead","/outreach","/outreach"]);
  });
  it("uses actual progress and the visible guide targets",()=>{
    expect(progressText(0)).toBe("Step 1 of 6");expect(progressText(5)).toBe("Step 6 of 6");
    expect(tourSelector("results-tabs")).toBe('[data-tour="results-tabs"]');
  });
  it("explains missing leads without inviting sample data or inventing facts",()=>{
    for(const step of TOUR_STEPS.filter(s=>s.needsLeads)){
      expect(step.emptyDescription).toContain("never creates data or sends email");
      expect(step.emptyDescription).not.toMatch(/Load sample/);
    }
  });
  it("preserves the selected search and opens the full opportunity, not a legacy buyer",()=>{
    const lead=TOUR_STEPS[3];
    expect(stepPath(lead,null,"run")).toBeNull();
    expect(stepPath(lead,"opportunity","run")).toBe("/opportunities/opportunity?returnTo=%2Fcrm%3Frun%3Drun");
    expect(onStepPage(lead,"/opportunities/opportunity","opportunity")).toBe(true);
    expect(stepPath(TOUR_STEPS[2],null,"run")).toBe("/crm?run=run");
  });
  it("does not describe manual drafting or unrelated tender pipelines",()=>{
    const text=TOUR_STEPS.map(s=>s.description).join(" ");
    expect(text).not.toMatch(/open tenders|drag a card|Draft email/);
    expect(text).toContain("approved inbox");
    expect(TOUR_STEPS[5].element).toBe("automation-conversations");
  });
});
