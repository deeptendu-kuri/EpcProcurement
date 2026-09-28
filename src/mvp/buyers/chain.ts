/**
 * "Other buyers on this project" (docs/mvp/14 §8): the chain around a buyer — project owner, EPC
 * contractor(s), subcontractors, manufacturers and the parent group — each with its role, whether it
 * is identified, and its own "X of Y found". Companies not named in any source are shown as
 * "not identified yet" so the user knows whom to research. Pure.
 */
import type { BuyerRole, ChainCompany } from "./types";
import type { Situation } from "./roles";

export interface ChainParty {
  companyId: string;
  name: string;
  /** project_parties.role */
  partyRole: string;
  scope?: string | null;
}

export interface ChainInput {
  buyerId: string;
  buyerRole: BuyerRole;
  situation: Situation;
  owner: { companyId: string; name: string } | null;
  parties: readonly ChainParty[];
  parent: { companyId: string | null; name: string } | null;
  /** companyId → { found, total } of its buying team (people named in sources vs slots). */
  teamCounts: (companyId: string, role: BuyerRole) => { found: number; total: number };
  projectType?: string | null;
}

const PARTY_BUYER_ROLE: Record<string, BuyerRole | "pmc" | undefined> = {
  owner: "owner",
  main_epc: "epc_contractor",
  consortium_member: "epc_contractor",
  subcontractor: "subcontractor",
  supplier: "manufacturer",
  pmc: "pmc",
  consultant: "pmc",
};

function contractorWord(projectType: string | null | undefined): string {
  if (projectType === "pipeline") return "Pipeline contractor";
  if (projectType === "water") return "Water network contractor";
  if (projectType === "plant") return "Plant EPC contractor";
  return "EPC contractor";
}

/** The chain around the buyer (the buyer itself is left out). */
export function buildChain(input: ChainInput): ChainCompany[] {
  const out: ChainCompany[] = [];
  const seen = new Set<string>([input.buyerId]);
  const push = (entry: ChainCompany) => {
    if (entry.companyId) {
      if (seen.has(entry.companyId)) return;
      seen.add(entry.companyId);
    }
    out.push(entry);
  };
  const identified = (companyId: string, name: string, role: ChainCompany["role"], note: string): ChainCompany => {
    const counts = role === "pmc" || role === "parent_group" ? input.teamCounts(companyId, "owner") : input.teamCounts(companyId, role);
    return { companyId, name, role, identified: true, found: counts.found, total: counts.total, note };
  };
  const missing = (name: string, role: ChainCompany["role"], note = "not identified yet"): ChainCompany => ({
    companyId: null, name, role, identified: false, found: 0, total: 0, note,
  });

  // Owner
  if (input.owner && input.owner.companyId !== input.buyerId) {
    push(identified(input.owner.companyId, input.owner.name, "owner", "approved vendor list, project team"));
  } else if (!input.owner && input.buyerRole !== "owner") {
    push(missing("Project owner", "owner"));
  }

  // EPC contractors
  const epcs = input.parties.filter((p) => PARTY_BUYER_ROLE[p.partyRole] === "epc_contractor" && p.companyId !== input.buyerId);
  for (const p of epcs) push(identified(p.companyId, p.name, "epc_contractor", p.scope ? `EPC contractor — ${p.scope}` : "main contractor, buys materials and subcontracts packages"));
  if (!epcs.length && input.buyerRole !== "epc_contractor" && !input.parties.some((p) => p.companyId === input.buyerId && PARTY_BUYER_ROLE[p.partyRole] === "epc_contractor")) {
    push(missing(contractorWord(input.projectType ?? (input.situation === "pipe_mill" ? "pipeline" : null)), "epc_contractor"));
  }

  // PMC / consultants
  for (const p of input.parties.filter((x) => PARTY_BUYER_ROLE[x.partyRole] === "pmc")) push(identified(p.companyId, p.name, "pmc", "project management consultant, influences vendor choice"));

  // Subcontractors
  const subs = input.parties.filter((p) => p.partyRole === "subcontractor" && p.companyId !== input.buyerId);
  for (const p of subs) push(identified(p.companyId, p.name, "subcontractor", p.scope ? `subcontractor — ${p.scope}` : "subcontractor, buys for its package"));
  if (!subs.length) {
    if (input.buyerRole === "manufacturer" && input.situation === "pipe_mill") push(missing("Coating / testing subcontractors", "subcontractor"));
    else if (input.buyerRole === "epc_contractor" || input.buyerRole === "owner") push(missing(input.projectType === "pipeline" ? "Piping / pipeline subcontractors" : "Piping / mechanical subcontractors", "subcontractor"));
  }

  // Manufacturers / suppliers on the project
  for (const p of input.parties.filter((x) => x.partyRole === "supplier" && x.companyId !== input.buyerId))
    push(identified(p.companyId, p.name, "manufacturer", "won a supply order, buys raw materials and consumables"));

  // Parent group
  if (input.parent) {
    const counts = input.parent.companyId ? input.teamCounts(input.parent.companyId, "manufacturer") : { found: 0, total: 3 };
    const entry: ChainCompany = {
      companyId: input.parent.companyId,
      name: input.parent.name,
      role: "parent_group",
      identified: true,
      found: counts.found,
      total: counts.total,
      note: "parent group, central buying",
    };
    if (!entry.companyId || !seen.has(entry.companyId)) {
      if (entry.companyId) seen.add(entry.companyId);
      out.push(entry);
    }
  }
  return out;
}
