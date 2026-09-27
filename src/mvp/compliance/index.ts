import { getDb, type Queryable } from "@/mvp/db";
import { getClientProfile } from "@/mvp/config/profile";
import type {
  ChecklistItem,
  CompanyRow,
  LeadRow,
  OutreachRule,
  PackageRow,
  PersonOutreach,
  ProjectRow,
  RequirementRow,
} from "@/mvp/types";
import { parseSpec, readTenders } from "@/mvp/scoring/util";
import { BID_RULES, DEFAULT_OUTREACH_RULE, OUTREACH_RULES, type ChecklistInput } from "./rules";

export { BID_RULES, OUTREACH_RULES, type ChecklistInput } from "./rules";

/** Pure: evaluate every bid rule for the lead's market (plus the "ALL" rules). */
export function buildChecklist(input: ChecklistInput): ChecklistItem[] {
  const market = input.market?.toUpperCase() ?? null;
  return BID_RULES.filter((rule) => rule.markets.includes("ALL") || (market !== null && rule.markets.includes(market))).map(
    (rule) => {
      const outcome = rule.evaluate(input);
      return {
        ruleKey: rule.key,
        title: rule.title,
        status: outcome.status,
        hard: outcome.hard,
        note: outcome.note,
        sourceUrl: rule.sourceUrl,
      };
    },
  );
}

/** Rule keys that don't feed sub-criterion 4.1 (sanctions are gate G7's job). */
const NOT_ELIGIBILITY = new Set(BID_RULES.filter((rule) => !rule.countsForEligibility).map((rule) => rule.key));

/**
 * Sub-criterion 4.1 from a checklist (07 §7): any hard requirement missing = 0; some hard
 * requirement unknown = 4; all hard requirements met (or none apply) = 8.
 */
export function eligibilityPoints(checklist: ChecklistItem[]): { points: 0 | 4 | 8; missing: ChecklistItem[]; unknown: ChecklistItem[] } {
  const hard = checklist.filter((item) => item.hard && !NOT_ELIGIBILITY.has(item.ruleKey));
  const missing = hard.filter((item) => item.status === "missing");
  const unknown = hard.filter((item) => item.status === "unknown");
  return { points: missing.length ? 0 : unknown.length ? 4 : 8, missing, unknown };
}

/** Standards named in requirements (for ALL_CERTS). */
export function namedStandards(requirements: Pick<RequirementRow, "spec" | "item_category">[]): string[] {
  const set = new Set<string>();
  for (const req of requirements) for (const s of parseSpec(req.spec, req.item_category).standards) set.add(s);
  return [...set];
}

/** Build the checklist input from already-loaded rows (used by the scorer and by bidChecklist). */
export function checklistInputFor(args: {
  kind: LeadRow["kind"];
  buyer: CompanyRow;
  project: ProjectRow | null;
  projectOwner: CompanyRow | null;
  packages: PackageRow[];
  requirements: RequirementRow[];
  now?: Date;
}): ChecklistInput {
  const tenders = readTenders(args.project?.specs);
  const tender = tenders.find((t) => t.buyerCompanyId === args.buyer.id) ?? tenders[0];
  const packageValue = args.packages.find((p) => p.value_usd !== null)?.value_usd ?? null;
  return {
    kind: args.kind,
    market: args.project?.country ?? args.buyer.country ?? null,
    buyerName: args.buyer.canonical_name,
    buyerTypes: args.buyer.types ?? [],
    projectOwnerName: args.projectOwner?.canonical_name ?? null,
    projectSector: args.project?.sector ?? null,
    valueUsd: packageValue ?? args.project?.value_usd ?? null,
    isGovernment: tender?.isGovernment ?? (args.buyer.types ?? []).includes("government_buyer"),
    namedStandards: namedStandards(args.requirements),
    profile: getClientProfile(),
    now: args.now ?? new Date(),
  };
}

async function one<T>(db: Queryable, sql: string, params: unknown[]): Promise<T | null> {
  return (await db.query<T>(sql, params)).rows[0] ?? null;
}

/**
 * Bid / supply compliance checklist for a lead (docs/mvp/08 §2): seed rules for the lead's market
 * (project country, or buyer country when unknown) compared with the client profile
 * (certifications, registrations, local content). Each item is met / missing / unknown / not_applicable.
 * A missing hard item sets sub-criterion 4.1 to 0. Returns [] when the lead doesn't exist.
 */
export async function bidChecklist(leadId: string): Promise<ChecklistItem[]> {
  const db = getDb();
  const lead = await one<LeadRow>(db, "select * from leads where id = $1", [leadId]);
  if (!lead) return [];
  const buyer = await one<CompanyRow>(db, "select * from companies where id = $1", [lead.buyer_company_id]);
  if (!buyer) return [];
  const project = lead.project_id ? await one<ProjectRow>(db, "select * from projects where id = $1", [lead.project_id]) : null;
  const projectOwner = project?.owner_company_id
    ? await one<CompanyRow>(db, "select * from companies where id = $1", [project.owner_company_id])
    : null;
  const packages = lead.package_id
    ? (await db.query<PackageRow>("select * from packages where id = $1", [lead.package_id])).rows
    : project
      ? (await db.query<PackageRow>("select * from packages where project_id = $1", [project.id])).rows
      : [];
  const requirements = packages.length
    ? (await db.query<RequirementRow>("select * from requirements where package_id = any($1::uuid[])", [packages.map((p) => p.id)])).rows
    : [];
  return buildChecklist(checklistInputFor({ kind: lead.kind, buyer, project, projectOwner, packages, requirements }));
}

/**
 * Outreach rules for a contact's country (docs/mvp/08 §3): whether email and phone are allowed,
 * opt-out-only, consent-needed or blocked, with the steps to follow and the source.
 * Countries without a rule get `opt_out_only` with a "confirm with counsel" step.
 * The slice has no opt-out register yet; when one exists it overrides everything (08 §3).
 *
 * @param countryCode ISO 3166-1 alpha-2, e.g. "IN", "SA", "NO".
 */
export function outreachRules(countryCode: string): OutreachRule {
  const country = (countryCode ?? "").trim().toUpperCase();
  const rule = OUTREACH_RULES[country];
  if (rule) return { ...rule, steps: [...rule.steps] };
  return { country, ...DEFAULT_OUTREACH_RULE, steps: [...DEFAULT_OUTREACH_RULE.steps] };
}

/** True when a channel permission means "don't draft/send" (08 §3: consent_needed disables Draft email). */
export function isOutreachBlocked(permission: OutreachRule["email"]): boolean {
  return permission === "consent_needed" || permission === "blocked";
}

/** Outreach rules for each contact, by the contact's country (fallback: their company's / buyer's country). */
export function outreachForPeople(
  people: { id: string; country: string | null; companyCountry?: string | null }[],
  fallbackCountry: string | null,
): PersonOutreach[] {
  return people.map((person) => {
    const country = person.country ?? person.companyCountry ?? fallbackCountry;
    return { personId: person.id, country, rule: outreachRules(country ?? "") };
  });
}
