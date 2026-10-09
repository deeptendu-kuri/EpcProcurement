/**
 * Signals and scoring (docs/mvp/07): facts → signals → candidates → gates → rubric → confidence →
 * class → reasons → leads. Gates, scores and classes are transparent rules; no AI here (06 §1).
 */
import { getDb, type Queryable } from "@/mvp/db";
import { getProductById, getActiveProducts } from "@/mvp/config/profile";
import type {
  BuyerType,
  ConfidenceBand,
  GateResult,
  LeadClass,
  LeadKind,
  LeadRow,
  Reason,
  RunInput,
  ScoreBreakdown,
  SignalRow,
} from "@/mvp/types";
import { buildCandidates } from "./candidates";
import { IDENTIFY_EPC_TASK, buyerTypeFor, isSupplyRole, ownerOrderReason, ownerOrderWithoutEpc, supplierReason } from "./buyer-type";
import { classifyLead, findSub, researchTasks, totalScore } from "./classify";
import { computeConfidence } from "./confidence";
import { SCORING_CONFIG } from "./config";
import { keyEvidenceIds, type Candidate, type ScoringContext } from "./context";
import { classCap, closingDate, evaluateGates, hardFailures } from "./gates";
import { loadContext, type InsightsCache } from "./loader";
import { topReasons } from "./reasons";
import { scoreRubric } from "./rubric";
import { buildSignals } from "./signals";
import { unique } from "./util";

export { SCORING_CONFIG } from "./config";
export { getCompanyInsights } from "./graph";
export { researchTasks } from "./classify";
export type { Candidate, ScoringContext } from "./context";

export interface LeadScore {
  gates: GateResult[];
  breakdown: ScoreBreakdown;
  score: number;
  confidence: number;
  band: ConfidenceBand;
  leadClass: LeadClass;
  /** Who the lead is about: one of the six buyer roles (14 §2). */
  buyerType: BuyerType;
  reasons: Reason[];
  /** Sub-criteria to research (07 §8); "G5" first when the lead needs a second independent source. */
  researchTasks: string[];
  isSample: boolean;
  closingDate: string | null;
  clientProductIds: string[];
}

/** Reason shown first on a lead capped by the single-source G5 (07 §3, §8). */
export const SECOND_SOURCE_REASON = "Needs research: find a second independent source (only one news report so far)";
/** Reason shown first on a lead capped by G6 only (key facts read by one AI model; quotes checked). */
export const CONFIRM_FACTS_REASON = "Needs research: confirm the key facts in the source (read by one AI model only)";

/** Pure: score one loaded candidate. */
export function scoreContext(ctx: ScoringContext): LeadScore {
  const gates = evaluateGates(ctx);
  const breakdown = scoreRubric(ctx);
  const score = totalScore(breakdown.criteria);
  const keyIds = keyEvidenceIds(ctx);
  const { confidence, band } = computeConfidence(keyIds.map((id) => ctx.evidence[id]), ctx.buyer.match_certainty, ctx.now);
  const leadClass = classifyLead({
    gates,
    score,
    band,
    eligibility: findSub(breakdown.criteria, "4.1")?.points ?? null,
    size: findSub(breakdown.criteria, "1.4")?.points ?? null,
    stage: ctx.project?.current_stage ?? null,
  });

  // Single-source cap (07 §3 G5): the first research task is "find a second independent source".
  const capped = leadClass !== "rejected" && classCap(gates) !== null;
  const cappedBy = gates.filter((g) => !g.pass && (g as { cap?: string }).cap).map((g) => g.id);
  const capReason = cappedBy.includes("G5") ? SECOND_SOURCE_REASON : CONFIRM_FACTS_REASON;
  const signalEvidenceIds = unique(ctx.triggerSignals.flatMap((s) => s.evidence_ids ?? [])).filter((id) => ctx.evidence[id]);

  const productIds = new Set<string>();
  for (const req of ctx.requirements)
    if (req.client_product_id && getProductById(req.client_product_id)) productIds.add(req.client_product_id);
  if (!productIds.size) {
    const disciplines = new Set((ctx.leadPackage ? [ctx.leadPackage] : ctx.packages).map((p) => p.discipline));
    for (const product of getActiveProducts()) if (disciplines.has(product.discipline)) productIds.add(product.id);
  }

  // Buyer type (13 §11): labels the lead and adds its first reason; never changes gates or score.
  const buyerType = buyerTypeFor(ctx);
  const leading: Reason[] = [];
  let finalClass = leadClass;
  const tasks = capped ? [...cappedBy, ...researchTasks(breakdown.criteria, "research")] : researchTasks(breakdown.criteria, leadClass);
  if (leadClass !== "rejected" && isSupplyRole(buyerType)) {
    const reason = supplierReason(ctx);
    if (reason) leading.push(reason);
  }
  // An owner that ordered materials while no EPC contractor is known: watch it and find the EPC.
  if (leadClass !== "rejected" && ownerOrderWithoutEpc(ctx, buyerType)) {
    if (finalClass === "genuine" || finalClass === "research") finalClass = "watch";
    leading.push(ownerOrderReason(ctx));
    tasks.unshift(IDENTIFY_EPC_TASK);
  }

  return {
    gates,
    breakdown,
    score,
    confidence,
    band,
    leadClass: finalClass,
    buyerType,
    reasons:
      leadClass === "rejected"
        ? [
            ...hardFailures(gates).map((gate) => ({ text: `Rejected: ${gate.why}`, evidenceIds: [] as string[] })),
            ...topReasons(breakdown.criteria),
          ].slice(0, 3)
        : capped
          ? [
              ...leading,
              // "Needs research: …" only on a Needs-research lead; a Watching lead keeps the task without the label.
              { text: finalClass === "research" ? capReason : capReason.replace(/^Needs research: (\w)/, (_, ch: string) => ch.toUpperCase()), evidenceIds: signalEvidenceIds },
              ...topReasons(breakdown.criteria),
            ].slice(0, 3)
          : [...leading, ...topReasons(breakdown.criteria)].slice(0, Math.max(3, leading.length + 2)),
    researchTasks: unique(tasks),
    isSample: keyIds.length > 0 && keyIds.every((id) => ctx.evidence[id]?.isSample),
    closingDate: ctx.kind === "bid" ? closingDate(ctx) : null,
    clientProductIds: [...productIds],
  };
}

