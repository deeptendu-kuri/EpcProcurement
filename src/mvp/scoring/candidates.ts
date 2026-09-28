/**
 * Candidate builder (docs/mvp/07 §1, §6): a candidate is (kind, buyer, project, package).
 *
 * - Bid: bid-type signals (tender/prequal/vendor registration/capex/FEED) → the tendering
 *   authority (signal company) on the signal's project/package.
 * - Supply / subcontract: award, order, approved-vendor and hiring signals → the company that
 *   owns the package, usually the main EPC or a subcontractor. Without a package on the signal,
 *   one candidate per package of the project that the buyer owns or that has no owner yet.
 * - Predictive (07 §6): on `contract_awarded` for contractor X, one supply candidate per discipline
 *   in typical_subcontracted(X) ∩ client disciplines, on a package created with status 'planned'
 *   whose evidence is the award plus the history edges.
 */
import type { Queryable } from "@/mvp/db";
import type { CompanyInsights, Discipline, LeadKind, PackageRow, SignalRow } from "@/mvp/types";
import { getClientProfile } from "@/mvp/config/profile";
import { BID_SIGNALS, SUPPLY_SIGNALS } from "./config";
import type { Candidate } from "./context";
import type { InsightsCache } from "./loader";
import { getCompanyInsights } from "./graph";
import { unique } from "./util";

export function candidateKey(c: Pick<Candidate, "kind" | "buyerId" | "projectId" | "packageId">): string {
  return `${c.kind}|${c.buyerId}|${c.projectId ?? ""}|${c.packageId ?? ""}`;
}

/** Merge candidates sharing a key (signal ids are unioned). */
export function mergeCandidates(list: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const c of list) {
    const key = candidateKey(c);
    const existing = map.get(key);
    if (existing) {
      existing.signalIds = unique([...existing.signalIds, ...c.signalIds]);
      existing.predicted = Boolean(existing.predicted && c.predicted);
    } else map.set(key, { ...c, signalIds: [...c.signalIds] });
  }
  return [...map.values()];
}

const DISCIPLINE_LABEL = (d: Discipline) => d.replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase());

/** Create (or reuse) a planned package for a predicted discipline, with provenance. */
async function ensurePredictedPackage(
  db: Queryable,
  projectId: string,
  discipline: Discipline,
  evidenceIds: string[],
): Promise<string> {
  const existing = await db.query<{ id: string }>(
    "select id from packages where project_id = $1 and discipline = $2 order by created_at limit 1",
    [projectId, discipline],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows } = await db.query<{ id: string }>(
    `insert into packages (project_id, discipline, name, scope_text, procurement_route, status)
     values ($1, $2, $3, $4, 'unknown', 'planned') returning id`,
    [
      projectId,
      discipline,
      `${DISCIPLINE_LABEL(discipline)} package (predicted)`,
      "Predicted from the contractor's history: it has subcontracted this discipline on 2 or more recent projects.",
    ],
  );
  const id = rows[0].id;
  for (const evidenceId of unique(evidenceIds))
    await db.query(
      "insert into fact_evidence (entity_type, entity_id, field, evidence_id) values ('package', $1, 'prediction', $2) on conflict do nothing",
      [id, evidenceId],
    );
  return id;
}

/** Evidence of X's subcontracted_to edges in a discipline (the "history edges"). */
async function historyEvidence(db: Queryable, companyId: string, discipline: Discipline): Promise<string[]> {
  const { rows } = await db.query<{ evidence_id: string }>(
    `select fe.evidence_id from relationships r
       join fact_evidence fe on fe.entity_type = 'relationship' and fe.entity_id = r.id
      where r.from_company_id = $1 and r.type = 'subcontracted_to' and r.discipline = $2`,
    [companyId, discipline],
  );
  return rows.map((r) => r.evidence_id);
}

