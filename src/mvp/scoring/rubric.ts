/**
 * The score (docs/mvp/07 §7): 5 criteria, 100 points. Each sub-criterion returns points or
 * `unknown` (points null → scores 0 and is listed in ScoreBreakdown.unknown, driving research).
 * Every SubScore.reason is a templated sentence filled with facts (07 §9 uses it for top reasons).
 */
import { eligibilityPoints } from "@/mvp/compliance";
import type { ClientProduct, CriterionScore, ScoreBreakdown, SubScore } from "@/mvp/types";
import { AWARD_SIGNALS, OPEN_ROUTE_SIGNALS, PLACE_COUNTRY, SCORING_CONFIG } from "./config";
import { buyerParties, evidenceOf, signalEvidence, type ScoringContext } from "./context";
import { awardDate, closingDate, scopePackages } from "./gates";
import { daysBetween, formatDay, formatUsd, monthsBetween, parseSpec, unique } from "./util";

const R = SCORING_CONFIG.rubric;

// ───────────────────────── structure ─────────────────────────

export const CRITERIA: { id: CriterionScore["id"]; label: string; max: number; subs: { id: string; label: string; max: number }[] }[] = [
  {
    id: "C1",
    label: "Scope fit",
    max: 25,
    subs: [
      { id: "1.1", label: "Discipline match", max: 10 },
      { id: "1.2", label: "Product / spec match", max: 6 },
      { id: "1.3", label: "Project type match", max: 5 },
      { id: "1.4", label: "Size", max: 4 },
    ],
  },
  {
    id: "C2",
    label: "Timing",
    max: 20,
    subs: [
      { id: "2.1", label: "Stage window", max: 8 },
      { id: "2.2", label: "Deadline ahead", max: 5 },
      { id: "2.3", label: "Recency", max: 4 },
      { id: "2.4", label: "Momentum", max: 3 },
    ],
  },
  {
    id: "C3",
    label: "Buyer strength",
    max: 20,
    subs: [
      { id: "3.1", label: "Right buyer", max: 6 },
      { id: "3.2", label: "Funded / confirmed", max: 6 },
      { id: "3.3", label: "Track record", max: 5 },
      { id: "3.4", label: "Financial health", max: 3 },
    ],
  },
  {
    id: "C4",
    label: "Access and eligibility",
    max: 20,
    subs: [
      { id: "4.1", label: "Client eligible", max: 8 },
      { id: "4.2", label: "Decision maker found", max: 6 },
      { id: "4.3", label: "Route open", max: 4 },
      { id: "4.4", label: "Relationship", max: 2 },
    ],
  },
  {
    id: "C5",
    label: "Commercial value",
    max: 15,
    subs: [
      { id: "5.1", label: "Value", max: 6 },
      { id: "5.2", label: "Competition", max: 4 },
      { id: "5.3", label: "Logistics fit", max: 5 },
    ],
  },
];

const SUB_DEF = new Map(CRITERIA.flatMap((c) => c.subs.map((s) => [s.id, s] as const)));

/** A SubScore with label and max filled from the rubric definition. */
export function sub(id: string, points: number | null, reason: string, evidenceIds: string[] = []): SubScore {
  const def = SUB_DEF.get(id);
  if (!def) throw new Error(`Unknown sub-criterion ${id}`);
  const clamped = points === null ? null : Math.max(0, Math.min(def.max, Math.round(points)));
  return { id, label: def.label, max: def.max, points: clamped, reason, evidenceIds: unique(evidenceIds) };
}

/** Assemble criteria (with totals) and the unknown list from sub-scores keyed by id. */
export function buildBreakdown(subs: SubScore[]): ScoreBreakdown {
  const byId = new Map(subs.map((s) => [s.id, s]));
  const criteria: CriterionScore[] = CRITERIA.map((c) => {
    const list = c.subs.map((d) => byId.get(d.id) ?? sub(d.id, null, "Not scored"));
    return { id: c.id, label: c.label, max: c.max, total: list.reduce((sum, s) => sum + (s.points ?? 0), 0), subs: list };
  });
  const unknown = criteria.flatMap((c) => c.subs.filter((s) => s.points === null).map((s) => s.id));
  return { criteria, unknown };
}