// ───────────────────────── DB orchestration ─────────────────────────

/** Projects whose facts came from documents of this run (null = none found). */
async function touchedProjects(db: Queryable, runId: string): Promise<string[]> {
  const { rows } = await db.query<{ project_id: string }>(
    `with ev as (
       select e.id from evidence e join source_documents d on d.id = e.document_id
       where d.run_id = $1 or exists(select 1 from run_documents rd where rd.document_id=d.id and rd.run_id=$1)
     ), fe as (
       select entity_type, entity_id from fact_evidence where evidence_id in (select id from ev)
     )
     select id as project_id from projects where id in (select entity_id from fe where entity_type = 'project')
     union select project_id from project_parties where id in (select entity_id from fe where entity_type = 'project_party')
     union select project_id from project_stage_events where id in (select entity_id from fe where entity_type = 'project_stage_event')
     union select project_id from packages where id in (select entity_id from fe where entity_type = 'package')
     union select pk.project_id from requirements r join packages pk on pk.id = r.package_id
            where r.id in (select entity_id from fe where entity_type = 'requirement')
     union select project_id from relationships where project_id is not null and id in (select entity_id from fe where entity_type = 'relationship')
     union select project_id from person_roles where project_id is not null and id in (select entity_id from fe where entity_type = 'person_role')
     union select project_id from signals where run_id = $1 and project_id is not null`,
    [runId],
  );
  return unique(rows.map((r) => r.project_id).filter(Boolean));
}

async function runKinds(db: Queryable, runId: string): Promise<{ exists: boolean; kinds: LeadKind[]; markets: string[] }> {
  const { rows } = await db.query<{ adhoc_query: RunInput | null }>("select adhoc_query from runs where id = $1", [runId]);
  const all: LeadKind[] = ["bid", "supply_subcontract"];
  if (!rows[0]) return { exists: false, kinds: all, markets: [] };
  const kinds = rows[0].adhoc_query?.leadKinds?.filter((k): k is LeadKind => k === "bid" || k === "supply_subcontract");
  const markets = (rows[0].adhoc_query?.markets ?? []).map((m) => String(m).toUpperCase());
  return { exists: true, kinds: kinds?.length ? kinds : all, markets };
}

