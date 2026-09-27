/**
 * Output schemas for the narrow extraction passes P1–P3 (06 §3) and the P0 triage, as zod schemas.
 * Every value is a `Fact` with its own verbatim quote; every choice list includes "unknown".
 * Schemas are lenient on input (models drift) and strict on what reaches the database.
 */
import { z } from "zod";
import { DISCIPLINES, PROJECT_STAGES } from "@/mvp/types";

const str = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).nullish();

export const FactSchema = z
  .object({ value: str, quote: str })
  .nullish()
  .transform((f) => (f && f.value && f.quote ? { value: f.value, quote: f.quote } : null));
export type RawFact = { value: string; quote: string } | null;

export const COMPANY_ROLES = [
  "owner", "pmc", "consultant", "main_epc", "consortium_member", "subcontractor", "supplier", "logistics", "financier", "unknown",
] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

const enumOr = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z
    .string()
    .nullish()
    .transform((v) => ((values as readonly string[]).includes((v ?? "").trim().toLowerCase()) ? (v!.trim().toLowerCase() as T[number]) : fallback));

const STAGES_WITH_UNKNOWN = [...PROJECT_STAGES, "unknown"] as const;
const DISCIPLINES_WITH_UNKNOWN = [...DISCIPLINES, "unknown"] as const;

export const CompanyMentionSchema = z.object({
  name: FactSchema,
  role: enumOr(COMPANY_ROLES, "unknown"),
  role_quote: str,
  country: FactSchema.optional(),
});

export const P1Schema = z.object({
  project_name: FactSchema,
  project_type: FactSchema.optional(),
  location: FactSchema.optional(),
  stage: enumOr(STAGES_WITH_UNKNOWN, "unknown"),
  stage_quote: str,
  companies: z.array(CompanyMentionSchema).max(10).catch([]).default([]),
  contract_value: FactSchema.optional(),
  award_date: FactSchema.optional(),
  tender_ref: FactSchema.optional(),
  closing_date: FactSchema.optional(),
});
export type P1Output = z.infer<typeof P1Schema>;

export const PackageMentionSchema = z.object({
  discipline: enumOr(DISCIPLINES_WITH_UNKNOWN, "unknown"),
  name: FactSchema,
  scope: FactSchema.optional(),
  owner: FactSchema.optional(),
  procurement_route: enumOr(["open_tender", "prequal", "approved_vendor_list", "direct", "unknown"] as const, "unknown"),
});

export const RequirementMentionSchema = z.object({
  discipline: enumOr(DISCIPLINES_WITH_UNKNOWN, "unknown"),
  item: FactSchema,
  standard: FactSchema.optional(),
  grade: FactSchema.optional(),
  size_in: FactSchema.optional(),
  quantity: FactSchema.optional(),
  unit: str,
  delivery_port: FactSchema.optional(),
  delivery_site: FactSchema.optional(),
  needed_by: FactSchema.optional(),
});

export const P2Schema = z.object({
  packages: z.array(PackageMentionSchema).max(10).catch([]).default([]),
  requirements: z.array(RequirementMentionSchema).max(15).catch([]).default([]),
});
export type P2Output = z.infer<typeof P2Schema>;

export const PersonMentionSchema = z.object({
  name: FactSchema,
  title: FactSchema.optional(),
  company: FactSchema.optional(),
  project_role: FactSchema.optional(),
});

export const P3Schema = z.object({
  people: z.array(PersonMentionSchema).max(10).catch([]).default([]),
});
export type P3Output = z.infer<typeof P3Schema>;

export const P0Schema = z.object({
  relevant: enumOr(["yes", "no", "unclear"] as const, "unclear"),
  reason: str,
  markets: z.array(z.string()).catch([]).default([]),
});

export type PassName = "P0" | "P1" | "P2" | "P3";

/** Parse model output text (tolerates ```json fences and leading prose) into an object, or null. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export const EMPTY_P1: P1Output = { project_name: null, stage: "unknown", stage_quote: null, companies: [] };
export const EMPTY_P2: P2Output = { packages: [], requirements: [] };
export const EMPTY_P3: P3Output = { people: [] };