// ───────────────────────── helpers ─────────────────────────

const LABELS: Record<string, string> = { oil_gas: "oil and gas", main_epc: "main EPC", hvac: "HVAC" };
const humanize = (value: string) => LABELS[value] ?? value.replace(/_/g, " ");

function isOpenRoute(ctx: ScoringContext): boolean {
  if (ctx.tender) {
    if (ctx.tender.status === "open") return true;
    if (ctx.tender.closingDate && daysBetween(ctx.now, ctx.tender.closingDate) >= 0 && ctx.tender.status !== "closed" && ctx.tender.status !== "awarded" && ctx.tender.status !== "cancelled")
      return true;
  }
  return ctx.triggerSignals.some((s) => OPEN_ROUTE_SIGNALS.includes(s.type));
}

function productMatch(profileProducts: ClientProduct[], id: string | null, text: string): ClientProduct | undefined {
  const active = profileProducts.filter((p) => p.active);
  if (id) {
    const byId = active.find((p) => p.id === id);
    if (byId) return byId;
  }
  const t = text.toLowerCase();
  return active.find((p) => p.keywords.some((k) => t.includes(k.toLowerCase())));
}

function sweetSpot(ctx: ScoringContext, value: number): "below_min" | "below" | "within" | "above" {
  const { min_project_value_usd: min, sweet_spot_min_usd: lo, sweet_spot_max_usd: hi } = ctx.profile;
  if (min !== null && value < min) return "below_min";
  if (lo !== null && value < lo) return "below";
  if (hi !== null && value > hi) return "above";
  return "within";
}

function sourcesLabel(ctx: ScoringContext, ids: string[]): string {
  const publishers = unique(ids.map((id) => ctx.evidence[id]?.publisherKey).filter(Boolean));
  return publishers.length > 1 ? ` (${publishers.length} sources)` : publishers.length === 1 ? " (1 source)" : "";
}

// ───────────────────────── C1 scope fit ─────────────────────────

function s11(ctx: ScoringContext): SubScore {
  const packages = scopePackages(ctx);
  const core = packages.find((p) => ctx.profile.disciplines.includes(p.discipline));
  if (core) return sub("1.1", 10, `${core.name}: ${humanize(core.discipline)} is your core discipline`, evidenceOf(ctx, "package", core.id));
  const adj = packages.find((p) => ctx.profile.adjacent_disciplines.includes(p.discipline));
  if (adj) return sub("1.1", 6, `${adj.name}: ${humanize(adj.discipline)} is an adjacent discipline`, evidenceOf(ctx, "package", adj.id));
  return sub("1.1", 0, packages.length ? `Discipline ${humanize(packages[0].discipline)} is outside your scope` : "No package identified");
}

