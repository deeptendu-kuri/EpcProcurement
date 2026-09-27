/**
 * The 12 steps of the guided tour (docs/mvp/13 §8). Each step lives on one page and points at an
 * element marked `data-tour="<element>"` (no element = a centred message). Steps that need leads
 * fall back to `emptyElement` (the "Load sample leads" button) when there are none.
 */

/** "lead" = the page of one lead (the controller picks the best lead). */
export type TourPage = "/overview" | "/find" | "/leads" | "/pipeline" | "lead";

export interface TourStep {
  id: string;
  page: TourPage;
  /** Value of the data-tour attribute to highlight; omitted = centred popover. */
  element?: string;
  title: string;
  description: string;
  side?: "top" | "right" | "bottom" | "left";
  /** The step only makes sense with leads in the database. */
  needsLeads?: boolean;
  /** Highlighted instead when there are no leads. */
  emptyElement?: string;
  /** Shown instead of `description` when there are no leads. */
  emptyDescription?: string;
}

const NO_LEADS = "There are no leads yet. Click “Load sample leads” to try the tool with clearly badged sample data, or run a search on Find.";

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    page: "/overview",
    title: "Welcome",
    description:
      "This tool finds companies that are about to buy what you sell – tenders to bid and projects to supply – and shows the proof behind every fact. This tour takes about two minutes.",
  },
  {
    id: "overview",
    page: "/overview",
    element: "overview-kpis",
    title: "Your overview",
    description:
      "New leads this week, genuine leads, tenders closing soon and leads in your pipeline. “Updated x min ago” shows when the data last refreshed; saved searches refresh it automatically.",
    side: "bottom",
  },
  {
    id: "find-query",
    page: "/find",
    element: "find-query",
    title: "Type what you offer",
    description: "Plain words are enough, e.g. “line pipe” or “piping works”. The chips below come from your products in Settings.",
    side: "bottom",
  },
  {
    id: "find-markets",
    page: "/find",
    element: "find-markets",
    title: "Markets and lead type",
    description: "Pick the countries to search, and whether you want tenders to bid, supply / subcontract work, or both.",
    side: "top",
  },
  {
    id: "find-search",
    page: "/find",
    element: "find-search-now",
    title: "Search now",
    description:
      "Search now reads live sources (tender portals and trade news). A progress line shows each step: collecting, reading, checking, scoring. One search runs at a time; others wait in line.",
    side: "bottom",
  },
  {
    id: "find-save",
    page: "/find",
    element: "find-save",
    title: "Save this search",
    description: "Save a search to refresh it automatically every 6, 12 or 24 hours while the app runs. New leads then appear without you asking.",
    side: "top",
  },
  {
    id: "leads-tabs",
    page: "/leads",
    element: "leads-tabs",
    title: "Your leads, sorted by class",
    description:
      "Genuine: checked and worth contacting. Needs research: promising, but facts are missing. Watching: too early or too weak for now. Rejected: failed a check – the reason is shown.",
    side: "bottom",
    needsLeads: true,
    emptyElement: "load-sample",
    emptyDescription: NO_LEADS,
  },
  {
    id: "leads-filters",
    page: "/leads",
    element: "leads-filters",
    title: "Filters, Latest and pages",
    description:
      "Filter by category, market, type, stage, status or date added – the numbers show how many leads each option has. Sort by Latest, Highest score or Closing soon, and page through 10, 25 or 50 at a time.",
    side: "bottom",
  },
  {
    id: "leads-preview",
    page: "/leads",
    element: "leads-first-row",
    title: "Quick preview",
    description: "Click a lead for a quick preview with its reasons and proof. Accept or reject it there, or open the full lead page.",
    side: "bottom",
    needsLeads: true,
    emptyElement: "load-sample",
    emptyDescription: NO_LEADS,
  },
  {
    id: "lead-why",
    page: "lead",
    element: "lead-why",
    title: "Why this lead, with proof",
    description: "Each reason has an ⓘ button. It opens the exact quote, the source and a link to the page it came from.",
    side: "bottom",
    needsLeads: true,
    emptyDescription: NO_LEADS,
  },
  {
    id: "lead-score",
    page: "lead",
    element: "lead-rail",
    title: "Score, confidence, compliance and contact rules",
    description:
      "The score (0–100) adds up five checks – see Score for each one. Confidence says how much we trust the facts. The side panel sums up compliance to bid and the contact rules of each person’s country.",
    side: "left",
    needsLeads: true,
    emptyDescription: NO_LEADS,
  },
  {
    id: "pipeline",
    page: "/pipeline",
    // The first column header: the whole board is taller than the screen and would scroll under the top bar.
    element: "pipeline-first-column",
    emptyElement: "pipeline-board",
    title: "Draft email, then move leads to a deal",
    description:
      "On a lead, Draft email writes a short first email for a contact (turned off when that country needs consent first). Then follow each lead here: drag a card from New to Won, or use its status menu.",
    side: "bottom",
  },
];

export const TOUR_LENGTH = TOUR_STEPS.length;

/** "Step 4 of 12". */
export function progressText(index: number, total = TOUR_LENGTH): string {
  return `Step ${index + 1} of ${total}`;
}

/** CSS selector for a data-tour value. */
export function tourSelector(element: string): string {
  return `[data-tour="${element}"]`;
}

/** The URL of a step's page (null when it needs a lead and none is known). */
export function stepPath(step: TourStep, leadId: string | null): string | null {
  if (step.page === "lead") return leadId ? `/leads/${leadId}` : null;
  return step.page;
}

/** True when the current pathname is the step's page. */
export function onStepPage(step: TourStep, pathname: string, leadId: string | null): boolean {
  const path = stepPath(step, leadId);
  return path !== null && pathname === path;
}
