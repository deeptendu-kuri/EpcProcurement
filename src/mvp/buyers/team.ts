/**
 * Buying team (docs/mvp/14 §8): slots per buyer role, filled by people named in verified sources whose
 * title matches the slot (status `likely`), `confirmed` when a user marked the person, else
 * `not_found` with Find links (web searches only — nothing is scraped). Pure.
 */
import type { BuyerRole, ContactSlot, SlotRole } from "./types";

export interface SlotDef {
  slotId: string;
  role: SlotRole;
  title: string;
  description: string;
  /** Department (Contacts filter): Procurement, Projects, QA/QC, Management, Operations, Vendor registration. */
  department: string;
  /** Title words that fill this slot. */
  match: RegExp | null;
  /** Words used in the Find searches ("procurement manager"). */
  search: string;
}

const HEAD_PROC = /\b(?:head|director|vp|vice president|chief|general manager|gm|manager)\b.*\b(?:procurement|purchas\w*|supply chain|sourcing|materials management)\b|\b(?:procurement|purchas\w*|supply chain|sourcing)\b.*\b(?:head|director|manager|lead)\b|\bcpo\b|chief procurement/i;
const BUYER = /\b(?:buyer|purchas\w*|procurement|sourcing|category)\b/i;
const PM = /\bprojects? manager\b|\bproject lead\b/i;
const PD = /\bprojects? director\b|\bhead of projects\b|\bproject executive\b/i;
const CM = /\b(?:construction|site|field) manager\b|\bconstruction director\b/i;
const QA = /\b(?:qa|qc|qa\/qc|quality)\b/i;
const EXPEDITE = /\b(?:expedit\w*|planning|planner|material control)\b/i;
const PLANT = /\b(?:plant|production|works|factory|operations|mill) (?:manager|head|director)\b|\bhead of (?:production|operations)\b/i;
const BRANCH = /\b(?:branch|plant|general|operations|sales) manager\b|\bgeneral manager\b/i;
const EXEC = /\b(?:ceo|chief executive|managing director|md|president|chairman|owner|founder|proprietor|partner|director general)\b/i;
const PKG = /\bpackage (?:manager|lead|engineer)\b|\bdiscipline lead\b/i;

const VENDOR = (who: string): SlotDef => ({
  slotId: "vendor-registration",
  role: "vendor_registration",
  title: "Vendor registration",
  description: `Official way to become a ${who} supplier`,
  department: "Vendor registration",
  match: null,
  search: "vendor registration",
});

/** Slot definitions for a role (14 §8 table). `who` is the company's short name for descriptions. */
export function slotDefs(role: BuyerRole, who = "their"): SlotDef[] {
  switch (role) {
    case "epc_contractor":
      return [
        { slotId: "head-procurement", role: "decision_maker", title: "Head of procurement", description: "Signs off new vendors and big orders", department: "Procurement", match: HEAD_PROC, search: "head of procurement" },
        { slotId: "category-buyer", role: "buyer", title: "Category buyer — piping / materials", description: "Raises the purchase orders", department: "Procurement", match: BUYER, search: "piping buyer procurement" },
        { slotId: "project-manager", role: "influencer", title: "Project manager", description: "Runs the project; can recommend vendors", department: "Projects", match: PM, search: "project manager" },
        { slotId: "construction-manager", role: "influencer", title: "Construction manager", description: "Needs material on site on time", department: "Projects", match: CM, search: "construction manager" },
        { slotId: "qaqc", role: "technical_approver", title: "QA/QC manager", description: "Approves new materials and suppliers", department: "QA/QC", match: QA, search: "QA/QC manager" },
        { slotId: "expediting", role: "buyer", title: "Expediting / planning", description: "Chases deliveries; knows what is late", department: "Procurement", match: EXPEDITE, search: "expediting" },
        VENDOR(who),
      ];
    case "subcontractor":
      return [
        { slotId: "md-owner", role: "decision_maker", title: "MD / owner", description: "Decides and approves purchases", department: "Management", match: EXEC, search: "managing director" },
        { slotId: "procurement", role: "buyer", title: "Procurement", description: "Raises the purchase orders", department: "Procurement", match: BUYER, search: "procurement" },
        { slotId: "site-manager", role: "influencer", title: "Site manager", description: "Needs material on site on time", department: "Projects", match: new RegExp(`${CM.source}|${PM.source}`, "i"), search: "site manager" },
      ];
    case "manufacturer":
      return [
        { slotId: "head-procurement", role: "decision_maker", title: "Head of procurement / supply chain", description: "Signs off new vendors", department: "Procurement", match: HEAD_PROC, search: "head of procurement supply chain" },
        { slotId: "raw-materials-buyer", role: "buyer", title: "Buyer — raw materials & consumables", description: "Raises the purchase orders", department: "Procurement", match: BUYER, search: "raw materials buyer" },
        { slotId: "qaqc", role: "technical_approver", title: "QA/QC manager", description: "Approves new materials and suppliers", department: "QA/QC", match: QA, search: "QA/QC manager" },
        { slotId: "plant-manager", role: "influencer", title: "Production / plant manager", description: "Uses the materials; can recommend", department: "Operations", match: PLANT, search: "plant manager" },
        { slotId: "ceo-md", role: "approver", title: "CEO / MD", description: "Approves large orders", department: "Management", match: EXEC, search: "CEO" },
        VENDOR(who),
      ];
    case "fabricator":
    case "distributor":
      return [
        { slotId: "procurement", role: "decision_maker", title: "Procurement / purchasing", description: "Decides what to buy and from whom", department: "Procurement", match: BUYER, search: "purchasing manager" },
        { slotId: "branch-manager", role: "influencer", title: role === "fabricator" ? "Plant / workshop manager" : "Branch manager", description: "Knows what stock is moving", department: "Operations", match: new RegExp(`${BRANCH.source}|${PLANT.source}`, "i"), search: role === "fabricator" ? "workshop manager" : "branch manager" },
        { slotId: "owner-md", role: "approver", title: "Owner / MD", description: "Approves new suppliers", department: "Management", match: EXEC, search: "managing director" },
      ];
    case "owner":
      return [
        { slotId: "procurement-head", role: "decision_maker", title: "Procurement head", description: "Runs tenders and vendor lists", department: "Procurement", match: new RegExp(`${HEAD_PROC.source}|\\b(?:tender|contracts?) (?:manager|head|director|committee)\\b`, "i"), search: "procurement head" },
        { slotId: "project-director", role: "approver", title: "Project director", description: "Approves the project's purchases", department: "Projects", match: new RegExp(`${PD.source}|${PM.source}`, "i"), search: "project director" },
        { slotId: "package-manager", role: "influencer", title: "Package manager", description: "Owns the package; writes the specs", department: "Projects", match: PKG, search: "package manager" },
        VENDOR(who),
      ];
  }
}