function s12(ctx: ScoringContext): SubScore {
  if (!ctx.requirements.length) return sub("1.2", null, "No requirement data yet (tender documents or BOQ needed)");
  let best: SubScore | null = null;
  for (const req of ctx.requirements) {
    const spec = parseSpec(req.spec, req.item_category);
    const product = productMatch(ctx.profile.products, req.client_product_id, `${req.item_category} ${JSON.stringify(req.spec ?? {})}`);
    const ev = evidenceOf(ctx, "requirement", req.id);
    const qty = req.quantity !== null ? `, ${req.quantity} ${req.unit ?? ""}`.trimEnd() : "";
    const described = [spec.odIn[0] !== undefined ? `${spec.odIn[0]}-inch` : "", spec.grades.join("/"), req.item_category].filter(Boolean).join(" ");
    let candidate: SubScore;
    if (!product) {
      candidate = sub("1.2", 0, `Needs ${described}${qty} — not one of your products`, ev);
    } else {
      const range = product.spec_ranges ?? {};
      const checks: boolean[] = [];
      if (spec.grades.length && range.grade?.length) checks.push(spec.grades.every((g) => range.grade!.map((x) => x.toUpperCase()).includes(g)));
      if (spec.standards.length && range.standard?.length)
        checks.push(spec.standards.some((s) => range.standard!.some((x) => x.toUpperCase() === s.toUpperCase())));
      if (spec.odIn.length && range.od_in) checks.push(spec.odIn.every((d) => d >= range.od_in![0] && d <= range.od_in![1]));
      if (checks.some((ok) => !ok)) candidate = sub("1.2", 0, `Needs ${described}${qty} — outside your ${product.name} range`, ev);
      else if (checks.length) candidate = sub("1.2", 6, `Needs ${described}${qty} — within your ${product.name} range`, ev);
      else candidate = sub("1.2", 3, `Needs ${req.item_category}${qty} — matches ${product.name} (spec not stated)`, ev);
    }
    if (!best || (candidate.points ?? 0) > (best.points ?? 0)) best = candidate;
  }
  return best!;
}

function s13(ctx: ScoringContext): SubScore {
  const sector = ctx.project?.sector ?? ctx.project?.project_type ?? null;
  const ev = evidenceOf(ctx, "project", ctx.project?.id);
  if (!sector) return sub("1.3", 0, "Project sector not stated", ev);
  if (ctx.profile.sectors.includes(sector)) return sub("1.3", 5, `${humanize(sector)} project — one of your sectors`, ev);
  if (ctx.profile.related_sectors.includes(sector)) return sub("1.3", 3, `${humanize(sector)} project — related sector`, ev);
  return sub("1.3", 0, `${humanize(sector)} is not one of your sectors`, ev);
}

function valueFact(ctx: ScoringContext): { value: number; from: "package" | "project"; ev: string[] } | null {
  const pkg = scopePackages(ctx).find((p) => p.value_usd !== null);
  if (pkg) return { value: pkg.value_usd!, from: "package", ev: evidenceOf(ctx, "package", pkg.id) };
  const party = buyerParties(ctx).find((p) => p.value_usd !== null);
  if (party && ctx.kind === "supply_subcontract")
    return { value: party.value_usd!, from: "package", ev: evidenceOf(ctx, "project_party", party.id) };
  if (ctx.project?.value_usd != null) return { value: ctx.project.value_usd, from: "project", ev: evidenceOf(ctx, "project", ctx.project.id) };
  return null;
}

function s14(ctx: ScoringContext): SubScore {
  const fact = valueFact(ctx);
  if (!fact) return sub("1.4", null, "Value not published");
  const label = `${fact.from === "package" ? "Contract" : "Project"} value ${formatUsd(fact.value)}`;
  switch (sweetSpot(ctx, fact.value)) {
    case "within":
      return sub("1.4", 4, `${label}, in your sweet spot`, fact.ev);
    case "above":
      return sub("1.4", 2, `${label}, above your sweet spot`, fact.ev);
    case "below":
      return sub("1.4", 2, `${label}, above your minimum but below the sweet spot`, fact.ev);
    default:
      return sub("1.4", 0, `${label}, below your minimum`, fact.ev);
  }
}

// ───────────────────────── C2 timing ─────────────────────────

