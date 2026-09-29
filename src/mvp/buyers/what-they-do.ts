/**
 * Buyer-first wording (docs/mvp/15 §A): what a company does, in plain words ("Pipeline builder",
 * "Pipe maker", "Stockist" …) — never "EPC", "owner", "project owner" or "main contractor" — plus the
 * consultant and wholesaler checks. Each plain-words label is a supplier type of the supply map
 * (src/mvp/config/supply-map.json), so the same key drives the supply-chain tree. Pure.
 */
import { getSupplierType, getSupplyMap } from "@/mvp/config/supply-map";
import { isWholesaler, makerKindFor, projectTypeFor, type Situation, type SituationFacts } from "./roles";
import type { BuyerRole } from "./types";

/** Consultants / engineering firms specify but do not buy (15 §A4). */
const CONSULTANT_NAME_RE = /(?:consult|rådgiv|radgiv|raadgiv|engineering consultants?|\bpmc\b)/i;
export const CONSULTANT_REASON = "Consultant — specifies, does not buy";

export function isConsultant(name: string, types: readonly string[] = []): boolean {
  if (CONSULTANT_NAME_RE.test(name)) return true;
  return types.includes("pmc_consultant") && !types.some((t) => t === "main_epc" || t === "subcontractor" || t === "manufacturer" || t === "stockist_trader");
}

export { isWholesaler };

export interface WhatFacts extends SituationFacts {
  name: string;
  types?: readonly string[];
}

/**
 * The supplier-type key of a buyer (15 §A1): pipeline_builder, pipe_maker, stockist, utility …
 * `situation` is the buyer's situation from roles.situationFor.
 */
export function supplierTypeKeyFor(role: BuyerRole, situation: Situation, facts: WhatFacts): string {
  const text = `${facts.name} ${facts.text ?? ""}`.toLowerCase();
  switch (role) {
    case "epc_contractor": {
      if (situation === "water") return "water_contractor";
      if (situation === "plant") return "plant_builder";
      if (situation === "drilling") return "crossing_contractor";
      return "pipeline_builder";
    }
    case "subcontractor": {
      if (/\b(?:hdd|horizontal directional|crossings?|trenchless|micro-?tunnel\w*)\b/.test(text)) return "crossing_contractor";
      if (situation === "civil") return "civil_contractor";
      if (situation === "electrical") return "electrical_contractor";
      if (situation === "insulation") return "insulation_company";
      if (situation === "coating") return /\b(?:testing|ndt|inspection|laborator\w*|lab)\b/.test(text) && !/\bcoating\b/.test(text) ? "testing_lab" : "coating_company";
      const type = projectTypeFor(facts);
      if (type === "water") return "water_contractor";
      if (type === "plant") return "plant_builder";
      return "pipeline_builder";
    }
    case "manufacturer": {
      const kind = situation === "pipe_mill" || situation === "valve_maker" || situation === "equipment_maker" ? situation : makerKindFor(facts.name, facts.text ?? "");
      if (kind === "pipe_mill") return "pipe_maker";
      if (kind === "valve_maker") return "valve_maker";
      if (/\b(?:bends?|fittings?|flanges?|elbows?|tees?)\b/.test(text)) return "fittings_maker";
      if (/\b(?:forg\w*|casting\w*|foundry)\b/.test(text)) return "forging_shop";
      if (/\bgaskets?\b/.test(text)) return "gasket_maker";
      if (/\b(?:bolts?|fasteners?|studs?)\b/.test(text)) return "bolting_maker";
      if (/\bpumps?\b/.test(text)) return "pump_supplier";
      if (/\b(?:welding (?:consumables|electrodes|wire)|electrodes)\b/.test(text)) return "welding_consumables_maker";
      if (/\b(?:coating (?:powder|materials)|fbe|3lpe)\b/.test(text)) return "coating_powder_supplier";
      if (/\b(?:plates?|coils?|steel mill|steel works|hot[- ]rolled)\b/.test(text)) return "steel_mill";
      return "fittings_maker";
    }
    case "fabricator":
      return "fabricator";
    case "distributor":
      return "stockist";
    case "owner": {
      const name = facts.name;
      if (/\b(?:kommune|municipality|municipal|council|city of|commune|kommun)\b/i.test(name)) return "municipality";
      if (facts.sector === "oil_gas" || facts.sector === "petrochemical" || /\b(?:oil|gas|petrol\w*|aramco|adnoc|energy|refin\w*)\b/i.test(name)) return "oil_gas_company";
      return "utility";
    }
  }
}

/** Plain-words label of a supplier-type key ("Pipe maker"). */
export function labelOfType(key: string): string {
  return getSupplierType(key)?.label ?? key.replace(/_/g, " ");
}

/** "Pipeline builder", "Municipality · open tender" (15 §A1). */
export function whatTheyDoLabel(key: string, openTender = false): string {
  const label = labelOfType(key);
  const owner = getSupplierType(key)?.role === "owner";
  return owner && openTender ? `${label} · open tender` : label;
}

/** The contractor type that builds a project of this type (owner roots, 15 §B). */
export function contractorTypeFor(projectType: string | null | undefined): string {
  const map = getSupplyMap().contractorByProjectType;
  return map[projectType ?? "default"] ?? map.default ?? "pipeline_builder";
}

/** Words that must never appear as labels in generated text (15 §A1). */
export const BANNED_LABEL_RE = /\b(?:EPC|project owner|main contractor)\b/i;

/**
 * Remove role labels from text we show (stored reasons and project names can carry them):
 * "identify the EPC contractor" → "identify the contractor", "pipeline EPC contract" → "pipeline contract".
 */
export function plainWords(text: string): string {
  return text
    .replace(/\bEPC contractors?\b/gi, "contractor")
    .replace(/\bmain contractors?\b/gi, "contractor")
    .replace(/\bproject owners?\b/gi, "client")
    .replace(/\bEPC\b[\s-]*/g, "")
    .replace(/\s{2,}/g, " ");
}
