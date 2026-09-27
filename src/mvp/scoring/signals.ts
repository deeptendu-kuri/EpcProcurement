/**
 * Signals (docs/mvp/07 §2): facts → typed events, one per real-world event.
 *
 *   fingerprint = sha1(type | buyer_company_id | project_id | package_id | tender_ref | yyyy-mm of signal_date)
 *
 * A second source reporting the same event adds its evidence to the existing signal (idempotent
 * upsert); it never creates a second signal.
 */
import { createHash } from "node:crypto";
import type { Queryable } from "@/mvp/db";
import type { PartyRole, ProjectStage, SignalRow, SignalType } from "@/mvp/types";
import { daysBetween, formatDay, isoDay, readHiring, readTenders, unique, yearMonth } from "./util";

export interface SignalDraft {
  type: SignalType;
  signalDate: string;
  companyId: string | null;
  projectId: string | null;
  packageId: string | null;
  tenderRef: string | null;
  summary: string;
  evidenceIds: string[];
}

export function signalFingerprint(d: Pick<SignalDraft, "type" | "companyId" | "projectId" | "packageId" | "tenderRef" | "signalDate">): string {
  const parts = [d.type, d.companyId ?? "", d.projectId ?? "", d.packageId ?? "", d.tenderRef ?? "", yearMonth(d.signalDate)];
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

// ───────────────────────── facts snapshot (pure input) ─────────────────────────

export interface FactsSnapshot {
  projects: {
    id: string;
    name: string;
    owner_company_id: string | null;
    specs: Record<string, unknown>;
  }[];
  parties: {
    id: string;
    project_id: string;
    company_id: string;
    company_name: string;
    role: PartyRole;
    package_id: string | null;
    award_date: string | null;
  }[];
  supplyEdges: {
    id: string;
    from_company_id: string;
    to_company_id: string;
    to_name: string;
    project_id: string | null;
    package_id: string | null;
    event_date: string | null;
  }[];
  approvedVendorEdges: { id: string; from_company_id: string; to_company_id: string; project_id: string | null; package_id: string | null; event_date: string | null }[];
  stageEvents: { id: string; project_id: string; stage: ProjectStage; event_date: string | null; evidence_id: string | null }[];
  /** `${entity_type}:${id}` → evidence ids with their best date. */
  evidence: Record<string, { id: string; date: string }[]>;
  companyNames: Record<string, string>;
}

const ev = (s: FactsSnapshot, type: string, id: string) => s.evidence[`${type}:${id}`] ?? [];
const earliest = (items: { date: string }[]) => items.map((i) => i.date.slice(0, 10)).sort()[0] ?? null;

/** Pure: build signal drafts from a facts snapshot (07 §2 rules table). */
export function signalsFromFacts(snap: FactsSnapshot, now: Date): SignalDraft[] {
  const today = isoDay(now);
  const out: SignalDraft[] = [];
  const projectName = new Map(snap.projects.map((p) => [p.id, p.name]));
  const name = (id: string | null) => (id ? snap.companyNames[id] ?? "Unknown company" : "Unknown buyer");

  // Parties: main EPC / consortium with award date → contract_awarded; subcontractor → subcontract_awarded.
  for (const party of snap.parties) {
    const items = ev(snap, "project_party", party.id);
    const ids = items.map((i) => i.id);
    const project = projectName.get(party.project_id) ?? "project";
    if ((party.role === "main_epc" || party.role === "consortium_member") && party.award_date) {
      out.push({
        type: "contract_awarded",
        signalDate: party.award_date,
        companyId: party.company_id,
        projectId: party.project_id,
        packageId: party.package_id,
        tenderRef: null,
        summary: `${party.company_name} awarded ${party.role === "main_epc" ? "EPC contract" : "contract (consortium)"} for ${project} (${formatDay(party.award_date)})`,
        evidenceIds: ids,
      });
    } else if (party.role === "subcontractor") {
      const date = party.award_date ?? earliest(items) ?? today;
      out.push({
        type: "subcontract_awarded",
        signalDate: date,
        companyId: party.company_id,
        projectId: party.project_id,
        packageId: party.package_id,
        tenderRef: null,
        summary: `${party.company_name} subcontracted on ${project} (${formatDay(date)})`,
        evidenceIds: ids,
      });
    }
  }

  // supplied_by edges with a date → supply_order_announced (buyer = from company).
  for (const edge of snap.supplyEdges) {
    if (!edge.event_date) continue;
    out.push({
      type: "supply_order_announced",
      signalDate: edge.event_date,
      companyId: edge.from_company_id,
      projectId: edge.project_id,
      packageId: edge.package_id,
      tenderRef: null,
      summary: `${name(edge.from_company_id)} ordered from ${edge.to_name}${edge.project_id ? ` for ${projectName.get(edge.project_id) ?? "a project"}` : ""} (${formatDay(edge.event_date)})`,
      evidenceIds: ev(snap, "relationship", edge.id).map((i) => i.id),
    });
  }

  // approved_vendor_of edges → approved_vendor_listed (buyer = the company whose list it is).
  for (const edge of snap.approvedVendorEdges) {
    const items = ev(snap, "relationship", edge.id);
    const date = edge.event_date ?? earliest(items) ?? today;
    out.push({
      type: "approved_vendor_listed",
      signalDate: date,
      companyId: edge.to_company_id,
      projectId: edge.project_id,
      packageId: edge.package_id,
      tenderRef: null,
      summary: `${name(edge.to_company_id)} lists ${name(edge.from_company_id)} as an approved vendor`,
      evidenceIds: items.map((i) => i.id),
    });
  }

  // Stage events: feed → feed_awarded; prequalification / epc_tender → prequalification_opened / tender_released
  // (the latter only when the project has no tender spec, which is more precise).
  for (const event of snap.stageEvents) {
    const project = snap.projects.find((p) => p.id === event.project_id);
    if (!project) continue;
    const items = [...ev(snap, "project_stage_event", event.id)];
    const ids = unique([...(event.evidence_id ? [event.evidence_id] : []), ...items.map((i) => i.id)]);
    const date = event.event_date ?? earliest(items) ?? today;
    const hasTender = readTenders(project.specs).length > 0;
    const type: SignalType | null =
      event.stage === "feed" ? "feed_awarded" : event.stage === "prequalification" && !hasTender ? "prequalification_opened" : event.stage === "epc_tender" && !hasTender ? "tender_released" : null;
    if (!type) continue;
    out.push({
      type,
      signalDate: date,
      companyId: project.owner_company_id,
      projectId: project.id,
      packageId: null,
      tenderRef: null,
      summary: `${project.name}: ${type === "feed_awarded" ? "FEED stage reached" : type === "prequalification_opened" ? "prequalification opened" : "EPC tender released"} (${formatDay(date)})`,
      evidenceIds: ids,
    });
  }

  // Tenders (projects.specs.tenders) and job posts (projects.specs.hiring).
  for (const project of snap.projects) {
    for (const tender of readTenders(project.specs)) {
      const buyer = tender.buyerCompanyId ?? project.owner_company_id;
      const issue = tender.issueDate ?? today;
      const closing = tender.closingDate;
      const open = tender.status !== "closed" && tender.status !== "awarded" && tender.status !== "cancelled" && (!closing || daysBetween(now, closing) >= 0);
      const label = tender.ref ? ` ${tender.ref}` : "";
      if (open) {
        const type: SignalType =
          tender.route === "prequal" ? "prequalification_opened" : tender.route === "vendor_registration" ? "vendor_registration_opened" : "tender_released";
        out.push({
          type,
          signalDate: issue,
          companyId: buyer,
          projectId: project.id,
          packageId: tender.packageId,
          tenderRef: tender.ref,
          summary: `${type === "tender_released" ? "Tender" : type === "prequalification_opened" ? "Prequalification" : "Vendor registration"}${label} opened for ${project.name}${closing ? `, closes ${formatDay(closing)}` : ""}`,
          evidenceIds: tender.evidenceIds,
        });
        if (closing) {
          const days = daysBetween(now, closing);
          if (days >= 5 && days <= 21)
            out.push({
              type: "tender_closing_soon",
              signalDate: today,
              companyId: buyer,
              projectId: project.id,
              packageId: tender.packageId,
              tenderRef: tender.ref,
              summary: `Tender${label} for ${project.name} closes in ${days} days (${formatDay(closing)})`,
              evidenceIds: tender.evidenceIds,
            });
        }
      }
      if (tender.approvedVendors.length)
        out.push({
          type: "approved_vendor_listed",
          signalDate: issue,
          companyId: buyer,
          projectId: project.id,
          packageId: tender.packageId,
          tenderRef: tender.ref,
          summary: `Approved vendor list in tender${label}: ${tender.approvedVendors.slice(0, 4).join(", ")}${tender.approvedVendors.length > 4 ? "…" : ""}`,
          evidenceIds: tender.evidenceIds,
        });
    }
    for (const job of readHiring(project.specs)) {
      const date = job.date ?? today;
      out.push({
        type: "hiring_project_roles",
        signalDate: date,
        companyId: job.companyId,
        projectId: project.id,
        packageId: null,
        tenderRef: null,
        summary: `${name(job.companyId)} hiring${job.title ? ` ${job.title}` : ""} for ${project.name}`,
        evidenceIds: job.evidenceIds,
      });
    }
  }
  return out;
}

// ───────────────────────── DB: load snapshot and upsert ─────────────────────────

async function loadEvidence(db: Queryable, entityType: string, ids: string[], into: FactsSnapshot["evidence"]): Promise<void> {
  if (!ids.length) return;
  const { rows } = await db.query<{ entity_id: string; evidence_id: string; date: string }>(
    `select fe.entity_id, fe.evidence_id, coalesce(d.published_at, e.observed_at) as date
       from fact_evidence fe join evidence e on e.id = fe.evidence_id
       left join source_documents d on d.id = e.document_id
      where fe.entity_type = $1 and fe.entity_id = any($2::uuid[])`,
    [entityType, ids],
  );
  for (const row of rows) {
    const key = `${entityType}:${row.entity_id}`;
    const list = (into[key] ??= []);
    if (!list.some((item) => item.id === row.evidence_id)) list.push({ id: row.evidence_id, date: row.date });
  }
}

/** Load the facts behind signals for the given projects (null = every project). */
export async function loadFactsSnapshot(db: Queryable, projectIds: string[] | null): Promise<FactsSnapshot> {
  const scope = projectIds === null ? "true" : "project_id = any($1::uuid[])";
  const params = projectIds === null ? [] : [projectIds];
  const projects = (
    await db.query<FactsSnapshot["projects"][number]>(
      `select id, name, owner_company_id, specs from projects where ${projectIds === null ? "true" : "id = any($1::uuid[])"}`,
      params,
    )
  ).rows;
  const parties = (
    await db.query<FactsSnapshot["parties"][number]>(
      `select pp.id, pp.project_id, pp.company_id, c.canonical_name as company_name, pp.role, pp.package_id, pp.award_date
         from project_parties pp join companies c on c.id = pp.company_id where ${scope.replace("project_id", "pp.project_id")}`,
      params,
    )
  ).rows;
  const edges = (
    await db.query<{ id: string; type: string; from_company_id: string; to_company_id: string; to_name: string; project_id: string | null; package_id: string | null; event_date: string | null }>(
      `select r.id, r.type, r.from_company_id, r.to_company_id, c.canonical_name as to_name, r.project_id, r.package_id, r.event_date
         from relationships r join companies c on c.id = r.to_company_id
        where r.type in ('supplied_by','approved_vendor_of') and ${projectIds === null ? "true" : "r.project_id = any($1::uuid[])"}`,
      params,
    )
  ).rows;
  const stageEvents = (
    await db.query<FactsSnapshot["stageEvents"][number]>(
      `select id, project_id, stage, event_date, evidence_id from project_stage_events
        where stage in ('feed','prequalification','epc_tender') and ${scope}`,
      params,
    )
  ).rows;

  const snapshot: FactsSnapshot = {
    projects,
    parties,
    supplyEdges: edges.filter((e) => e.type === "supplied_by"),
    approvedVendorEdges: edges.filter((e) => e.type === "approved_vendor_of"),
    stageEvents,
    evidence: {},
    companyNames: {},
  };
  await loadEvidence(db, "project_party", parties.map((p) => p.id), snapshot.evidence);
  await loadEvidence(db, "relationship", edges.map((e) => e.id), snapshot.evidence);
  await loadEvidence(db, "project_stage_event", stageEvents.map((e) => e.id), snapshot.evidence);

  const companyIds = unique([
    ...projects.map((p) => p.owner_company_id),
    ...edges.flatMap((e) => [e.from_company_id, e.to_company_id]),
    ...projects.flatMap((p) => [...readTenders(p.specs).map((t) => t.buyerCompanyId), ...readHiring(p.specs).map((h) => h.companyId)]),
  ].filter((id): id is string => Boolean(id)));
  if (companyIds.length) {
    const { rows } = await db.query<{ id: string; canonical_name: string }>("select id, canonical_name from companies where id = any($1::uuid[])", [companyIds]);
    for (const row of rows) snapshot.companyNames[row.id] = row.canonical_name;
  }
  for (const party of parties) snapshot.companyNames[party.company_id] = party.company_name;
  return snapshot;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Insert new signals and merge evidence into existing ones (same fingerprint).
 * @returns every signal row touched, plus counts.
 */
export async function upsertSignals(
  db: Queryable,
  drafts: SignalDraft[],
  runId: string | null,
): Promise<{ created: number; updated: number; signals: SignalRow[] }> {
  // Collapse drafts that share a fingerprint within this batch.
  const byFp = new Map<string, SignalDraft>();
  for (const draft of drafts) {
    const fp = signalFingerprint(draft);
    const clean = { ...draft, evidenceIds: unique(draft.evidenceIds.filter((id) => UUID_RE.test(id))) };
    const existing = byFp.get(fp);
    if (existing) existing.evidenceIds = unique([...existing.evidenceIds, ...clean.evidenceIds]);
    else byFp.set(fp, clean);
  }
  if (!byFp.size) return { created: 0, updated: 0, signals: [] };

  const existingRows = (
    await db.query<SignalRow>("select * from signals where fingerprint = any($1::text[])", [[...byFp.keys()]])
  ).rows;
  const existing = new Map(existingRows.map((row) => [row.fingerprint, row]));
  let created = 0;
  let updated = 0;
  const signals: SignalRow[] = [];
  for (const [fingerprint, d] of byFp) {
    const row = existing.get(fingerprint);
    if (row) {
      const merged = unique([...(row.evidence_ids ?? []), ...d.evidenceIds]);
      if (merged.length !== (row.evidence_ids ?? []).length) {
        const { rows } = await db.query<SignalRow>(
          "update signals set evidence_ids = $2::uuid[], summary = $3 where id = $1 returning *",
          [row.id, merged, d.summary],
        );
        signals.push(rows[0]);
        updated++;
      } else {
        signals.push(row);
      }
      continue;
    }
    const { rows } = await db.query<SignalRow>(
      `insert into signals (type, signal_date, company_id, project_id, package_id, tender_ref, summary, fingerprint, evidence_ids, run_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], $10) returning *`,
      [d.type, d.signalDate.slice(0, 10), d.companyId, d.projectId, d.packageId, d.tenderRef, d.summary, fingerprint, d.evidenceIds, runId],
    );
    signals.push(rows[0]);
    created++;
  }
  return { created, updated, signals };
}

/** Build and upsert signals for the given projects (null = all). */
export async function buildSignals(
  db: Queryable,
  projectIds: string[] | null,
  runId: string | null,
  now: Date = new Date(),
): Promise<{ created: number; updated: number; signals: SignalRow[] }> {
  const snapshot = await loadFactsSnapshot(db, projectIds);
  return upsertSignals(db, signalsFromFacts(snapshot, now), runId);
}
