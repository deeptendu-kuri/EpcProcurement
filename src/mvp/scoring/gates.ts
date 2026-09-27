/**
 * Hard gates G1–G8 (docs/mvp/07 §3). A candidate must pass all 8; any failure → class `rejected`,
 * with the gate and reason stored. Gates only rely on evidence that is quote-verified with
 * agreement `both` or `rule` (06 §4, 12 §3).
 */
import type { GateResult } from "@/mvp/types";
import { AWARD_SIGNALS, SCORING_CONFIG } from "./config";
import { buyerParties, evidenceOf, type ScoringContext } from "./context";
import { daysBetween, formatDay, isGateGrade, monthsBetween, sameName, unique } from "./util";

const G = SCORING_CONFIG.gates;

// ───────────────────────── shared facts ─────────────────────────

/** Packages the scope gates look at: the lead's package, else all project packages. */
export function scopePackages(ctx: ScoringContext) {
  return ctx.leadPackage ? [ctx.leadPackage] : ctx.packages;
}

/** Latest award date for the lead: award signals, else the buyer's party award date. */
export function awardDate(ctx: ScoringContext): string | null {
  const fromSignals = ctx.triggerSignals.filter((s) => AWARD_SIGNALS.includes(s.type)).map((s) => s.signal_date);
  const fromParties = buyerParties(ctx).map((p) => p.award_date).filter((d): d is string => Boolean(d));
  const dates = [...fromSignals, ...fromParties].sort();
  return dates.at(-1) ?? null;
}

/** Latest date among the triggering signals. */
export function latestSignalDate(ctx: Pick<ScoringContext, "triggerSignals">): string | null {
  return ctx.triggerSignals.map((s) => s.signal_date).sort().at(-1) ?? null;
}

/** Closing date for bid leads (tender), else null. */
export function closingDate(ctx: ScoringContext): string | null {
  return ctx.tender?.closingDate ?? null;
}

function gateGradeIds(ctx: ScoringContext, ids: string[]): string[] {
  return ids.filter((id) => ctx.evidence[id] && isGateGrade(ctx.evidence[id]));
}

// ───────────────────────── gates ─────────────────────────

function g1(ctx: ScoringContext): GateResult {
  const certainty = ctx.buyer.match_certainty;
  if ((ctx.buyer.status ?? "").toLowerCase() === "struck_off")
    return { id: "G1", pass: false, why: `${ctx.buyer.canonical_name} is struck off the registry` };
  if (certainty < G.minMatchCertainty)
    return {
      id: "G1",
      pass: false,
      why: `We are not sure this is the right company (${Math.round(certainty * 100)}% match) — please check it by hand`,
    };
  const basis = ctx.buyer.registry_id ? `registry ${ctx.buyer.registry_source ?? ""} ${ctx.buyer.registry_id}`.replace(/\s+/g, " ") : ctx.buyer.lei ? `LEI ${ctx.buyer.lei}` : ctx.buyer.domain ? `domain ${ctx.buyer.domain}` : "name and country";
  return { id: "G1", pass: true, why: `Buyer identified by ${basis} (${Math.round(certainty * 100)}% match)` };
}

function g2(ctx: ScoringContext): GateResult {
  const { disciplines, adjacent_disciplines: adjacent } = ctx.profile;
  const packages = scopePackages(ctx);
  const inScope = packages.find((p) => disciplines.includes(p.discipline) || adjacent.includes(p.discipline));
  if (inScope) return { id: "G2", pass: true, why: `Package "${inScope.name}" is ${inScope.discipline.replace(/_/g, " ")}` };
  const active = new Set(ctx.profile.products.filter((p) => p.active).map((p) => p.id));
  const matched = ctx.requirements.find((r) => r.client_product_id && active.has(r.client_product_id));
  if (matched) return { id: "G2", pass: true, why: `Requirement "${matched.item_category}" matches one of your products` };
  if (!packages.length) return { id: "G2", pass: false, why: "No package or requirement identified for this project" };
  return {
    id: "G2",
    pass: false,
    why: `Package discipline (${unique(packages.map((p) => p.discipline)).join(", ")}) is outside your disciplines`,
  };
}

function g3(ctx: ScoringContext): GateResult {
  const markets: string[] = ctx.profile.markets;
  const projectCountry = ctx.project?.country ?? null;
  if (projectCountry && markets.includes(projectCountry)) return { id: "G3", pass: true, why: `Project in ${projectCountry}` };
  const buyerCountry = ctx.buyer.country;
  if (ctx.kind === "supply_subcontract" && buyerCountry && markets.includes(buyerCountry))
    return { id: "G3", pass: true, why: `Buyer based in ${buyerCountry}` };
  return {
    id: "G3",
    pass: false,
    why: projectCountry || buyerCountry ? `${projectCountry ?? buyerCountry} is not one of your markets` : "Project country unknown",
  };
}

