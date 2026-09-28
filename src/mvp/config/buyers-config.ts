/**
 * Loaders for the buyer configuration (docs/mvp/14 §3–§6): catalogue, strengths, needs map and
 * known companies. Each file is validated once with zod; the shipped files are EXAMPLES
 * (`isExample: true`) until the client replaces them.
 */
import { z } from "zod";
import catalogueRaw from "./catalogue.json";
import strengthsRaw from "./strengths.json";
import needsRaw from "./needs-map.json";
import knownRaw from "./known-companies.json";

const ROLES = ["owner", "epc_contractor", "subcontractor", "manufacturer", "fabricator", "distributor"] as const;

const catalogueItem = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().min(1),
  standards: z.array(z.string()).default([]),
  hs: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
});
const catalogueSchema = z.object({ isExample: z.boolean().default(false), items: z.array(catalogueItem).min(1) });

const hub = z.object({ country: z.string(), place: z.string(), near: z.array(z.string()).default([]) });
const condition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("near_hub"), hubs: z.array(hub).min(1) }),
  z.object({ type: z.literal("short_delivery"), maxMonths: z.number().positive() }),
  z.object({ type: z.literal("min_categories"), min: z.number().int().positive() }),
  z.object({ type: z.literal("specs_or_major"), majors: z.array(z.string()).default([]) }),
  z.object({ type: z.literal("owner_in"), owners: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("local_content"), owners: z.array(z.string()).default([]), publicTenderCountries: z.array(z.string()).default([]) }),
  z.object({ type: z.literal("site_or_export") }),
]);
const strengthSchema = z.object({ id: z.string().min(1), text: z.string().min(1), when: z.string().default(""), condition });
const strengthsSchema = z.object({
  isExample: z.boolean().default(false),
  homeCountries: z.array(z.string()).default([]),
  strengths: z.array(strengthSchema),
});

const ruleItem = z.object({ id: z.string().min(1), fit: z.enum(["good", "possible"]), why: z.string().default("") });
const ruleGroup = z.object({ label: z.string().min(1), from: z.number().min(0), to: z.number().min(0), items: z.array(ruleItem) });
const needsRule = z.object({
  id: z.string().min(1),
  role: z.enum(ROLES),
  situation: z.string().nullable(),
  label: z.string(),
  trigger: z.string(),
  groups: z.array(ruleGroup).min(1),
  delivery: z.object({ label: z.string(), months: z.number().positive() }).optional(),
  continuous: z.boolean().optional(),
});
const needsSchema = z.object({
  isExample: z.boolean().default(false),
  packagePipes: z.record(z.string(), z.array(z.string())),
  rules: z.array(needsRule).min(1),
});

const knownCompany = z.object({
  names: z.array(z.string().min(1)).min(1),
  role: z.enum(ROLES),
  subRole: z.string().nullable().default(null),
  makes: z.array(z.string()).default([]),
  parentGroup: z.string().nullable().default(null),
  listed: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
});
const knownSchema = z.object({ isExample: z.boolean().default(false), companies: z.array(knownCompany) });

export type CatalogueItem = z.infer<typeof catalogueItem>;
export type Catalogue = z.infer<typeof catalogueSchema>;
export type Strength = z.infer<typeof strengthSchema>;
export type StrengthCondition = z.infer<typeof condition>;
export type StrengthsConfig = z.infer<typeof strengthsSchema>;
export type NeedsRule = z.infer<typeof needsRule>;
export type NeedsRuleItem = z.infer<typeof ruleItem>;
export type NeedsMap = z.infer<typeof needsSchema>;
export type KnownCompany = z.infer<typeof knownCompany>;
export type KnownCompanies = z.infer<typeof knownSchema>;

let catalogue: Catalogue | undefined;
let strengths: StrengthsConfig | undefined;
let needs: NeedsMap | undefined;
let known: KnownCompanies | undefined;

/** Product catalogue (14 §3). */
export function getCatalogue(): Catalogue {
  if (!catalogue) catalogue = catalogueSchema.parse(catalogueRaw);
  return catalogue;
}

/** Catalogue item by id. */
export function getCatalogueItem(id: string): CatalogueItem | undefined {
  return getCatalogue().items.find((item) => item.id === id);
}

/** Strengths with their "benefit when" conditions (14 §4). */
export function getStrengths(): StrengthsConfig {
  if (!strengths) strengths = strengthsSchema.parse(strengthsRaw);
  return strengths;
}

/** Needs map: role (+ situation) → items → windows (14 §5). Every item id must exist in the catalogue. */
export function getNeedsMap(): NeedsMap {
  if (!needs) {
    const parsed = needsSchema.parse(needsRaw);
    const ids = new Set(getCatalogue().items.map((item) => item.id));
    for (const rule of parsed.rules)
      for (const group of rule.groups)
        for (const item of group.items)
          if (!item.id.startsWith("$") && !ids.has(item.id)) throw new Error(`needs-map: unknown catalogue item "${item.id}" in rule ${rule.id}`);
    needs = parsed;
  }
  return needs;
}

/** Known companies for the competitor check (14 §6). */
export function getKnownCompanies(): KnownCompanies {
  if (!known) known = knownSchema.parse(knownRaw);
  return known;
}