function s21(ctx: ScoringContext): SubScore {
  const stage = ctx.project?.current_stage ?? null;
  const stageEv = ctx.stageEvents.flatMap((e) => (e.evidence_id ? [e.evidence_id] : []));
  if (ctx.kind === "bid") {
    if (isOpenRoute(ctx) || stage === "prequalification" || stage === "epc_tender")
      return sub("2.1", 8, "Tender or prequalification is open now", [...signalEvidence(ctx.triggerSignals), ...(ctx.tender?.evidenceIds ?? [])]);
    if (stage === "feed" || ctx.project?.funding_status === "budgeted") return sub("2.1", 5, "FEED stage or budgeted — tender expected", stageEv);
    if (stage === "concept" || stage === "feasibility" || ctx.project?.funding_status === "announced")
      return sub("2.1", 2, "Announced / concept stage — early", stageEv);
    return sub("2.1", 0, stage ? `Stage ${humanize(stage)} — not a bid window` : "Stage unknown", stageEv);
  }
  const award = awardDate(ctx);
  const awardEv = signalEvidence(ctx.triggerSignals.filter((s) => AWARD_SIGNALS.includes(s.type)));
  if (stage === "commissioning") return sub("2.1", 0, "Project is commissioning — procurement is over", stageEv);
  const months = award ? monthsBetween(award, ctx.now) : Number.NaN;
  if ((award && months <= R.supplyAwardFreshMonths) || stage === "detailed_engineering" || stage === "procurement") {
    const days = award ? daysBetween(award, ctx.now) : null;
    return sub("2.1", 8, award ? `Awarded ${formatDay(award)} (${days} days ago) — procurement window open` : `Stage ${humanize(stage!)} — buying now`, [...awardEv, ...stageEv]);
  }
  if (award && months <= R.supplyAwardMaxMonths) return sub("2.1", 5, `Awarded ${formatDay(award)} — 9–18 months ago`, awardEv);
  if (stage === "construction") return sub("2.1", 2, "Construction under way — late for most packages", stageEv);
  return sub("2.1", 0, award ? `Awarded ${formatDay(award)} — over 18 months ago` : "No award date", awardEv);
}

function s22(ctx: ScoringContext): SubScore {
  const close = closingDate(ctx);
  const neededBy =
    ctx.leadPackage?.needed_by ??
    ctx.requirements.map((r) => r.needed_by).filter((d): d is string => Boolean(d)).sort()[0] ??
    null;
  const date = close ?? neededBy;
  if (!date) return sub("2.2", null, "No closing or needed-by date");
  const label = close ? "Closes" : "Needed by";
  const ev = close ? ctx.tender?.evidenceIds ?? [] : ctx.leadPackage ? evidenceOf(ctx, "package", ctx.leadPackage.id) : [];
  const days = daysBetween(ctx.now, date);
  const text = `${label} ${formatDay(date)} (${days} days)`;
  if (days >= R.deadlineBest[0] && days <= R.deadlineBest[1]) return sub("2.2", 5, text, ev);
  if ((days >= R.deadlineOkLow[0] && days <= R.deadlineOkLow[1]) || (days >= R.deadlineOkHigh[0] && days <= R.deadlineOkHigh[1]))
    return sub("2.2", 3, text, ev);
  return sub("2.2", 0, text, ev);
}

function s23(ctx: ScoringContext): SubScore {
  const signals = [...ctx.triggerSignals, ...ctx.projectSignals];
  const latest = signals.map((s) => s.signal_date).sort().at(-1);
  if (!latest) return sub("2.3", 0, "No signal yet");
  const days = Math.max(0, daysBetween(latest, ctx.now));
  const points = Math.round(R.recencyMax * Math.pow(0.5, days / R.recencyHalfLifeDays));
  const latestSignal = signals.find((s) => s.signal_date === latest)!;
  return sub("2.3", points, `Latest signal ${days} days ago (${formatDay(latest)})`, latestSignal.evidence_ids ?? []);
}

function s24(ctx: ScoringContext): SubScore {
  const byId = new Map([...ctx.triggerSignals, ...ctx.projectSignals].map((s) => [s.id, s]));
  const recent = [...byId.values()].filter((s) => {
    const age = daysBetween(s.signal_date, ctx.now);
    return age >= 0 ? age <= R.momentumWindowDays : true;
  });
  const types = unique(recent.map((s) => s.type));
  const ev = signalEvidence(recent);
  if (types.length >= 2) return sub("2.4", 3, `${types.length} kinds of signal in 90 days (${types.map(humanize).join(", ")})`, ev);
  if (types.length === 1) return sub("2.4", 1, `One kind of signal in 90 days (${humanize(types[0])})`, ev);
  return sub("2.4", 0, "No signal in the last 90 days");
}

