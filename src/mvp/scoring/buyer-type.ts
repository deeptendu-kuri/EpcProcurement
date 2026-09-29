/**
 * Buyer role of a lead (docs/mvp/14 §2, was 13 §11 buyer type): who the lead is about.
 *
 * - owner          — the project owner or tendering authority.
 * - epc_contractor — the main EPC contractor or a consortium member.
 * - subcontractor  — a company that won a subcontract.
 * - manufacturer / fabricator / distributor — a company that won a supply order (the old
 *   `supplier`). It buys raw materials, consumables and resale stock to deliver it, so it is a buyer
 *   too. Which of the three comes from the text / name / company types (buyers/roles.ts).
 *
 * The role never changes the gates or the score (07); it labels the lead and adds its first reason.
 */
import type { BuyerType, PartyRole, Reason } from "@/mvp/types";
import { supplierRoleFor } from "@/mvp/buyers/roles";
import { buyerParties, type ScoringContext } from "./context";
import { awardDate } from "./gates";
import { formatDay, unique } from "./util";

/** Roles of a company that won a supply order (14 §2). */
export const SUPPLY_ROLES: readonly BuyerType[] = ["manufacturer", "fabricator", "distributor"];

/** True for manufacturer / fabricator / distributor (and the legacy `supplier`). */
export function isSupplyRole(type: BuyerType | null | undefined): boolean {
  return type === "supplier" || (type !== null && type !== undefined && SUPPLY_ROLES.includes(type));
}

type RoleCtx = Pick<ScoringContext, "kind" | "buyer" | "project" | "parties" | "triggerSignals"> & Partial<Pick<ScoringContext, "packages" | "leadPackage">>;

/** Text that says what a supplying company does: its party scope, package names and trigger summaries. */
function supplierText(ctx: RoleCtx): string {
  const parties = buyerParties(ctx as ScoringContext);
  return [
    ...parties.map((p) => p.scope_text ?? ""),
    ...(ctx.leadPackage ? [ctx.leadPackage] : (ctx.packages ?? [])).flatMap((p) => [p.name, p.scope_text ?? ""]),
    ...ctx.triggerSignals.map((s) => s.summary),
  ].join(" ");
}

function supplyRole(ctx: RoleCtx): BuyerType {
  return supplierRoleFor(ctx.buyer.canonical_name, ctx.buyer.types ?? [], supplierText(ctx));
}

/** Pure: the buyer role from the buyer's roles on the project, its trigger signals and company types. */
export function buyerTypeFor(ctx: RoleCtx): BuyerType {
  const roles = buyerParties(ctx as ScoringContext).map((p) => p.role);
  // The role behind the trigger: an award to a supplier is a supply order; a subcontract signal is a subcontract.
  if (ctx.triggerSignals.some((s) => s.type === "subcontract_awarded") && roles.includes("subcontractor")) return "subcontractor";
  if (ctx.triggerSignals.some((s) => s.type === "contract_awarded")) {
    if (roles.includes("main_epc") || roles.includes("consortium_member")) return "epc_contractor";
    if (roles.includes("supplier")) return supplyRole(ctx);
  }
  if (ctx.project?.owner_company_id === ctx.buyer.id || roles.includes("owner")) return "owner";
  if (roles.includes("subcontractor")) return "subcontractor";
  if (roles.includes("main_epc") || roles.includes("consortium_member")) return "epc_contractor";
  if (roles.includes("supplier")) return supplyRole(ctx);
  // Buyer of a tender or of a supply order it placed.
  const types = ctx.buyer.types ?? [];
  if (ctx.kind === "bid" || ctx.triggerSignals.some((s) => s.type === "supply_order_announced")) {
    if (types.includes("main_epc")) return "epc_contractor";
    if (types.includes("subcontractor")) return "subcontractor";
    return "owner";
  }
  if (types.includes("manufacturer") || types.includes("fabricator") || types.includes("stockist_trader")) return supplyRole(ctx);
  if (types.includes("subcontractor")) return "subcontractor";
  if (types.includes("owner")) return "owner";
  return "epc_contractor";
}