export async function buildCandidates(
  db: Queryable,
  signals: SignalRow[],
  options: { kinds: LeadKind[]; now: Date; insightsCache: InsightsCache },
): Promise<Candidate[]> {
  const profile = getClientProfile();
  const kinds = new Set(options.kinds);
  const out: Candidate[] = [];
  const packagesByProject = new Map<string, PackageRow[]>();
  const projectPackages = async (projectId: string) => {
    if (!packagesByProject.has(projectId))
      packagesByProject.set(projectId, (await db.query<PackageRow>("select * from packages where project_id = $1", [projectId])).rows);
    return packagesByProject.get(projectId)!;
  };
  const insightsFor = (companyId: string): Promise<CompanyInsights> => {
    if (!options.insightsCache.has(companyId)) options.insightsCache.set(companyId, getCompanyInsights(companyId, db, options.now));
    return options.insightsCache.get(companyId)!;
  };

  const supplierRoles = new Map<string, boolean>();
  const supplierOn = async (companyId: string, projectId: string | null): Promise<boolean> => {
    if (!projectId) return false;
    const key = `${companyId}|${projectId}`;
    if (!supplierRoles.has(key)) {
      const { rows } = await db.query<{ role: string }>("select role from project_parties where project_id = $1 and company_id = $2", [projectId, companyId]);
      const roles = rows.map((r) => r.role);
      supplierRoles.set(key, roles.includes("supplier") && !roles.some((r) => r === "main_epc" || r === "consortium_member" || r === "subcontractor"));
    }
    return supplierRoles.get(key)!;
  };

  for (const s of signals) {
    if (!s.company_id) continue;
    if (BID_SIGNALS.includes(s.type) && kinds.has("bid")) {
      out.push({ kind: "bid", buyerId: s.company_id, projectId: s.project_id, packageId: s.package_id, signalIds: [s.id] });
    }
    if (!SUPPLY_SIGNALS.includes(s.type) || !kinds.has("supply_subcontract")) continue;

    // A supplier that won an order (13 §11): one lead on the order itself — the client sells it inputs
    // and services; the order's packages belong to its buyer, and it has no subcontracting history.
    if (s.type === "contract_awarded" && (await supplierOn(s.company_id, s.project_id))) {
      out.push({ kind: "supply_subcontract", buyerId: s.company_id, projectId: s.project_id, packageId: null, signalIds: [s.id] });
      continue;
    }

    if (s.package_id || !s.project_id) {
      out.push({ kind: "supply_subcontract", buyerId: s.company_id, projectId: s.project_id, packageId: s.package_id, signalIds: [s.id] });
    } else {
      const packages = (await projectPackages(s.project_id)).filter(
        (p) => p.package_owner_company_id === s.company_id || p.package_owner_company_id === null,
      );
      if (packages.length)
        for (const p of packages)
          out.push({ kind: "supply_subcontract", buyerId: s.company_id, projectId: s.project_id, packageId: p.id, signalIds: [s.id] });
      else if (!(await projectPackages(s.project_id)).length && s.type !== "contract_awarded")
        out.push({ kind: "supply_subcontract", buyerId: s.company_id, projectId: s.project_id, packageId: null, signalIds: [s.id] });
    }

    // Predictive supply leads from typical subcontracted packages (07 §6).
    if (s.type === "contract_awarded" && s.project_id) {
      const insights = await insightsFor(s.company_id);
      const disciplines = insights.typicalSubcontracted.filter((d) => profile.disciplines.includes(d));
      const existing = await projectPackages(s.project_id);
      for (const discipline of disciplines) {
        if (existing.some((p) => p.discipline === discipline)) continue; // covered by the package loop above
        const packageId = await ensurePredictedPackage(db, s.project_id, discipline, [
          ...(s.evidence_ids ?? []),
          ...(await historyEvidence(db, s.company_id, discipline)),
        ]);
        packagesByProject.delete(s.project_id);
        out.push({ kind: "supply_subcontract", buyerId: s.company_id, projectId: s.project_id, packageId, signalIds: [s.id], predicted: true });
      }
      // An award with no package and no prediction still becomes an (auditable) candidate.
      if (!disciplines.length && !existing.length)
        out.push({ kind: "supply_subcontract", buyerId: s.company_id, projectId: s.project_id, packageId: null, signalIds: [s.id] });
    }
  }
  return mergeCandidates(out);
}