// ───────────────────────── C3 buyer strength ─────────────────────────

function s31(ctx: ScoringContext): SubScore {
  const name = ctx.buyer.canonical_name;
  if (ctx.kind === "bid") {
    const authority = ctx.tender?.buyerCompanyId ?? ctx.project?.owner_company_id ?? null;
    if (authority === ctx.buyer.id) return sub("3.1", 6, `${name} is the tendering authority`, [...(ctx.tender?.evidenceIds ?? []), ...evidenceOf(ctx, "project", ctx.project?.id)]);
    if (!authority) return sub("3.1", null, "Tendering authority not confirmed");
  }
  const pkg = ctx.leadPackage;
  if (pkg?.package_owner_company_id === ctx.buyer.id) return sub("3.1", 6, `${name} owns the ${pkg.name} package`, evidenceOf(ctx, "package", pkg.id));
  if (pkg?.package_owner_company_id && pkg.package_owner_company_id !== ctx.buyer.id)
    return sub("3.1", 0, `${pkg.name} is owned by another company`, evidenceOf(ctx, "package", pkg.id));
  const roles = buyerParties(ctx);
  const discipline = pkg?.discipline ?? null;
  const typical =
    roles.some((p) => p.role === "main_epc" || p.role === "consortium_member" || (p.role === "subcontractor" && (!p.package_id || p.package_id === pkg?.id))) ||
    (discipline !== null && (ctx.insights?.typicalSubcontracted.includes(discipline) || ctx.insights?.typicalSelfPerformed.includes(discipline)));
  if (typical) {
    const role = roles[0]?.role;
    return sub("3.1", 3, `Package owner not yet confirmed; ${name}${role ? ` (${humanize(role)})` : ""} typically buys this`, roles.flatMap((p) => evidenceOf(ctx, "project_party", p.id)));
  }
  return sub("3.1", null, "Package owner unknown");
}

function s32(ctx: ScoringContext): SubScore {
  const roles = buyerParties(ctx);
  const awarded = roles.find((p) => p.award_date || p.status === "awarded" || p.status === "active");
  const funding = ctx.project?.funding_status ?? null;
  if (awarded)
    return sub("3.2", 6, `Award confirmed${awarded.award_date ? ` ${formatDay(awarded.award_date)}` : ""}${sourcesLabel(ctx, evidenceOf(ctx, "project_party", awarded.id))}`, evidenceOf(ctx, "project_party", awarded.id));
  if (funding === "fid" || funding === "awarded") return sub("3.2", 6, `Funding confirmed (${funding.toUpperCase()})`, evidenceOf(ctx, "project", ctx.project?.id));
  const government = ctx.tender?.isGovernment ?? ctx.buyer.types.includes("government_buyer");
  if ((government && ctx.tender?.budgetUsd != null) || funding === "budgeted")
    return sub("3.2", 4, ctx.tender?.budgetUsd != null ? `Government tender with budget ${formatUsd(ctx.tender.budgetUsd)}` : "Budget approved", ctx.tender?.evidenceIds ?? []);
  return sub("3.2", 1, "Announcement only", evidenceOf(ctx, "project", ctx.project?.id));
}

function s33(ctx: ScoringContext): SubScore {
  const history = (ctx.insights?.projects ?? []).filter(
    (p) =>
      p.projectId !== ctx.project?.id &&
      p.role !== "owner" &&
      p.awardDate !== null &&
      monthsBetween(p.awardDate, ctx.now) <= R.trackRecordYears * 12,
  );
  const sector = ctx.project?.sector ?? null;
  const similar = history.filter((p) => sector === null || p.sector === sector);
  const ev = similar.flatMap((p) => p.evidenceIds);
  if (similar.length >= 3) return sub("3.3", 5, `${similar.length} similar awards in the last 5 years`, ev);
  if (similar.length >= 1) return sub("3.3", 3, `${similar.length} similar award${similar.length > 1 ? "s" : ""} in the last 5 years`, ev);
  if (history.length) return sub("3.3", 1, `${history.length} awards, only in other sectors`, history.flatMap((p) => p.evidenceIds));
  return sub("3.3", null, "No award history found");
}