function g4(ctx: ScoringContext): GateResult {
  const project = ctx.project;
  if (project && (project.status === "cancelled" || project.status === "completed"))
    return { id: "G4", pass: false, why: `Project is ${project.status}` };
  const stage = project?.current_stage;
  if (stage === "operations" || stage === "cancelled" || stage === "completed")
    return { id: "G4", pass: false, why: `Project stage is ${stage}` };

  if (ctx.kind === "bid") {
    if (ctx.tender?.status === "cancelled") return { id: "G4", pass: false, why: "Tender cancelled" };
    const close = closingDate(ctx);
    if (close) {
      const days = daysBetween(ctx.now, close);
      return days >= G.bidMinDaysToClose
        ? { id: "G4", pass: true, why: `Closes ${formatDay(close)} (${days} days)` }
        : { id: "G4", pass: false, why: `Closing date ${formatDay(close)} is less than ${G.bidMinDaysToClose} days away` };
    }
    const latest = latestSignalDate(ctx);
    const age = latest ? daysBetween(latest, ctx.now) : Number.POSITIVE_INFINITY;
    return age < G.bidMaxSignalAgeDaysWithoutClose
      ? { id: "G4", pass: true, why: `No closing date yet; latest signal ${age} days old` }
      : { id: "G4", pass: false, why: `No closing date and no signal in the last ${G.bidMaxSignalAgeDaysWithoutClose} days` };
  }

  const award = awardDate(ctx) ?? latestSignalDate(ctx);
  if (!award) return { id: "G4", pass: false, why: "No award or signal date" };
  const months = monthsBetween(award, ctx.now);
  return months < G.supplyMaxAwardAgeMonths
    ? { id: "G4", pass: true, why: `Awarded ${formatDay(award)} (${Math.max(0, Math.round(months))} months ago)` }
    : { id: "G4", pass: false, why: `Award ${formatDay(award)} is older than ${G.supplyMaxAwardAgeMonths} months` };
}

/** G5 for one signal: ≥ 1 Tier A gate-grade evidence, or ≥ 2 gate-grade evidence from different publishers. */
export function signalCorroborated(ctx: ScoringContext, evidenceIds: string[]): { pass: boolean; tierA: number; publishers: number } {
  const ids = gateGradeIds(ctx, evidenceIds);
  const tierA = ids.filter((id) => ctx.evidence[id].tier === "A").length;
  const publishers = unique(ids.map((id) => ctx.evidence[id].publisherKey)).length;
  return { pass: tierA >= 1 || publishers >= 2, tierA, publishers };
}

function g5(ctx: ScoringContext): GateResult {
  if (!ctx.triggerSignals.length) return { id: "G5", pass: false, why: "No triggering signal" };
  for (const signal of ctx.triggerSignals) {
    const result = signalCorroborated(ctx, signal.evidence_ids ?? []);
    if (result.pass)
      return {
        id: "G5",
        pass: true,
        why: result.tierA
          ? `"${signal.summary}" comes from an official or primary source`
          : `"${signal.summary}" is confirmed by ${result.publishers} independent sources`,
      };
  }
  return { id: "G5", pass: false, why: "Only one source so far, and not an official one — needs a second independent source" };
}

function g6(ctx: ScoringContext): GateResult {
  const groups: { label: string; ids: string[] }[] = [
    { label: "buyer", ids: evidenceOf(ctx, "company", ctx.buyer.id) },
    { label: "buyer role", ids: buyerParties(ctx).flatMap((p) => evidenceOf(ctx, "project_party", p.id)) },
    { label: "project", ids: evidenceOf(ctx, "project", ctx.project?.id) },
    { label: "package", ids: ctx.leadPackage ? evidenceOf(ctx, "package", ctx.leadPackage.id) : [] },
  ];
  const failed = groups.filter((g) => {
    const known = g.ids.filter((id) => ctx.evidence[id]);
    return known.length > 0 && gateGradeIds(ctx, known).length === 0;
  });
  const signalOk = ctx.triggerSignals.some((s) => gateGradeIds(ctx, s.evidence_ids ?? []).length > 0);
  if (!signalOk) failed.push({ label: "triggering signal", ids: [] });
  if (failed.length)
    return {
      id: "G6",
      pass: false,
      why: `Could not double-check these facts against the source text: ${failed.map((g) => g.label).join(", ")}`,
    };
  return { id: "G6", pass: true, why: "Key facts are checked against the exact source text" };
}

function g7(): GateResult {
  return { id: "G7", pass: true, why: "Sanctions screening not run in demo" };
}

function g8(ctx: ScoringContext): GateResult {
  const name = ctx.buyer.canonical_name;
  if (ctx.profile.excluded_company_names.some((excluded) => sameName(excluded, name)))
    return { id: "G8", pass: false, why: `${name} is on your excluded list` };
  if (ctx.existingCustomer) return { id: "G8", pass: true, why: `${name} is an existing customer — route to the account owner` };
  return { id: "G8", pass: true, why: "Not on your excluded list" };
}

/** Evaluate all 8 gates in order. */
export function evaluateGates(ctx: ScoringContext): GateResult[] {
  return [g1(ctx), g2(ctx), g3(ctx), g4(ctx), g5(ctx), g6(ctx), g7(), g8(ctx)];
}

export function allGatesPass(gates: GateResult[]): boolean {
  return gates.every((gate) => gate.pass);
}