/** Party role → buyer role word, kept for callers that label parties. */
export const PARTY_ROLE_BUYER: Partial<Record<PartyRole, BuyerType>> = {
  main_epc: "epc_contractor",
  consortium_member: "epc_contractor",
  subcontractor: "subcontractor",
  owner: "owner",
};

const CURRENCY_FMT = (amount: number, currency: string): string => {
  const units: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, suffix] of units) if (amount >= size) return `${currency} ${Number((amount / size).toFixed(amount / size >= 100 ? 0 : 1))}${suffix}`;
  return `${currency} ${amount}`;
};

/** "Steel Pipes" → "steel pipe", "HFIW pipes" → "HFIW pipe" (acronyms kept). */
function itemLabel(item: string): string {
  return item
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (/^[A-Z0-9-]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(" ")
    .replace(/\b(pipe|valve|tube|fitting|flange)s\b/g, "$1");
}

/** "a" or "an" before a label. */
function articleFor(label: string): string {
  return /^(?:[aeiou]|[AEFHILMNORSX][A-Z0-9-]*\b)/.test(label) ? "an" : "a";
}

/** First reason of a supplier lead: what it won, from whom, when — and why that makes it a buyer. */
export function supplierReason(ctx: ScoringContext): Reason | null {
  const party = buyerParties(ctx).find((p) => p.role === "supplier");
  if (!party) return null;
  const value = party.contract_value && party.currency ? ` worth ${CURRENCY_FMT(Number(party.contract_value), party.currency)}` : "";
  const clientRow = ctx.orderClient ?? (ctx.projectOwner && ctx.projectOwner.id !== ctx.buyer.id ? ctx.projectOwner : null);
  const client = clientRow ? ` from ${clientRow.canonical_name.replace(/\s*\(.*\)$/, "")}` : "";
  const item = ctx.leadPackage?.name ?? ctx.packages.find((p) => p.discipline === "pipeline" || p.discipline === "piping")?.name ?? ctx.packages[0]?.name ?? "supply";
  const date = awardDate(ctx);
  const evidenceIds = unique(ctx.triggerSignals.flatMap((s) => s.evidence_ids ?? [])).filter((id) => ctx.evidence[id]);
  return {
    text: `Won ${articleFor(itemLabel(item))} ${itemLabel(item)} order${client}${value}${date ? ` (${formatDay(date)})` : ""} — they buy materials, consumables and services to deliver it`,
    evidenceIds,
  };
}

/** Research task (and first reason) of an owner that ordered materials while its EPC contractor is not known yet. */
export const IDENTIFY_EPC_TASK = "Identify the contractor who will build it";

/** True when an owner placed a supply order but no EPC contractor is known on the project. */
export function ownerOrderWithoutEpc(ctx: ScoringContext, buyerType: BuyerType): boolean {
  if (buyerType !== "owner" || ctx.kind !== "supply_subcontract") return false;
  const ordered = ctx.triggerSignals.some((s) => s.type === "supply_order_announced") || ctx.parties.some((p) => p.role === "supplier");
  const hasEpc = ctx.parties.some((p) => p.role === "main_epc" || p.role === "consortium_member");
  return ordered && !hasEpc;
}

/** First reason of such an owner lead. */
export function ownerOrderReason(ctx: ScoringContext): Reason {
  const supplier = ctx.parties.find((p) => p.role === "supplier");
  const evidenceIds = unique([
    ...ctx.triggerSignals.flatMap((s) => s.evidence_ids ?? []),
    ...(supplier ? (ctx.factEvidence[`project_party:${supplier.id}`] ?? []) : []),
  ]).filter((id) => ctx.evidence[id]);
  return {
    text: `Watching: ${ctx.buyer.canonical_name.replace(/\s*\(.*\)$/, "")} ordered materials for this work — identify the contractor who will build it`,
    evidenceIds,
  };
}