function s34(ctx: ScoringContext): SubScore {
  const active = (ctx.buyer.status ?? "").toLowerCase() === "active";
  const recentFiling = ctx.buyer.verified_at ? monthsBetween(ctx.buyer.verified_at, ctx.now) <= R.recentFilingMonths : false;
  const ev = evidenceOf(ctx, "company", ctx.buyer.id);
  if (active && (ctx.buyer.listed_exchange || recentFiling))
    return sub("3.4", 3, ctx.buyer.listed_exchange ? `Active and listed on ${ctx.buyer.listed_exchange}` : "Active with a recent filing", ev);
  if (active) return sub("3.4", 2, "Registry status active", ev);
  return sub("3.4", 1, "Financial status unknown", ev);
}

// ───────────────────────── C4 access ─────────────────────────

function s41(ctx: ScoringContext): SubScore {
  const { points, missing, unknown } = eligibilityPoints(ctx.checklist);
  if (points === 0) return sub("4.1", 0, `Missing: ${missing.map((m) => m.title).join(", ")}`);
  if (points === 4) return sub("4.1", 4, `Status unknown: ${unknown.map((m) => m.title).join(", ")}`);
  return sub("4.1", 8, "You meet the required registrations and certifications for this market");
}

const BUYING_ROLES = new Set(["decision_maker", "procurement_lead", "package_manager", "tender_contact"]);

function s42(ctx: ScoringContext): SubScore {
  const packageIds = new Set(scopePackages(ctx).map((p) => p.id));
  const mapped = ctx.people.find(({ roles }) =>
    roles.some(
      (r) => BUYING_ROLES.has(r.buying_role) && ((r.project_id && r.project_id === ctx.project?.id) || (r.package_id && packageIds.has(r.package_id))),
    ),
  );
  if (mapped) {
    const role = mapped.roles.find((r) => BUYING_ROLES.has(r.buying_role))!;
    return sub(
      "4.2",
      3,
      `${mapped.person.title ?? humanize(role.buying_role)} identified (${mapped.person.full_name}); contact not verified`,
      [...evidenceOf(ctx, "person", mapped.person.id), ...evidenceOf(ctx, "person_role", role.id)],
    );
  }
  if (ctx.buyer.domain || ctx.people.some(({ person }) => person.current_company_id === ctx.buyer.id))
    return sub("4.2", 1, `Company channel only${ctx.buyer.domain ? ` (${ctx.buyer.domain})` : ""}`);
  return sub("4.2", null, "Nobody found yet");
}

function s43(ctx: ScoringContext): SubScore {
  if (ctx.kind === "bid" && isOpenRoute(ctx))
    return sub("4.3", 4, ctx.tender?.route === "prequal" ? "Prequalification open" : "Open tender", ctx.tender?.evidenceIds ?? signalEvidence(ctx.triggerSignals));
  if (ctx.kind === "supply_subcontract") {
    const award = awardDate(ctx);
    if (award && monthsBetween(award, ctx.now) < SCORING_CONFIG.gates.supplyMaxAwardAgeMonths)
      return sub("4.3", 2, `Recent award — ${ctx.buyer.canonical_name} is procuring`, signalEvidence(ctx.triggerSignals.filter((s) => AWARD_SIGNALS.includes(s.type))));
  }
  if (scopePackages(ctx).some((p) => p.procurement_route === "approved_vendor_list")) return sub("4.3", 1, "Closed approved-vendor list");
  return sub("4.3", null, "Buying route not known");
}

