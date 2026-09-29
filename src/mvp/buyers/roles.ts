/**
 * Buyer roles and situations (docs/mvp/14 §2, §5): which of the six roles a company plays, its
 * sub-role label ("Pipe mill", "Piping subcontractor") and the situation that picks its needs rule
 * (project type for EPCs and owners, discipline for subcontractors, product for manufacturers).
 * Pure functions; no database.
 */
import { getKnownCompanies, type KnownCompany } from "@/mvp/config/buyers-config";
import { companyNameParts, normalizeCompanyName } from "@/mvp/pipeline/text";
import { BUYER_ROLE_LABELS, type BuyerRole } from "./types";

export const BUYER_ROLES: readonly BuyerRole[] = ["owner", "epc_contractor", "subcontractor", "manufacturer", "fabricator", "distributor"];

export type ProjectType = "pipeline" | "plant" | "water" | "drilling";
export type SubDiscipline = "piping" | "civil" | "electrical" | "insulation" | "coating";
export type MakerKind = "pipe_mill" | "valve_maker" | "equipment_maker";
export type Situation = ProjectType | SubDiscipline | MakerKind | null;

export function isBuyerRole(value: unknown): value is BuyerRole {
  return typeof value === "string" && (BUYER_ROLES as readonly string[]).includes(value);
}

export function roleLabel(role: BuyerRole): string {
  return BUYER_ROLE_LABELS[role];
}

// ───────────────────────── known companies ─────────────────────────

let knownIndex: Map<string, KnownCompany> | undefined;

function knownKeys(name: string): string[] {
  const { main, aliases } = companyNameParts(name);
  return [main, ...aliases].map((part) => normalizeCompanyName(part)).filter((key) => key.length >= 2);
}

/** The known-companies entry for a company name (any alias), or null (14 §6). */
export function findKnownCompany(name: string | null | undefined): KnownCompany | null {
  if (!name) return null;
  if (!knownIndex) {
    knownIndex = new Map();
    for (const company of getKnownCompanies().companies)
      for (const alias of company.names) for (const key of knownKeys(alias)) if (!knownIndex.has(key)) knownIndex.set(key, company);
  }
  const keys = knownKeys(name);
  for (const key of keys) {
    const hit = knownIndex.get(key);
    if (hit) return hit;
  }
  // A unit / associate / division of a known company ("Welspun Corp Unit", "Welspun Corp Associate").
  for (const key of keys) {
    const trimmed = key.replace(/(?:\s+(?:unit|units|associate|associates|division|plant|branch|subsidiary|arm|business|segment|jv))+$/, "");
    if (trimmed !== key) {
      const hit = knownIndex.get(trimmed);
      if (hit) return hit;
    }
  }
  // A shortened form of a known name ("East Pipes Integrated Company" for "… Company for Industry"):
  // the first 2+ words of the known name, word for word.
  for (const key of keys) {
    const words = key.split(" ");
    if (words.length < 2) continue;
    for (const [known, company] of knownIndex) {
      const theirs = known.split(" ");
      if (theirs.length > words.length && words.every((w, i) => theirs[i] === w)) return company;
    }
  }
  return null;
}

// ───────────────────────── supplier → manufacturer / fabricator / distributor ─────────────────────────

const FABRICATOR_RE = /\b(?:fabricat\w*|spool(?:s|ing)?|fabrication yard|pipe shop|engineering works)\b/i;
const DISTRIBUTOR_RE = /\b(?:stockists?|distribut\w*|trading|traders?|merchants?|dealers?|wholesal\w*|resell\w*|supply (?:co|company|house))\b/i;
const MAKER_RE = /\b(?:manufactur\w*|makes?|making|mills?|plants?|produc\w*|factory|factories|foundry|works)\b/i;
const MAKER_NAME_RE = /\b(?:pipes?|tubes?|tubulars?|steel|valves?|mills?|metals?|fittings?|flanges?|castings?|forgings?|seamless|cables?)\b/i;

/**
 * Role of a company that won a supply order (the old `supplier`, 14 §2): a known company's role; else
 * fabricator / distributor / manufacturer from what the text says it does; else from its company
 * types; else manufacturer when the name or text says it makes things (mill, plant, "pipes"), otherwise
 * distributor.
 */
export function supplierRoleFor(name: string, types: readonly string[] = [], text = ""): "manufacturer" | "fabricator" | "distributor" {
  const known = findKnownCompany(name);
  if (known && (known.role === "manufacturer" || known.role === "fabricator" || known.role === "distributor")) return known.role;
  const both = `${name} ${text}`;
  if (FABRICATOR_RE.test(name) || (FABRICATOR_RE.test(text) && !MAKER_RE.test(text))) return "fabricator";
  if (DISTRIBUTOR_RE.test(name)) return "distributor";
  if (types.includes("fabricator")) return "fabricator";
  if (types.includes("stockist_trader")) return "distributor";
  if (MAKER_RE.test(both) || MAKER_NAME_RE.test(name)) return "manufacturer";
  if (DISTRIBUTOR_RE.test(text)) return "distributor";
  return "distributor";
}

