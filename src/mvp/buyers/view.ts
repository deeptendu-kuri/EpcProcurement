/**
 * Buyer view builder (docs/mvp/14 §1–§9): turns one lead and its verified facts into a BuyerView —
 * who is buying (role), why now, what they'll buy from the client (with competitor check), why you,
 * who to talk to and when. Pure: the database loader (load.ts) builds the BuyerInput.
 */
import { getCatalogueItem } from "@/mvp/config/buyers-config";
import { outreachRules } from "@/mvp/compliance";
import { companyNameParts, shortCompanyName } from "@/mvp/pipeline/text";
import type {
  CompanyRow,
  LeadRow,
  PackageRow,
  ProjectPartyRow,
  ProjectRow,
  Reason,
  RequirementRow,
  SignalRow,
} from "@/mvp/types";
import { buildChain } from "./chain";
import { countryName, formatMoney, formatMoneyWithUsd, monthYearOf } from "./format";
import {
  catalogueItemsIn,
  competitorItems,
  competitorNote,
  joinAnd,
  monthRange,
  pickNeedsRule,
  sellItemsFor,
  sellSummary,
  shortItemName,
  type SellPlanItem,
} from "./needs";
import {
  findKnownCompany,
  projectTypeFor,
  resolveBuyerRole,
  roleLabel,
  situationFor,
  subRoleLabelFor,
  type Situation,
} from "./roles";
import { buildTeam, slotDefs, teamCounts, type TeamPerson } from "./team";
import type { BuyerDeal, BuyerRole, BuyerRow, BuyerSignal, BuyerStage, BuyerView, ChainTier, ProofItem, SlotRole } from "./types";
import { whyYouFor, type WhyYouFacts } from "./why-you";
import { CONSULTANT_REASON, isConsultant, plainWords, supplierTypeKeyFor, whatTheyDoLabel } from "./what-they-do";
import { companyGroupKey } from "./group";
import { isPlaceName } from "@/mvp/pipeline/merge";

export const PLACE_NAME_REASON = "Place name, not a company";
import { currentStep, windowSteps } from "./window";

/** Evidence as the buyer view needs it: the quote, its full sentence and its source. */
export interface EvidenceLite {
  id: string;
  quote: string;
  sentence: string | null;
  url: string | null;
  source: string;
  publishedAt: string | null;
  verified: boolean;
}

export interface PartyWithName extends Pick<ProjectPartyRow, "id" | "company_id" | "role" | "package_id" | "scope_text" | "contract_value" | "currency" | "value_usd" | "award_date"> {
  companyName: string;
}

export type LeadForView = Pick<
  LeadRow,
  "id" | "kind" | "buyer_company_id" | "class" | "status" | "score" | "confidence_band" | "reasons" | "closing_date" | "is_sample" | "created_at" | "updated_at" | "client_product_ids" | "tender_ref" | "project_id" | "package_id"
> & { buyer_type?: string | null; signal_ids?: string[]; chain_tier?: number | null; found_via_lead_id?: string | null };