/** A person named in a verified source at the buyer company. */
export interface TeamPerson {
  id: string;
  name: string;
  title: string | null;
  department?: string | null;
  /** Buying roles from person_roles (fallback when the title is missing). */
  buyingRoles?: string[];
  evidenceIds: string[];
}

const BUYING_ROLE_SLOT: Record<string, SlotRole[]> = {
  procurement_lead: ["decision_maker", "buyer"],
  tender_contact: ["decision_maker"],
  executive: ["approver", "decision_maker"],
  project_director: ["approver", "influencer"],
  decision_maker: ["influencer", "approver"],
  package_manager: ["influencer"],
  technical_evaluator: ["technical_approver"],
  expediting: ["buyer"],
};

function personFits(def: SlotDef, person: TeamPerson): boolean {
  if (!def.match) return false;
  const title = `${person.title ?? ""} ${person.department ?? ""}`.trim();
  if (title) return def.match.test(title);
  return (person.buyingRoles ?? []).some((r) => BUYING_ROLE_SLOT[r]?.includes(def.role));
}

/** Web searches that help fill a slot (they open in the user's browser; nothing is fetched or scraped). */
export function findLinks(company: string, def: Pick<SlotDef, "search" | "title" | "role">, website: string | null = null): ContactSlot["findLinks"] {
  const google = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  if (def.role === "vendor_registration") {
    return [
      { label: "Vendor registration page", url: google(`${company} vendor registration`) },
      { label: "Supplier portal", url: google(`${company} supplier registration portal`) },
      { label: "Contact page", url: google(website ? `site:${website.replace(/^https?:\/\//, "").replace(/\/.*$/, "")} contact` : `${company} contact`) },
    ];
  }
  return [
    { label: `Search "${def.title}"`, url: google(`${company} ${def.search}`) },
    { label: "LinkedIn people", url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company} ${def.search}`)}` },
    { label: "Contact page", url: google(website ? `site:${website.replace(/^https?:\/\//, "").replace(/\/.*$/, "")} contact` : `${company} contact`) },
  ];
}

/**
 * Fill the role's slots with named people (14 §8): each slot takes the first unassigned person whose
 * title (or buying role) matches; `confirmed` when the user confirmed that person, else `likely`.
 * Specific slots are filled before generic ones (head of procurement before "buyer").
 */
export function buildTeam(
  role: BuyerRole,
  company: string,
  people: readonly TeamPerson[],
  opts: { confirmedPersonIds?: ReadonlySet<string>; website?: string | null; who?: string } = {},
): ContactSlot[] {
  const defs = slotDefs(role, opts.who ?? company);
  const taken = new Set<string>();
  const filled = new Map<string, TeamPerson>();
  // Pass 1: title matches, in slot order (the definitions list specific slots first).
  for (const def of defs) {
    const person = people.find((p) => !taken.has(p.id) && p.title && personFits(def, p));
    if (person) {
      filled.set(def.slotId, person);
      taken.add(person.id);
    }
  }
  // Pass 2: people without a title, by buying role.
  for (const def of defs) {
    if (filled.has(def.slotId)) continue;
    const person = people.find((p) => !taken.has(p.id) && !p.title && personFits(def, p));
    if (person) {
      filled.set(def.slotId, person);
      taken.add(person.id);
    }
  }
  return defs.map((def) => {
    const person = filled.get(def.slotId) ?? null;
    return {
      slotId: def.slotId,
      role: def.role,
      title: def.title,
      description: def.description,
      person: person ? { id: person.id, name: person.name, title: person.title, evidenceIds: person.evidenceIds } : null,
      status: person ? (opts.confirmedPersonIds?.has(person.id) ? "confirmed" : "likely") : "not_found",
      findLinks: findLinks(company, def, opts.website ?? null),
    };
  });
}

/** Department of a slot (for the Contacts filter). */
export function slotDepartment(role: BuyerRole, slotId: string): string {
  return slotDefs(role).find((d) => d.slotId === slotId)?.department ?? "Other";
}

/** "X of Y found". */
export function teamCounts(team: readonly ContactSlot[]): { found: number; total: number } {
  return { found: team.filter((s) => s.person).length, total: team.length };
}
