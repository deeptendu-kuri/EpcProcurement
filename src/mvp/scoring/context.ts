/**
 * Everything the pure scoring functions (gates, rubric, confidence) need about one candidate lead.
 * Built from the database by loader.ts; built by hand in tests.
 */
import type {
  ChecklistItem,
  ClientProfile,
  CompanyInsights,
  CompanyRow,
  LeadKind,
  PackageRow,
  PersonRoleRow,
  PersonRow,
  ProjectPartyRow,
  ProjectRow,
  ProjectStageEventRow,
  RequirementRow,
  SignalRow,
} from "@/mvp/types";
import { unique, type EvidenceInfo, type TenderSpec } from "./util";

export interface Candidate {
  kind: LeadKind;
  buyerId: string;
  projectId: string | null;
  packageId: string | null;
  /** Signals that triggered this candidate. */
  signalIds: string[];
  /** Created from typical subcontracted packages (07 §6), package status 'planned'. */
  predicted?: boolean;
}

export interface ScoringContext {
  now: Date;
  kind: LeadKind;
  profile: ClientProfile;
  buyer: CompanyRow;
  project: ProjectRow | null;
  projectOwner: CompanyRow | null;
  /** The lead's package, when the candidate has one. */
  leadPackage: PackageRow | null;
  /** Packages in scope: the lead's package, or every package of the project when it has none. */
  packages: PackageRow[];
  /** Requirements of `packages`. */
  requirements: RequirementRow[];
  /** All parties on the project. */
  parties: ProjectPartyRow[];
  stageEvents: ProjectStageEventRow[];
  tender: TenderSpec | null;
  /** The candidate's triggering signals. */
  triggerSignals: SignalRow[];
  /** Every signal on the project (or package), for momentum (2.4). */
  projectSignals: SignalRow[];
  /** People mapped to the project/package or working at the buyer. */
  people: { person: PersonRow; roles: PersonRoleRow[] }[];
  insights: CompanyInsights | null;
  checklist: ChecklistItem[];
  existingCustomer: boolean;
  priorContact: boolean;
  /** Known bidders / approved vendors (5.2), null = unknown. */
  competitorCount: number | null;
  evidence: Record<string, EvidenceInfo>;
  /** `${entity_type}:${entity_id}` → evidence ids (any field). */
  factEvidence: Record<string, string[]>;
}

/** Evidence ids behind one entity (any field). */
export function evidenceOf(ctx: Pick<ScoringContext, "factEvidence">, entityType: string, id: string | null | undefined): string[] {
  if (!id) return [];
  return ctx.factEvidence[`${entityType}:${id}`] ?? [];
}

/** Evidence ids of the given signals. */
export function signalEvidence(signals: SignalRow[]): string[] {
  return unique(signals.flatMap((s) => s.evidence_ids ?? []));
}

/** The buyer's own party rows on the project. */
export function buyerParties(ctx: ScoringContext): ProjectPartyRow[] {
  return ctx.parties.filter((p) => p.company_id === ctx.buyer.id);
}

/**
 * Evidence ids behind the lead's key facts (07 §5): buyer, buyer's role, project, package, stage,
 * dates — i.e. company, the buyer's party rows, project, lead package(s), stage events, triggering
 * signals and the tender.
 */
export function keyEvidenceIds(ctx: ScoringContext): string[] {
  const packages = ctx.leadPackage ? [ctx.leadPackage] : ctx.packages;
  return unique([
    ...evidenceOf(ctx, "company", ctx.buyer.id),
    ...buyerParties(ctx).flatMap((p) => evidenceOf(ctx, "project_party", p.id)),
    ...evidenceOf(ctx, "project", ctx.project?.id),
    ...packages.flatMap((p) => evidenceOf(ctx, "package", p.id)),
    ...ctx.stageEvents.flatMap((e) => [...(e.evidence_id ? [e.evidence_id] : []), ...evidenceOf(ctx, "project_stage_event", e.id)]),
    ...signalEvidence(ctx.triggerSignals),
    ...(ctx.tender?.evidenceIds ?? []),
  ]).filter((id) => ctx.evidence[id]);
}
