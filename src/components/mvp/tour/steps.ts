/**
 * The 12 steps of the guided tour (docs/mvp/13 §8). Each step lives on one page and points at an
 * element marked `data-tour="<element>"` (no element = a centred message). Steps that need leads
 * fall back to `emptyElement` (the "Load sample leads" button) when there are none.
 */

/** "lead" = the full page of one buyer (the controller picks the best one). */
export type TourPage = "/overview" | "/find" | "/search" | "/pipeline" | "lead";

export interface TourStep {
  id: string;
  page: TourPage;
  /** Value of the data-tour attribute to highlight; omitted = centred popover. */
  element?: string;
  title: string;
  description: string;
  side?: "top" | "right" | "bottom" | "left";
  /** The step only makes sense with buyers in the database. */
  needsLeads?: boolean;
  /** Highlighted instead when there are no buyers. */
  emptyElement?: string;
  /** Shown instead of `description` when there are no buyers. */
  emptyDescription?: string;
}

const NO_LEADS = "There are no buyers yet. Click “Load sample buyers” to try the tool with clearly badged sample data, or run a live search.";

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    page: "/overview",
    title: "Welcome",
    description:
      "This tool finds companies that are about to buy what you sell – pipes, fittings, valves and other construction materials – and shows the proof behind every fact. This tour takes about two minutes.",
  },
  {
    id: "overview",
    page: "/overview",
    element: "overview-kpis",
    title: "Your overview",
    description:
      "New buyers this week, buyers ready to approach, tenders closing soon and buyers in your pipeline. “Updated x min ago” shows when the data last refreshed; saved searches refresh it automatically.",
    side: "bottom",
  },
  {
    id: "find-query",
    page: "/find",
    element: "find-query",
    title: "Run a live search",
    description: "“Search now” opens this page. Plain words are enough, e.g. “line pipe” or “piping works”. The chips below come from your products in Settings.",
    side: "bottom",
  },
  {
    id: "find-markets",
    page: "/find",
    element: "find-markets",
    title: "Markets",
    description: "Pick the countries to search, and whether you want open tenders, companies that just won work, or both.",
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
    description: "Save a search to refresh it automatically every 6, 12 or 24 hours while the app runs. New buyers then appear without you asking.",
    side: "top",
  },
  {
    id: "search-filters",
    page: "/search",
    element: "search-filters",
    title: "SuperSearch filters",
    description:
      "Narrow the buyers by location, buyer role, what you can sell them, buying signal and contacts. Each filter has “Is any of” and “Is not any of”. Competitors – companies that make what you sell – are hidden by default.",
    side: "right",
  },
  {
    id: "search-count",
    page: "/search",
    element: "search-count",
    title: "Buyers and the people to approach",
    description:
      "How many buyers match, and how many contacts their buying teams have (and how many we found). Switch between Buyers and Contacts, save buyers to a Lead list, export them, or use Find contacts for the missing people.",
    side: "bottom",
    needsLeads: true,
    emptyElement: "load-sample",
    emptyDescription: NO_LEADS,
  },
  {
    id: "search-open",
    page: "/search",
    element: "search-first-row",
    title: "Open a buyer",
    description:
      "Click a buyer for the side panel: why they will buy now, what you can sell them, when they buy, their supply chain, their buying team and the proof. Tier 2 and 3 rows are companies found in the supply chain of a deal – “Save as buyer” keeps them. Mark a buyer Good lead or Not relevant there, or open the full page.",
    side: "bottom",
    needsLeads: true,
    emptyElement: "load-sample",
    emptyDescription: NO_LEADS,
  },
  {
    id: "lead-why",
    page: "lead",
    element: "lead-why",
    title: "The buyer at a glance",
    description:
      "Who is buying and the deal in one line, what they’ll buy from you, when, and why you. Proof further down shows the exact quote and the source of each fact.",
    side: "bottom",
    needsLeads: true,
    emptyDescription: NO_LEADS,
  },
  {
    id: "lead-chain",
    page: "lead",
    element: "buyer-chain",
    title: "The supply chain: more buyers from one deal",
    description:
      "The company that won the work buys from makers, stockists and specialist crews – and each of them can buy from you. Colours show how we know each link: confirmed by a source, likely from past work, or possible. Use “Find candidates” or “Set company” to fill a gap, and the contacts table below to find, add and confirm the people.",
    side: "top",
    needsLeads: true,
    emptyDescription: NO_LEADS,
  },
  {
    id: "pipeline",
    page: "/pipeline",
    // The first column header: the whole board is taller than the screen and would scroll under the top bar.
    element: "pipeline-first-column",
    emptyElement: "pipeline-board",
    title: "Draft email, then move buyers to a deal",
    description:
      "On a buyer, Draft email writes a short first email for a contact (turned off when that country needs consent first). Then follow each buyer here: drag a card from New to Won, or use its status menu.",
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
  if (step.page === "lead") return leadId ? `/buyers/${leadId}` : null;
  return step.page;
}

/** True when the current pathname is the step's page. */
export function onStepPage(step: TourStep, pathname: string, leadId: string | null): boolean {
  const path = stepPath(step, leadId);
  return path !== null && pathname === path;
}
