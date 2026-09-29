/**
 * Supply map and directory seed (docs/mvp/15 §B, §C). Validated once with zod; every catalogue id and
 * every supplier type referenced must exist.
 */
import { z } from "zod";
import { getCatalogue } from "./buyers-config";
import supplyRaw from "./supply-map.json";
import seedRaw from "./directory-seed.json";

const ROLES = ["owner", "epc_contractor", "subcontractor", "manufacturer", "fabricator", "distributor"] as const;

const supplierType = z.object({
  label: z.string().min(1),
  role: z.enum(ROLES),
  situation: z.string().nullable(),
  does: z.string().min(1),
  makes: z.array(z.string()).default([]),
  buys: z.array(z.string()).optional(),
  directoryItems: z.array(z.string()).default([]),
});
const edge = z.object({ type: z.string().min(1), supplies: z.string() });
const supplySchema = z.object({
  isExample: z.boolean().default(false),
  types: z.record(z.string(), supplierType),
  contractorByProjectType: z.record(z.string(), z.string()),
  buysFrom: z.record(z.string(), z.array(edge)),
});

const seedCompany = z.object({
  name: z.string().min(1),
  country: z.string().nullable(),
  domain: z.string().nullable().default(null),
  url: z.string().url(),
  types: z.array(z.string()).min(1),
  items: z.array(z.string()).default([]),
  says: z.string().default(""),
});
const seedSchema = z.object({ checkedAt: z.string(), companies: z.array(seedCompany) });

export type SupplierTypeDef = z.infer<typeof supplierType>;
export type SupplyEdge = z.infer<typeof edge>;
export type SupplyMap = z.infer<typeof supplySchema>;
export type SeedCompany = z.infer<typeof seedCompany>;

let supply: SupplyMap | undefined;
let seed: z.infer<typeof seedSchema> | undefined;

export function getSupplyMap(): SupplyMap {
  if (!supply) {
    const parsed = supplySchema.parse(supplyRaw);
    const items = new Set(getCatalogue().items.map((i) => i.id));
    for (const [key, def] of Object.entries(parsed.types))
      for (const id of [...def.makes, ...(def.buys ?? []), ...def.directoryItems])
        if (!items.has(id)) throw new Error(`supply-map: unknown catalogue item "${id}" in type ${key}`);
    for (const [from, edges] of Object.entries(parsed.buysFrom)) {
      if (!parsed.types[from]) throw new Error(`supply-map: unknown type "${from}" in buysFrom`);
      for (const e of edges) if (!parsed.types[e.type]) throw new Error(`supply-map: unknown type "${e.type}" under ${from}`);
    }
    for (const t of Object.values(parsed.contractorByProjectType)) if (!parsed.types[t]) throw new Error(`supply-map: unknown contractor type "${t}"`);
    supply = parsed;
  }
  return supply;
}

export function getSupplierType(key: string): SupplierTypeDef | undefined {
  return getSupplyMap().types[key];
}

export function getDirectorySeed(): SeedCompany[] {
  if (!seed) {
    const parsed = seedSchema.parse(seedRaw);
    const types = getSupplyMap().types;
    for (const c of parsed.companies) for (const t of c.types) if (!types[t]) throw new Error(`directory-seed: unknown type "${t}" for ${c.name}`);
    seed = parsed;
  }
  return seed.companies;
}