export interface BuyerInput {
  now: Date;
  lead: LeadForView;
  buyer: Pick<CompanyRow, "id" | "canonical_name" | "country" | "types" | "domain" | "parent_company_id" | "listed_exchange">;
  parent: Pick<CompanyRow, "id" | "canonical_name"> | null;
  project: Pick<ProjectRow, "id" | "name" | "owner_company_id" | "country" | "site" | "sector" | "project_type" | "estimated_value" | "currency" | "value_usd" | "specs"> | null;
  owner: Pick<CompanyRow, "id" | "canonical_name" | "country" | "types"> | null;
  /** The lead's package, or every package of the project when it has none. */
  packages: Pick<PackageRow, "id" | "discipline" | "name" | "scope_text" | "needed_by" | "procurement_route">[];
  requirements: Pick<RequirementRow, "package_id" | "item_category" | "spec" | "needed_by" | "delivery_site" | "delivery_port">[];
  /** Every party on the project, with company names. */
  parties: PartyWithName[];
  /** Signals that triggered the lead (first) and other signals on the project. */
  signals: Pick<SignalRow, "id" | "type" | "signal_date" | "company_id" | "summary" | "evidence_ids">[];
  /** People named in sources at the buyer company. */
  people: TeamPerson[];
  /** People named in sources per company (for the chain's "X of Y found"). */
  peopleByCompany: ReadonlyMap<string, TeamPerson[]>;
  /** evidence id → evidence (every id referenced below). */
  evidence: Readonly<Record<string, EvidenceLite>>;
  /** Evidence behind facts about the buyer itself (company row, its party rows). */
  buyerEvidenceIds: string[];
  confirmedPersonIds: ReadonlySet<string>;
  /** Project stage event dates (awarded …) for the trigger date fallback. */
  awardedDate?: string | null;
  /** Name of the tier-1 buyer a materialised derived lead was found via (15 §D). */
  foundViaName?: string | null;
}

/** A built view plus the attributes search filters on. */
export interface BuyerRecord {
  view: BuyerView;
  row: BuyerRow;
  hqCountry: string | null;
  siteCountry: string | null;
  site: string | null;
  sector: string | null;
  valueUsd: number | null;
  signals: BuyerSignal[];
  createdAt: string;
  /** Slot id → department (Contacts filter). */
  slotDepartments: Record<string, string>;
  leadStatus: string;
  /** True when the buyer competes on every item it would buy. */
  competitorForAll: boolean;
  // ---- doc 15 ----
  /** Supply-map type key of the buyer ("pipeline_builder", "pipe_maker" …). */
  typeKey: string;
  /** One row per company: records with the same key are grouped (15 §A3). */
  groupKey: string;
  projectId: string | null;
  projectType: string | null;
  /** True for a consultant (not a buyer, 15 §A4). */
  consultant: boolean;
  /** Evidence sources behind this deal. */
  sourceCount: number;
  /** For derived records (tier 2/3 companies without a lead). */
  derived?: { key: string; rootLeadId: string; link: "confirmed" | "likely" | "possible" };
}

const STAGE_FROM_CLASS: Record<string, BuyerStage> = { genuine: "ready", research: "check", watch: "early", rejected: "not_buyer" };

/** Stage from the lead class (14 §1). */
export function stageFromClass(cls: string): BuyerStage {
  return STAGE_FROM_CLASS[cls] ?? "check";
}

const EMAIL_SUMMARY: Record<string, string> = {
  allowed: "Cold email is allowed.",
  opt_out_only: "Cold email is allowed with a working opt-out.",
  consent_needed: "Cold email needs consent.",
  blocked: "Do not email.",
};

/** Signal type → the SuperSearch "Buying signal" value. */
export function buyerSignalFor(type: string, partyRole: string | null): BuyerSignal {
  if (type === "contract_awarded") return partyRole === "supplier" ? "order_won" : "contract_won";
  if (type === "subcontract_awarded") return "contract_won";
  if (type === "supply_order_announced") return "order_won";
  if (type === "tender_released" || type === "tender_closing_soon" || type === "prequalification_opened" || type === "vendor_registration_opened" || type === "bid_results_published") return "tender_open";
  return "expansion";
}

const STANDARD_RE = /\b(?:API\s?(?:5L|5CT|6D|6A|600|602|594|608|609|610|526|Q1)|ASTM\s?[A-Z]\s?\d{1,4}|ASME\s?B\d+(?:\.\d+)?|NACE\s?(?:MR|SP)\s?\d{4}|ISO\s?\d{3,5}(?:-\d)?|EN\s?\d{3,5}|AWWA\s?C\d{3}|BS\s?\d{3,5})\b/gi;

function standardsIn(text: string): string[] {
  return [...new Set([...text.matchAll(STANDARD_RE)].map((m) => m[0].replace(/\s+/g, " ").toUpperCase()))];
}