/**
 * Buyer role of a lead: the stored `buyer_type` when it is one of the six roles; the legacy
 * `supplier` (or null) is mapped from the company's name, types and text.
 */
export function resolveBuyerRole(stored: string | null | undefined, name: string, types: readonly string[] = [], text = "", kind: string | null = null): BuyerRole {
  // The curated known-companies list wins over a supply-side role guessed at ingest
  // ("Welspun Corp Unit" stored as distributor is the Welspun Corp pipe mill).
  const supplySide = (r: unknown) => r === "supplier" || r === "manufacturer" || r === "fabricator" || r === "distributor";
  const knownRole = findKnownCompany(name)?.role;
  if (knownRole && supplySide(stored) && supplySide(knownRole)) return knownRole;
  // Wholesalers are stockists, never builders (15 §A5).
  if (isWholesaler(name, text)) return "distributor";
  if (isBuyerRole(stored)) return stored;
  if (stored === "supplier") return supplierRoleFor(name, types, text);
  const known = findKnownCompany(name);
  if (known) return known.role;
  if (types.includes("main_epc")) return "epc_contractor";
  if (types.includes("subcontractor")) return "subcontractor";
  if (types.includes("owner") || types.includes("government_buyer") || kind === "bid") return "owner";
  if (types.includes("manufacturer") || types.includes("fabricator") || types.includes("stockist_trader")) return supplierRoleFor(name, types, text);
  return "epc_contractor";
}

/** Wholesalers → Stockist (15 §A5). Name words, or strong wholesaler words in the text about them. */
const WHOLESALER_NAME_RE = /(?:wholesal\w*|grossist\w*|\bdistributors?\b|\btrading\b|\bstockists?\b|rørhandel|rorhandel|vvs-grossist)/i;
const WHOLESALER_TEXT_RE = /(?:wholesaler|grossist\w*|rørhandel|vvs-grossist|pipe stockist|stockist of)/i;

export function isWholesaler(name: string, text = ""): boolean {
  if (findKnownCompany(name)?.role === "distributor") return true;
  if (WHOLESALER_NAME_RE.test(name)) return true;
  if (!text) return false;
  // Only when the wholesaler word sits next to the company's name ("VVS-grossisten Brødrene Dahl").
  const first = name.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}]/gu, "");
  if (!first || first.length < 3) return false;
  const re = new RegExp(`(?:${WHOLESALER_TEXT_RE.source})[^.]{0,40}${first}|${first}[^.]{0,60}(?:${WHOLESALER_TEXT_RE.source})`, "iu");
  return re.test(text);
}

// ───────────────────────── situations ─────────────────────────

export interface SituationFacts {
  projectType?: string | null;
  sector?: string | null;
  projectName?: string | null;
  /** Package disciplines of the lead / project. */
  disciplines?: readonly string[];
  /** Free text: package names and scope, requirement items, evidence sentences about the buyer. */
  text?: string;
}

/** Project type for the needs map (14 §5): pipeline, plant/facility, water & sewage, upstream drilling. */
export function projectTypeFor(facts: SituationFacts): ProjectType | null {
  const structured = `${facts.projectType ?? ""} ${facts.projectName ?? ""}`.toLowerCase();
  const text = (facts.text ?? "").toLowerCase();
  const disciplines = facts.disciplines ?? [];
  const drilling = /\b(?:drilling|rigs?|wells?|octg|casing and tubing|well construction)\b/;
  const plantWords = /\b(?:refiner\w*|petrochemical|cracker|power (?:plant|station)|gas processing|treatment plant|desalination|lng|fertili[sz]er|terminal|facility|facilities|complex|processing plant|plant)\b/;
  const waterWords = /\b(?:water|sewage|sewer|wastewater|drainage|irrigation|stormwater)\b/;
  const pipelineWords = /\b(?:pipelines?|flowlines?|trunk ?lines?|city gas|cgd|gas grid|transmission line|spur line|crude line|gas line)\b/;

  for (const source of [structured, text]) {
    if (!source.trim()) continue;
    if (/\b(?:treatment plant|desalination plant)\b/.test(source)) return "plant";
    if (waterWords.test(source) && !/\b(?:produced water|water injection)\b/.test(source)) return "water";
    if (pipelineWords.test(source)) return "pipeline";
    if (source === structured && drilling.test(source)) return "drilling";
    if (plantWords.test(source)) return "plant";
  }
  if (disciplines.includes("pipeline")) return "pipeline";
  if (facts.sector === "water") return "water";
  if (facts.sector === "petrochemical" || facts.sector === "power") return "plant";
  if (disciplines.includes("piping") || disciplines.includes("static_equipment") || disciplines.includes("rotating_equipment")) return "plant";
  if (drilling.test(text)) return "drilling";
  if (facts.sector === "oil_gas") return "pipeline";
  return null;
}

