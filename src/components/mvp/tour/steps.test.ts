import { describe, expect, it } from "vitest";
import { TOUR_LENGTH, TOUR_STEPS, onStepPage, progressText, stepPath, tourSelector } from "./steps";

describe("guided tour step registry (docs/mvp/13 §8)", () => {
  it("has 12 steps with unique ids, in page order Overview → Find → Leads → lead → Pipeline", () => {
    expect(TOUR_LENGTH).toBe(12);
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(12);
    const pages = TOUR_STEPS.map((step) => step.page);
    const order = ["/overview", "/find", "/leads", "lead", "/pipeline"];
    const firstIndex = order.map((page) => pages.indexOf(page as (typeof pages)[number]));
    expect(firstIndex.every((index) => index >= 0)).toBe(true);
    expect([...firstIndex].sort((a, b) => a - b)).toEqual(firstIndex);
    expect(TOUR_STEPS[0].element).toBeUndefined(); // welcome is a centred message
  });

  it("shows progress as 'Step n of 12'", () => {
    expect(progressText(0)).toBe("Step 1 of 12");
    expect(progressText(3)).toBe("Step 4 of 12");
    expect(progressText(11)).toBe("Step 12 of 12");
  });

  it("offers sample leads on every lead step that needs leads", () => {
    for (const step of TOUR_STEPS.filter((item) => item.needsLeads)) {
      expect(step.emptyDescription).toMatch(/Load sample leads/);
      if (step.page === "/leads") expect(step.emptyElement).toBe("load-sample");
    }
  });

  it("builds selectors and page paths, and needs a lead id for the lead page", () => {
    expect(tourSelector("find-query")).toBe('[data-tour="find-query"]');
    const leadStep = TOUR_STEPS.find((step) => step.page === "lead")!;
    expect(stepPath(leadStep, null)).toBeNull();
    expect(stepPath(leadStep, "abc")).toBe("/leads/abc");
    expect(onStepPage(leadStep, "/leads/abc", "abc")).toBe(true);
    expect(onStepPage(TOUR_STEPS[2], "/find", null)).toBe(true);
    expect(onStepPage(TOUR_STEPS[2], "/leads", null)).toBe(false);
  });

  it("points the last step at the first board column (not the whole, taller-than-screen board)", () => {
    const last = TOUR_STEPS[TOUR_STEPS.length - 1];
    expect(last.page).toBe("/pipeline");
    expect(last.element).toBe("pipeline-first-column");
    expect(last.emptyElement).toBe("pipeline-board");
    expect(last.side).toBe("bottom");
  });
});