function deliveryMonthsIn(text: string): number | null {
  const m = text.match(/\bwithin\s+(\d{1,2})\s+months?\b|\b(\d{1,2})[- ]month\s+(?:delivery|schedule|period|timeline)\b|\bdeliver\w*\s+(?:in|over)\s+(\d{1,2})\s+months?\b/i);
  if (!m) return null;
  const n = Number(m[1] ?? m[2] ?? m[3]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function monthsBetween(from: string, to: string): number {
  return (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / (30.44 * 86_400_000);
}

function dayOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

/** "Saudi Aramco" for "Saudi Arabian Oil Co. (Saudi Aramco)": the written alias, else the main name. */
function displayOwner(name: string): string {
  const { main, aliases } = companyNameParts(name);
  return aliases.find((a) => a.length > 4) ?? main;
}

/** "steel pipe", "valves" … — what an order was for, from requirements / packages. */
function orderWord(input: BuyerInput, mentionedIds: string[]): string {
  const req = input.requirements.find((r) => r.item_category && r.item_category.length <= 30);
  if (req) return req.item_category.toLowerCase();
  const pipe = mentionedIds.find((id) => getCatalogueItem(id)?.category === "Pipes");
  if (pipe) return "pipe";
  const pkg = input.packages[0];
  if (pkg?.discipline === "pipeline" || pkg?.discipline === "piping") return "pipe";
  return "supply";
}

/** Build the buyer view (and its search attributes) for one lead. */
export function buildBuyerView(input: BuyerInput): BuyerRecord {
  const { lead, buyer, project } = input;
  const now = input.now;
  const name = buyer.canonical_name;
  const known = findKnownCompany(name);
  const shortName = known?.names.find((n) => /^[A-Z0-9&]{2,8}$/.test(n)) ?? shortCompanyName(name);
  // The known-companies list is the authority on HQ country (a company's country can come from the publisher).
  const hq = known?.country ?? buyer.country ?? null;

  // ── verified text about the buyer ──
  const buyerParties = input.parties.filter((p) => p.company_id === buyer.id);
  const triggerIds = new Set(lead.signal_ids ?? []);
  const triggers = input.signals.filter((s) => triggerIds.has(s.id));
  const leadSignals = triggers.length ? triggers : input.signals.filter((s) => s.company_id === buyer.id).slice(0, 3);
  const sentence = (id: string) => input.evidence[id]?.sentence ?? input.evidence[id]?.quote ?? "";
  const buyerEvidence = [...new Set([...input.buyerEvidenceIds, ...leadSignals.flatMap((s) => s.evidence_ids ?? [])])].filter((id) => input.evidence[id]);
  const packageText = input.packages.map((p) => `${p.name} ${p.scope_text ?? ""}`).join(" ");
  const requirementText = input.requirements.map((r) => `${r.item_category} ${JSON.stringify(r.spec ?? {})}`).join(" ");
  const partyText = buyerParties.map((p) => p.scope_text ?? "").join(" ");
  const buyerText = [partyText, ...leadSignals.map((s) => s.summary), ...buyerEvidence.map(sentence)].join(" \n ");
  const scopeText = [packageText, requirementText, partyText].join(" ");

  // ── role and situation ──
  const role: BuyerRole = resolveBuyerRole(lead.buyer_type ?? null, name, buyer.types ?? [], buyerText, lead.kind);
  const disciplines = input.packages.map((p) => p.discipline);
  const situationFacts = {
    projectType: project?.project_type ?? null,
    sector: project?.sector ?? null,
    projectName: project?.name ?? null,
    disciplines,
    text: `${scopeText} ${buyerText}`,
  };
  const situation: Situation = situationFor(role, name, situationFacts);
  const projectType = projectTypeFor(situationFacts);
  const openTender = lead.kind === "bid" || leadSignals.some((s) => buyerSignalFor(s.type, null) === "tender_open");
  const rule = pickNeedsRule(role, situation, { openTender: role === "owner" && openTender });

  // ── trigger ──
  const buyerParty = buyerParties.find((p) => p.award_date) ?? buyerParties[0] ?? null;
  const signalDates = leadSignals.map((s) => s.signal_date).filter(Boolean).sort();
  const triggerDate = dayOnly(buyerParty?.award_date) ?? dayOnly(signalDates[0]) ?? dayOnly(input.awardedDate) ?? null;
  const signalKinds = [...new Set(leadSignals.map((s) => buyerSignalFor(s.type, buyerParty?.role ?? null)))];
  if (!signalKinds.length && lead.kind === "bid") signalKinds.push("tender_open");

  // ── what they'll buy ──
  const mentioned = new Map<string, string[]>();
  const mention = (id: string, evidenceId?: string) => {
    const list = mentioned.get(id) ?? [];
    if (evidenceId && !list.includes(evidenceId)) list.push(evidenceId);
    mentioned.set(id, list);
  };
  for (const id of catalogueItemsIn(scopeText)) mention(id);
  for (const evidenceId of buyerEvidence) for (const id of catalogueItemsIn(sentence(evidenceId))) mention(id, evidenceId);
  const mentionedIds = [...mentioned.keys()];
  const competitors = competitorItems({ role, situation, name, text: buyerText, known, orderItemIds: role === "manufacturer" ? mentionedIds : [] });
  const productRange = role === "distributor" ? [...new Set([...(known?.makes ?? []), ...mentionedIds])] : [];
  const plan: SellPlanItem[] = sellItemsFor({ role, situation, rule, triggerDate, projectType, mentioned, productRange, competitors });
  const sellable = plan.filter((i) => i.fit !== "competitor");
  const competitorForAll = plan.length > 0 && sellable.length === 0 && competitors.size > 0;
  const sellItems = plan.map((planned) => {
    const item: Partial<SellPlanItem> = { ...planned };
    delete item.group;
    return item as BuyerView["sellItems"][number];
  });

  // ── window ──
  const deliveryFromReq = input.requirements.map((r) => r.needed_by).concat(input.packages.map((p) => p.needed_by)).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
  const deliveryMonthsText = deliveryMonthsIn(buyerText);
  const deliveryDate = deliveryFromReq ?? (triggerDate && deliveryMonthsText ? new Date(Date.parse(`${triggerDate}T00:00:00Z`) + deliveryMonthsText * 30.44 * 86_400_000).toISOString().slice(0, 10) : null);
  const skipGroups = new Set<number>();
  rule?.groups.forEach((g, index) => {
    const inGroup = plan.filter((i) => i.group === index);
    if (g.items.length && inGroup.length && inGroup.every((i) => i.fit === "competitor")) skipGroups.add(index);
    if (g.label === "Together with pipe") skipGroups.add(index);
  });
  const window = windowSteps(rule, triggerDate, now, { deliveryDate, closingDate: dayOnly(lead.closing_date), skipGroups });

  // ── why you ──
  const siteCountry = project?.country ?? null;
  const deliveryPort = input.requirements.find((r) => r.delivery_port)?.delivery_port ?? null;
  const deliverySite = input.requirements.find((r) => r.delivery_site)?.delivery_site ?? project?.site ?? null;
  const categories = new Set(sellable.map((i) => i.category)).size;
  const ownerName = input.owner?.canonical_name ?? (role === "owner" ? name : null);
  const deliveryMonths = deliveryMonthsText ?? (triggerDate && deliveryFromReq ? monthsBetween(triggerDate, deliveryFromReq) : null);
  const whyFacts: WhyYouFacts = {
    buyerCountry: hq,
    siteCountry,
    site: deliverySite,
    deliveryPort,
    deliveryMonths: deliveryMonths !== null && deliveryMonths > 0 ? deliveryMonths : null,
    urgent: /\b(?:urgent\w*|fast[- ]track\w*|immediate delivery|on an expedited basis)\b/i.test(buyerText),
    standards: standardsIn(`${requirementText} ${buyerText} ${JSON.stringify(project?.specs ?? {})}`),
    ownerName,
    categories,
    publicTender: lead.kind === "bid" && ((input.owner?.types ?? buyer.types ?? []) as string[]).includes("government_buyer"),
  };
  const whyYou = competitorForAll ? [] : whyYouFor(whyFacts);

  // ── team and chain ──
  const team = buildTeam(role, shortName, input.people, { confirmedPersonIds: input.confirmedPersonIds, website: buyer.domain ?? null, who: shortName });
  const { found, total } = teamCounts(team);
  const counts = (companyId: string, r: BuyerRole) => {
    const people = input.peopleByCompany.get(companyId) ?? [];
    return teamCounts(buildTeam(r, companyId, people));
  };
  const parentName = input.parent?.canonical_name ?? known?.parentGroup ?? null;
  const chain = buildChain({
    buyerId: buyer.id,
    buyerRole: role,
    situation,
    owner: input.owner ? { companyId: input.owner.id, name: input.owner.canonical_name } : null,
    parties: input.parties.map((p) => ({ companyId: p.company_id, name: p.companyName, partyRole: p.role, scope: p.scope_text })),
    parent: parentName ? { companyId: input.parent?.id ?? null, name: parentName } : null,
    teamCounts: counts,
    projectType,
  });

  // ── reach ──
  const rule0 = outreachRules(hq ?? "");
  const reach = {
    country: hq,
    email: rule0.email,
    summary: `${EMAIL_SUMMARY[rule0.email] ?? ""} ${rule0.steps[0] ?? ""}`.trim(),
  };

  // ── buying reason ──
  const ownerShort = input.owner && input.owner.id !== buyer.id ? shortCompanyName(input.owner.canonical_name) : null;
  const money = buyerParty?.contract_value
    ? { local: formatMoney(buyerParty.contract_value, buyerParty.currency), full: formatMoneyWithUsd(buyerParty.contract_value, buyerParty.currency, buyerParty.value_usd) }
    : project?.estimated_value
      ? { local: formatMoney(project.estimated_value, project.currency), full: formatMoneyWithUsd(project.estimated_value, project.currency, project.value_usd) }
      : null;
  const when = monthYearOf(triggerDate);
  const word = orderWord(input, mentionedIds);
  const projectName = project?.name ?? null;
  const signal = signalKinds[0] ?? null;
  const reasons: Reason[] = Array.isArray(lead.reasons) ? lead.reasons : [];
  let shortReason: string;
  let longReason: string;
  let triggerPhrase: string;
  if (signal === "order_won" && role !== "owner") {
    shortReason = [`Won ${ownerShort ? `${ownerShort} ` : ""}${word} order`, money?.local, when].filter(Boolean).join(" · ");
    const due = deliveryMonthsText ? `, to deliver within ${deliveryMonthsText} months` : deliveryDate ? `, to deliver by ${monthYearOf(deliveryDate)}` : "";
    longReason = `${shortName} won a ${money?.full ? `${money.full} ` : ""}${word} order${ownerShort ? ` from ${displayOwner(input.owner!.canonical_name)}` : ""}${due}. To make and deliver it, they must buy materials, consumables and services in the next few weeks.`;
    triggerPhrase = `its ${money?.local ? `${money.local} ` : ""}${word} order${ownerShort ? ` from ${ownerShort}` : ""}`;
  } else if (signal === "contract_won") {
    const what = projectName ?? "a new contract";
    shortReason = [`Won ${ownerShort && !what.includes(ownerShort) ? `${ownerShort} ` : ""}${what}${/contract/i.test(what) ? "" : " contract"}`, money?.local, when].filter(Boolean).join(" · ");
    longReason = `${shortName} won ${ownerShort ? `${ownerShort}'s ` : ""}${what}${/contract/i.test(what) ? "" : " contract"}${money?.full ? ` (${money.full})` : ""}${when ? ` in ${when}` : ""}. ${role === "subcontractor" ? "They now buy the materials for their package." : "They now order long-lead materials and award subcontracts."}`;
    triggerPhrase = `the ${what}${/contract/i.test(what) ? "" : " contract"}`;
  } else if (signal === "tender_open") {
    const what = projectName ?? "a new tender";
    shortReason = `Tender open: ${what}${lead.closing_date ? ` · closes ${monthYearOf(lead.closing_date)}` : ""}`;
    longReason = `${shortName} has an open tender for ${what}${lead.closing_date ? `, closing ${dayOnly(lead.closing_date)}` : ""}. The winning bidder, or ${shortName} itself, buys the materials.`;
    triggerPhrase = `the ${what} tender`;
  } else {
    const first = reasons.find((r) => !/^Needs research|^Rejected/i.test(r.text))?.text ?? leadSignals[0]?.summary ?? projectName ?? "a new project";
    shortReason = first.replace(/^Watching:\s*/i, "");
    longReason = shortReason.endsWith(".") ? shortReason : `${shortReason}.`;
    triggerPhrase = projectName ? `the ${projectName}` : "this project";
  }
  shortReason = plainWords(shortReason);
  longReason = plainWords(longReason);
  triggerPhrase = plainWords(triggerPhrase);
  const buyingReasonEvidenceIds = [...new Set([...leadSignals.flatMap((s) => s.evidence_ids ?? []), ...(reasons[0]?.evidenceIds ?? [])])].filter((id) => input.evidence[id]);

  // ── what they do (15 §A) ──
  const typeKey = supplierTypeKeyFor(role, situation, { ...situationFacts, name, types: buyer.types ?? [], sector: project?.sector ?? null });
  const whatTheyDo = whatTheyDoLabel(typeKey, role === "owner" && openTender);
  const consultant = isConsultant(name, buyer.types ?? []);
  const placeName = isPlaceName(name);

  // ── headline (14 §1) ──
  const country = countryName(hq ?? siteCountry);
  const top = sellable.slice(0, 3).map((i) => shortItemName(i.itemId));
  const step = currentStep(window);
  const windowWords = (step?.from ? monthRange(step.from, step.to) : null) ?? "the coming months";
  const who = `${shortName} (${whatTheyDo}${country ? `, ${country}` : ""})`;
  const headline = consultant
    ? `${who} is not a buyer: ${CONSULTANT_REASON.toLowerCase()}.`
    : competitorForAll
    ? `${who} is not a buyer: competitor for all your products.`
    : top.length
      ? `${who} will likely buy ${joinAnd(top)} in ${windowWords} for ${triggerPhrase}.${whyYou.length ? ` Why you: ${whyYou.slice(0, 2).map((w) => w.reason).join("; ")}.` : ""}`
      : `${who}: what they will buy is not known yet.`;

  // ── proof ──
  const proofIds = [...new Set([...buyingReasonEvidenceIds, ...buyerEvidence, ...reasons.flatMap((r) => r.evidenceIds ?? []), ...input.people.flatMap((p) => p.evidenceIds)])].filter((id) => input.evidence[id]);
  const seenSentences = new Set<string>();
  const proof: ProofItem[] = [];
  for (const id of proofIds) {
    const ev = input.evidence[id];
    const text = (ev.sentence ?? ev.quote).trim();
    if (!text || seenSentences.has(text)) continue;
    seenSentences.add(text);
    proof.push({ evidenceId: id, sentence: text, highlight: ev.quote.trim(), source: ev.source, date: ev.publishedAt ? ev.publishedAt.slice(0, 10) : null, url: ev.url, verified: ev.verified });
  }
  proof.sort((a, b) => Number(b.verified) - Number(a.verified) || (b.date ?? "").localeCompare(a.date ?? ""));

  const stage: BuyerStage = competitorForAll || consultant || placeName ? "not_buyer" : stageFromClass(lead.class);
  const tier = (lead.chain_tier === 2 || lead.chain_tier === 3 ? lead.chain_tier : 1) as ChainTier;
  const foundVia = lead.found_via_lead_id ? { leadId: lead.found_via_lead_id, name: input.foundViaName ?? "another buyer" } : null;
  const valueUsd = buyerParty?.value_usd ?? project?.value_usd ?? null;
  const sourceCount = new Set(proof.map((p) => p.url ?? p.source)).size;
  const deal: BuyerDeal = { leadId: lead.id, title: shortReason, date: triggerDate, valueUsd, sourceCount };
  const reasonText = placeName ? `${PLACE_NAME_REASON}.` : consultant ? `${CONSULTANT_REASON}.` : competitorForAll ? `${longReason} Competitor for all your products.` : longReason;
  // The role label already says "· open tender" for an owner's open tender; the sub-role stays short.
  void subRoleLabelFor;
  void roleLabel;
  const subRoleLabel = whatTheyDo;
  const view: BuyerView = {
    leadId: lead.id,
    companyId: buyer.id,
    name,
    shortName,
    role,
    roleLabel: whatTheyDo,
    subRoleLabel,
    country: hq,
    city: project?.site ?? null,
    stage,
    fitScore: Math.max(0, Math.min(100, Math.round(lead.score ?? 0))),
    howSure: lead.confidence_band ?? "low",
    headline,
    buyingReason: reasonText,
    buyingReasonEvidenceIds,
    triggerDate,
    sellItems,
    competitorFor: [...competitors.keys()],
    window,
    whyYou,
    team,
    found,
    total,
    chain,
    reach,
    proof: proof.slice(0, 10),
    status: lead.status,
    isSample: lead.is_sample,
    updatedAt: lead.updated_at ?? lead.created_at,
    whatTheyDo,
    tier,
    foundVia,
    deals: [deal],
    chainSummary: { tier2: 0, tier3: 0, peopleTotal: total, peopleFound: found },
  };
  const row: BuyerRow = {
    leadId: lead.id,
    name,
    subRoleLabel: view.subRoleLabel,
    role,
    roleLabel: view.roleLabel,
    buyingReason: placeName ? PLACE_NAME_REASON : consultant ? CONSULTANT_REASON : competitorForAll ? "Competitor for all your products" : shortReason,
    sellSummary: role === "owner" && !openTender && !sellable.some((i) => i.fit === "good") ? "Get on their approved vendor list" : sellSummary(sellItems),
    competitorNote: competitorNote(sellItems, role),
    country: view.country,
    fitScore: view.fitScore,
    howSure: view.howSure,
    stage,
    found,
    total,
    isSample: lead.is_sample,
    triggerDate,
    whatTheyDo,
    tier,
    foundVia,
    dealsCount: 1,
    derivedKey: null,
    storedLeadId: lead.id,
    link: tier === 1 ? null : "confirmed",
  };
  const slotDepartments = Object.fromEntries(slotDefs(role).map((d) => [d.slotId, d.department]));
  return {
    view,
    row,
    hqCountry: hq,
    siteCountry,
    site: project?.site ?? null,
    sector: project?.sector ?? null,
    valueUsd,
    signals: signalKinds,
    createdAt: lead.created_at,
    slotDepartments,
    leadStatus: lead.status,
    competitorForAll,
    typeKey,
    groupKey: companyGroupKey(buyer.id, name),
    projectId: project?.id ?? null,
    projectType,
    consultant,
    sourceCount,
  };
}

/** Slot roles present in a team (for facets). */
export function slotRolesOf(view: Pick<BuyerView, "team">): SlotRole[] {
  return [...new Set(view.team.map((s) => s.role))];
}

/** Today in ISO (exported for tests that pin `now`). */
export function isoToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}