function s44(ctx: ScoringContext): SubScore {
  if (ctx.existingCustomer) return sub("4.4", 2, "Existing customer");
  if (ctx.priorContact) return sub("4.4", 2, "Prior contact recorded");
  return sub("4.4", 0, "No existing relationship");
}

// ───────────────────────── C5 commercial ─────────────────────────

function s51(ctx: ScoringContext): SubScore {
  const fact = valueFact(ctx);
  if (!fact) return sub("5.1", null, "Value unknown");
  const band = sweetSpot(ctx, fact.value);
  if (fact.from === "package") {
    if (band === "within") return sub("5.1", 6, `Contract value ${formatUsd(fact.value)} in your sweet spot`, fact.ev);
    if (band === "above") return sub("5.1", 4, `Contract value ${formatUsd(fact.value)}, above your sweet spot`, fact.ev);
    return sub("5.1", 0, `Contract value ${formatUsd(fact.value)}, below your sweet spot`, fact.ev);
  }
  if (band !== "below_min") return sub("5.1", 2, `Project value ${formatUsd(fact.value)} only`, fact.ev);
  return sub("5.1", 0, `Project value ${formatUsd(fact.value)}, below your minimum`, fact.ev);
}

function s52(ctx: ScoringContext): SubScore {
  const n = ctx.competitorCount;
  if (n === null) return sub("5.2", null, "Competition unknown");
  const ev = ctx.tender?.evidenceIds ?? [];
  if (n <= 3) return sub("5.2", 4, `${n} known bidders or approved vendors`, ev);
  if (n <= 6) return sub("5.2", 2, `${n} known bidders or approved vendors`, ev);
  return sub("5.2", 1, `${n} known bidders — crowded`, ev);
}

function s53(ctx: ScoringContext): SubScore {
  const places: { text: string; ev: string[] }[] = [];
  for (const req of ctx.requirements) {
    const ev = evidenceOf(ctx, "requirement", req.id);
    if (req.delivery_port) places.push({ text: req.delivery_port, ev });
    if (req.delivery_site) places.push({ text: req.delivery_site, ev });
  }
  const projectEv = evidenceOf(ctx, "project", ctx.project?.id);
  if (ctx.project?.site) places.push({ text: ctx.project.site, ev: projectEv });
  if (ctx.project?.region) places.push({ text: ctx.project.region, ev: projectEv });
  const served = [...ctx.profile.served_ports, ...ctx.profile.served_regions];
  for (const place of places) {
    const p = place.text.toLowerCase();
    const hit = served.find((s) => p.includes(s.toLowerCase()) || s.toLowerCase().includes(p));
    if (hit) return sub("5.3", 5, `Delivery to ${place.text} — you serve ${hit}`, place.ev);
  }
  const servedCountries = new Set(served.map((s) => PLACE_COUNTRY[s.toLowerCase()]).filter(Boolean));
  const country = ctx.project?.country ?? null;
  if (country && servedCountries.has(country))
    return sub("5.3", 3, `${places[0]?.text ? `${places[0].text}, ` : ""}${country} — same country as a region you serve`, places[0]?.ev ?? projectEv);
  if (places.length || country) return sub("5.3", 1, `${places[0]?.text ?? country} — outside your served ports and regions`, places[0]?.ev ?? projectEv);
  return sub("5.3", null, "Delivery location unknown");
}

// ───────────────────────── entry ─────────────────────────

/** Score all 19 sub-criteria (07 §7 tables) and assemble the breakdown. */
export function scoreRubric(ctx: ScoringContext): ScoreBreakdown {
  return buildBreakdown([
    s11(ctx), s12(ctx), s13(ctx), s14(ctx),
    s21(ctx), s22(ctx), s23(ctx), s24(ctx),
    s31(ctx), s32(ctx), s33(ctx), s34(ctx),
    s41(ctx), s42(ctx), s43(ctx), s44(ctx),
    s51(ctx), s52(ctx), s53(ctx),
  ]);
}