/** Discipline of a subcontractor's package (14 §5 subcontractor rows). */
export function subDisciplineFor(facts: SituationFacts): SubDiscipline | null {
  const text = (facts.text ?? "").toLowerCase();
  if (/\b(?:coating|blasting|ndt|non-destructive|hydro ?test\w*|inspection and testing|pipe testing)\b/.test(text) && !/\bpaint\w*\b/.test(text)) return "coating";
  const disciplines = facts.disciplines ?? [];
  if (disciplines.includes("piping") || disciplines.includes("pipeline")) return "piping";
  if (disciplines.includes("civil_structural")) return "civil";
  if (disciplines.includes("electrical") || disciplines.includes("instrumentation_control") || disciplines.includes("telecom")) return "electrical";
  if (disciplines.includes("insulation_painting")) return "insulation";
  if (/\b(?:piping|pipe ?laying|pipelines?|mechanical|spools?|welding)\b/.test(text)) return "piping";
  if (/\b(?:civil|structural|foundations?|concrete|earthworks?)\b/.test(text)) return "civil";
  if (/\b(?:electrical|instrumentation|e&i|cabling)\b/.test(text)) return "electrical";
  if (/\b(?:insulation|painting|cladding)\b/.test(text)) return "insulation";
  return null;
}

/** What a manufacturer makes, for its needs rule: pipe mill, valve maker or other equipment maker. */
export function makerKindFor(name: string, text = "", known: KnownCompany | null = findKnownCompany(name)): MakerKind {
  if (known?.subRole === "pipe_mill" || known?.subRole === "valve_maker" || known?.subRole === "equipment_maker") return known.subRole;
  const both = `${name} ${text}`.toLowerCase();
  if (/\bvalves?\b/.test(name.toLowerCase())) return "valve_maker";
  if (/\b(?:pipes?|tubes?|tubulars?|pipe mill|line ?pipe|seamless|lsaw|hsaw|erw)\b/.test(both)) return "pipe_mill";
  if (/\bvalves?\b/.test(both)) return "valve_maker";
  return "equipment_maker";
}

/** The situation that picks the needs rule for a role (null = the role's generic rule). */
export function situationFor(role: BuyerRole, name: string, facts: SituationFacts): Situation {
  switch (role) {
    case "epc_contractor":
      return projectTypeFor(facts) ?? "pipeline";
    case "subcontractor":
      return subDisciplineFor(facts) ?? "piping";
    case "manufacturer":
      return makerKindFor(name, facts.text ?? "");
    case "owner": {
      const type = projectTypeFor(facts);
      return type;
    }
    default:
      return null;
  }
}

const PROJECT_TYPE_WORDS: Record<ProjectType, string> = { pipeline: "Pipeline", plant: "Plant", water: "Water", drilling: "Drilling" };
const SUB_WORDS: Record<SubDiscipline, string> = {
  piping: "Piping subcontractor",
  civil: "Civil subcontractor",
  electrical: "E&I subcontractor",
  insulation: "Insulation / painting subcontractor",
  coating: "Coating / testing subcontractor",
};
const MAKER_WORDS: Record<MakerKind, string> = { pipe_mill: "Pipe mill", valve_maker: "Valve maker", equipment_maker: "Equipment maker" };

/** Sub-role label under the buyer name (14 §9 subRoleLabel), e.g. "Pipe mill", "Pipeline contractor". */
export function subRoleLabelFor(role: BuyerRole, situation: Situation, name: string, sector: string | null = null): string | null {
  switch (role) {
    case "epc_contractor":
      return situation && situation in PROJECT_TYPE_WORDS ? `${PROJECT_TYPE_WORDS[situation as ProjectType]} contractor` : "Contractor";
    case "subcontractor":
      return situation && situation in SUB_WORDS ? SUB_WORDS[situation as SubDiscipline] : "Subcontractor";
    case "manufacturer":
      return situation && situation in MAKER_WORDS ? MAKER_WORDS[situation as MakerKind] : "Manufacturer";
    case "fabricator":
      return /spool/i.test(name) ? "Spool shop" : "Fabricator / spool shop";
    case "distributor":
      return "Stockist";
    case "owner": {
      if (/\b(?:kommune|municipality|municipal|council|city of)\b/i.test(name)) return "Municipality";
      if (/\b(?:water|utility|utilities|authority|board)\b/i.test(name) || sector === "water") return "Utility";
      if (sector === "oil_gas" || sector === "petrochemical" || /\b(?:oil|gas|petrol\w*|energy|aramco|adnoc)\b/i.test(name)) return "Oil & gas company";
      if (sector === "power") return "Power company";
      return "Project owner";
    }
  }
}