/** Insert or update the lead for a candidate; append score history. Returns whether it was created. */
async function upsertLead(db: Queryable, candidate: Candidate, result: LeadScore, runId: string | null, ctx: ScoringContext): Promise<"created" | "updated"> {
  const existing = (
    await db.query<Pick<LeadRow, "id" | "signal_ids">>(
      `select id, signal_ids from leads
        where kind = $1 and buyer_company_id = $2 and project_id is not distinct from $3::uuid and package_id is not distinct from $4::uuid`,
      [candidate.kind, candidate.buyerId, candidate.projectId, candidate.packageId],
    )
  ).rows[0];
  const signalIds = unique([...(existing?.signal_ids ?? []), ...candidate.signalIds]);
  const common = [
    result.clientProductIds,
    signalIds,
    result.score,
    JSON.stringify(result.breakdown),
    JSON.stringify(result.gates),
    result.confidence,
    result.band,
    result.leadClass,
    JSON.stringify(result.reasons),
    result.closingDate,
    SCORING_CONFIG.version,
    result.isSample,
    runId,
    ctx.tender?.ref ?? null,
    result.buyerType,
  ];
  let leadId: string;
  let outcome: "created" | "updated";
  if (existing) {
    await db.query(
      `update leads set client_product_ids = $2::text[], signal_ids = $3::uuid[], score = $4, score_breakdown = $5::jsonb,
              gate_results = $6::jsonb, confidence = $7, confidence_band = $8, class = $9, reasons = $10::jsonb,
              closing_date = $11, scoring_version = $12, is_sample = $13, run_id = coalesce($14, run_id),
              tender_ref = coalesce($15, tender_ref), buyer_type = $16, updated_at = now()
        where id = $1`,
      [existing.id, ...common],
    );
    leadId = existing.id;
    outcome = "updated";
  } else {
    const { rows } = await db.query<{ id: string }>(
      `insert into leads (kind, buyer_company_id, project_id, package_id, client_product_ids, signal_ids, score, score_breakdown,
                          gate_results, confidence, confidence_band, class, reasons, closing_date, scoring_version, is_sample,
                          run_id, tender_ref, buyer_type)
       values ($1, $2, $3, $4, $5::text[], $6::uuid[], $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19)
       returning id`,
      [candidate.kind, candidate.buyerId, candidate.projectId, candidate.packageId, ...common],
    );
    leadId = rows[0].id;
    outcome = "created";
  }
  await db.query(
    "insert into lead_score_history (lead_id, score, confidence, class, scoring_version) values ($1, $2, $3, $4, $5)",
    [leadId, result.score, result.confidence, result.leadClass, SCORING_CONFIG.version],
  );
  return outcome;
}

/**
 * Build signals from the facts written by run `runId`, then create or re-score the candidate leads
 * (docs/mvp/07: signals §2, 8 gates §3, sub-criteria §7, confidence §5, classes §8, reasons §9).
 *
 * Scope: projects whose facts cite evidence from this run's documents (or signals of this run);
 * when none can be traced, every project is (re)scored. Candidates are limited to the run's
 * `leadKinds`. Existing leads on those projects are re-scored too (their status is kept).
 *
 * Writes `signals` (unique fingerprint), `leads` (unique (buyer, project, package, kind)) with
 * `score_breakdown: ScoreBreakdown`, `gate_results: GateResult[]`, `reasons: Reason[]`, and a
 * `lead_score_history` row per scoring.
 *
 * @returns number of leads created and updated.
 */
export async function buildSignalsAndScore(
  runId: string,
  options: { db?: Queryable; now?: Date } = {},
): Promise<{ created: number; updated: number }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const run = await runKinds(db, runId);
  const runRef = run.exists ? runId : null;

  const touched = run.exists ? await touchedProjects(db, runId) : [];
  // A real empty search must not re-score unrelated historic projects globally.
  if(run.exists&&!touched.length)return {created:0,updated:0};
  const scope = touched.length ? touched : null;

  await buildSignals(db, scope, runRef, now);

  const signals = (
    await db.query<SignalRow>(scope ? "select * from signals where project_id = any($1::uuid[])" : "select * from signals", scope ? [scope] : [])
  ).rows;
  const insightsCache: InsightsCache = new Map();
  const candidates = await buildCandidates(db, signals, { kinds: run.kinds, now, insightsCache });

  // Re-score existing leads in scope that no current signal produced (e.g. after new evidence).
  const keys = new Set(candidates.map((c) => `${c.kind}|${c.buyerId}|${c.projectId ?? ""}|${c.packageId ?? ""}`));
  const existing = (
    await db.query<LeadRow>(scope ? "select * from leads where project_id = any($1::uuid[])" : "select * from leads", scope ? [scope] : [])
  ).rows;
  for (const lead of existing) {
    const key = `${lead.kind}|${lead.buyer_company_id}|${lead.project_id ?? ""}|${lead.package_id ?? ""}`;
    if (keys.has(key) || !run.kinds.includes(lead.kind)) continue;
    candidates.push({ kind: lead.kind, buyerId: lead.buyer_company_id, projectId: lead.project_id, packageId: lead.package_id, signalIds: lead.signal_ids ?? [] });
    keys.add(key);
  }

  let created = 0;
  let updated = 0;
  for (const candidate of candidates) {
    try {
      const ctx = await loadContext(db, candidate, now, insightsCache, run.markets);
      if (!ctx) continue;
      const result = scoreContext(ctx);
      const outcome = await upsertLead(db, candidate, result, runRef, ctx);
      if (outcome === "created") created++;
      else updated++;
    } catch (error) {
      console.error("[scoring] candidate failed", candidate, error);
    }
  }
  return { created, updated };
}
