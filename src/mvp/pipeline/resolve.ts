/**
 * Resolve step (04, 07 §4, §6): turn verified facts of one document into graph rows, idempotently.
 *
 * - companies: match by exact normalised name + country, else fuzzy (token-set ratio ≥ 92) + country.
 *   match_certainty (no registry in the slice): exact name + country 0.90, fuzzy + country 0.85,
 *   name only (no country) 0.60. A new company with a known country starts at 0.90.
 * - projects: match by normalised name within the country (exact, or token-set ratio ≥ 90 when the
 *   owners don't conflict); stage only moves forward (completed/cancelled/on_hold always apply).
 * - packages by (project, discipline); requirements by (package, item_category); project_parties by
 *   (project, company, role); people by (normalised name, company); person_roles by
 *   (person, project, buying_role); relationships by (from, to, type, project); stage events by
 *   (project, stage); evidence by (document, quote, extracted_by). Re-running creates no duplicates.
 * - Every stored field gets an evidence row (quote, url, tier, publisher_key, quote_verified,
 *   agreement, extracted_by) linked through fact_evidence (entity_type, entity_id, field).
 */
import { getClientProfile } from "@/mvp/config/profile";
import type { Queryable } from "@/mvp/db";
import type {
  BuyingRole, CompanyType, Discipline, PartyRole, ProjectStage, Seniority, SourceTier,
} from "@/mvp/types";
import type { ExtractedDoc, VerifiedFact } from "./extract";
import { plausibleMoney, sameOrder, toUsd, valuesClose } from "./merge";
import { detectMarkets } from "./filter";
import { isParentInDoc, isParentMention } from "./rules-extract";
import {
  companyKeys, companyNameParts, displayCompanyName, knownCompany, normalizeCompanyName, normalizePersonName, normalizeProjectName,
  parseDate, parseMoney, parseNumber, tokenSetRatio,
} from "./text";

export interface DocContext {
  documentId: string;
  url: string;
  tier: SourceTier;
  publisherKey: string;
  /** Main market of the document (fixture market, TED buyer country, or first detected market). */
  market: string | null;
  publishedAt: string | null;
  text: string;
}

export interface ResolveStats {
  companies: number;
  newCompanies: number;
  projectId: string | null;
  newProject: boolean;
  packages: number;
  requirements: number;
  parties: number;
  people: number;
  relationships: number;
  evidence: number;
}

export const CERTAINTY = { exactCountry: 0.9, fuzzyCountry: 0.85, nameOnly: 0.6 } as const;

/** Roles of a company that won work (its award sentence dates the award). */
const AWARDEE: PartyRole[] = ["main_epc", "consortium_member", "subcontractor", "supplier"];

// ───────────────────────── mappings ─────────────────────────

const STAGE_ORDER: ProjectStage[] = [
  "concept", "feasibility", "feed", "prequalification", "epc_tender", "awarded", "detailed_engineering",
  "procurement", "construction", "commissioning", "operations",
];
const TERMINAL: ProjectStage[] = ["completed", "cancelled", "on_hold"];

function nextStage(current: ProjectStage | null, incoming: ProjectStage | null): ProjectStage | null {
  if (!incoming) return current;
  if (!current || TERMINAL.includes(incoming)) return incoming;
  if (TERMINAL.includes(current)) return current === "on_hold" ? incoming : current;
  return STAGE_ORDER.indexOf(incoming) > STAGE_ORDER.indexOf(current) ? incoming : current;
}

const ROLE_TYPES: Partial<Record<PartyRole, CompanyType>> = {
  owner: "owner", pmc: "pmc_consultant", consultant: "pmc_consultant", main_epc: "main_epc", consortium_member: "main_epc",
  subcontractor: "subcontractor", supplier: "manufacturer", logistics: "logistics", financier: "financier",
};

/** Buying role from a job title (08 / 07 §7 4.2). Exported for tests. */
export function buyingRoleFor(title: string | null | undefined): BuyingRole {
  const t = (title ?? "").toLowerCase();
  if (/procurement|purchas|supply chain|buyer|sourcing/.test(t)) return "procurement_lead";
  if (/project director|projects director|head of projects/.test(t)) return "project_director";
  if (/package manager|package lead/.test(t)) return "package_manager";
  if (/tender|contracts?\b|bid manager/.test(t)) return "tender_contact";
  if (/chief executive|\bceo\b|managing director|president|chairman/.test(t)) return "executive";
  if (/project manager/.test(t)) return "decision_maker";
  if (/engineer|technical/.test(t)) return "technical_evaluator";
  if (/logistics/.test(t)) return "logistics_coordinator";
  return "other";
}

export function seniorityFor(title: string | null | undefined): Seniority | null {
  const t = (title ?? "").toLowerCase();
  if (!t) return null;
  if (/chief|\bceo\b|\bcpo\b|managing director|president|chairman/.test(t)) return "executive";
  if (/director|head of|\bhead\b|vice president|\bvp\b/.test(t)) return "director";
  if (/manager|lead|secretary/.test(t)) return "manager";
  return "specialist";
}

/** Sector from project text (1.3 project type match). */
export function sectorFor(text: string): string | null {
  const t = text.toLowerCase();
  if (/petrochemical|polymer|cracker/.test(t)) return "petrochemical";
  if (/\bgas\b|\boil\b|crude|lng|refin|petroleum|condensate|hydrocarbon/.test(t)) return "oil_gas";
  if (/water|desalination|sewage|wastewater/.test(t)) return "water";
  if (/power|electricity|solar|wind farm|substation/.test(t)) return "power";
  if (/mining|mineral/.test(t)) return "mining";
  if (/road|rail|metro|port|airport|infrastructure|city gas/.test(t)) return "infrastructure";
  return null;
}

/** Client product for a requirement (simple keyword match; scoring may refine). */
export function productFor(item: string, standard: string | null): string | null {
  // The item decides first ("valves" with an API 5L mention is still a valve), then the standard.
  const products = getClientProfile().products.filter((p) => p.active);
  for (const text of [item.toLowerCase(), (standard ?? "").toLowerCase()]) {
    if (!text) continue;
    const product = products.find((p) => p.keywords.some((k) => text.includes(k.toLowerCase())));
    if (product) return product.id;
  }
  return null;
}

/** requirements.item_category: "line pipe" | "valves" | the lowercased item. Exported for tests. */
export function itemCategoryFor(item: string): string {
  const t = item.toLowerCase().replace(/\s+/g, " ").trim();
  if (/line ?pipes?/.test(t)) return "line pipe";
  if (/valves?\b/.test(t)) return "valves";
  return t.slice(0, 80);
}

function countryCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^[A-Z]{2}$/.test(v)) return v;
  return detectMarkets(v)[0] ?? null;
}

/**
 * Country of a project: where the work is, not where the story was published (an Indian paper
 * reporting a Saudi order). In order: the project location; the delivery site or port; one market
 * named in the award/stage sentence or the project name; the well-known owner/client's home country;
 * then the document's market. Exported for tests.
 */
export function projectCountry(ex: ExtractedDoc, docMarket: string | null): string | null {
  const fromLocation = countryCode(ex.project.location?.value);
  if (fromLocation) return fromLocation;
  for (const req of ex.requirements) {
    const fromDelivery = countryCode(req.deliverySite?.value) ?? countryCode(req.deliveryPort?.value);
    if (fromDelivery) return fromDelivery;
  }
  for (const text of [ex.project.name?.value, ex.project.stageFact?.quote, ex.project.value?.quote]) {
    const markets = text ? detectMarkets(text) : [];
    if (markets.length === 1) return markets[0];
  }
  const client = ex.companies.find((c) => c.role === "owner" && knownCompany(c.name.value)?.country) ??
    ex.companies.find((c) => c.role === "unknown" && knownCompany(c.name.value)?.country);
  const clientCountry = client ? knownCompany(client.name.value)?.country : null;
  return clientCountry ?? docMarket;
}

/**
 * The award date of a document: the date stated in the text when it is not after the article's own
 * publication date (+3 days) nor in the future; else, for an award story, the publication date.
 * Exported for tests.
 */
export function awardDateFor(textDate: string | null, publishedAt: string | null, isAwardStory: boolean, now: Date = new Date()): string | null {
  const published = publishedAt?.slice(0, 10) ?? null;
  const today = now.toISOString().slice(0, 10);
  if (textDate) {
    const tooLate = published ? Date.parse(textDate) - Date.parse(published) > 3 * 86_400_000 : false;
    if (!tooLate && textDate <= today) return textDate;
  }
  return isAwardStory && published && published <= today ? published : null;
}

// ───────────────────────── resolver ─────────────────────────

class Resolver {
  private evidenceIds = new Map<string, string>();
  readonly stats: ResolveStats = {
    companies: 0, newCompanies: 0, projectId: null, newProject: false, packages: 0, requirements: 0, parties: 0, people: 0, relationships: 0, evidence: 0,
  };

  constructor(
    private readonly db: Queryable,
    private readonly doc: DocContext,
  ) {}

  /**
   * Find-or-create the evidence row for a verified fact. Rows are shared only between facts with the
   * same quote, extractor AND agreement label, so a `single` fact never borrows a `both` row (and
   * passes G5/G6), nor does a `both` fact inherit `single` (06 §4).
   */
  async evidence(fact: VerifiedFact): Promise<string> {
    const key = `${fact.quote}\u0000${fact.extractedBy}\u0000${fact.agreement}`;
    const cached = this.evidenceIds.get(key);
    if (cached) return cached;
    const found = await this.db.query<{ id: string }>(
      "select id from evidence where document_id = $1 and quote = $2 and extracted_by = $3 and agreement is not distinct from $4 limit 1",
      [this.doc.documentId, fact.quote, fact.extractedBy, fact.agreement],
    );
    let id = found.rows[0]?.id;
    if (!id) {
      const inserted = await this.db.query<{ id: string }>(
        `insert into evidence (document_id, url, quote, char_start, char_end, extracted_by, quote_verified, agreement, tier, publisher_key, observed_at)
         values ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, coalesce($10::timestamptz, now())) returning id`,
        [this.doc.documentId, this.doc.url, fact.quote, fact.start, fact.end, fact.extractedBy, fact.agreement, this.doc.tier, this.doc.publisherKey, this.doc.publishedAt],
      );
      id = inserted.rows[0].id;
      this.stats.evidence++;
    }
    this.evidenceIds.set(key, id);
    return id;
  }

  /** Link a field of an entity to the evidence of a fact (no-op for null facts). */
  async link(entityType: string, entityId: string, field: string, fact: VerifiedFact | null | undefined): Promise<string | null> {
    if (!fact) return null;
    const evidenceId = await this.evidence(fact);
    await this.db.query(
      "insert into fact_evidence (entity_type, entity_id, field, evidence_id) values ($1, $2, $3, $4) on conflict do nothing",
      [entityType, entityId, field, evidenceId],
    );
    return evidenceId;
  }

  async company(nameFact: VerifiedFact, role: PartyRole | "unknown", countryFact: VerifiedFact | null): Promise<string> {
    // "X, or EPIC" / "X (EPIC)" are stored as "X (EPIC)"; the main name is the normalised name and
    // every part (plus a well-known group such as Aramco) is a matching key (entity resolution, 07 §4).
    const name = displayCompanyName(nameFact.value);
    const { main } = companyNameParts(name);
    const normalized = normalizeCompanyName(main) || main.toLowerCase();
    const incoming = companyKeys(name);
    const known = knownCompany(name);
    const country = countryCode(countryFact?.value) ?? known?.country ?? this.doc.market;
    const type = role !== "unknown" ? ROLE_TYPES[role] : undefined;

    const candidates = await this.db.query<{ id: string; canonical_name: string; normalized_name: string; country: string | null; match_certainty: number; types: string[] }>(
      `select id, canonical_name, normalized_name, country, match_certainty, types from companies
        where country is not distinct from $1 or country is null or normalized_name = any($2::text[]) or canonical_name like '%(%'`,
      [country, incoming.keys.filter((k) => !k.startsWith("known:"))],
    );
    let match: { id: string; certainty: number; setCountry: boolean; types: string[]; upgradeName: boolean } | null = null;
    for (const row of candidates.rows) {
      const sameCountry = country !== null && row.country === country;
      if (row.normalized_name === normalized && sameCountry) {
        match = { id: row.id, certainty: CERTAINTY.exactCountry, setCountry: false, types: row.types, upgradeName: false };
        break;
      }
    }
    if (!match) {
      // Alias or well-known group: "EPIC" = "East Pipes Integrated Company for Industry (EPIC)",
      // "Aramco" = "Saudi Aramco" = "Saudi Arabian Oil Co. (Saudi Aramco)". A written alias is strong
      // evidence, so it matches across the publisher-derived country too.
      for (const row of candidates.rows) {
        const theirs = companyKeys(row.canonical_name);
        const rowKeys = new Set([...theirs.keys, row.normalized_name]);
        if (!incoming.keys.some((k) => rowKeys.has(k))) continue;
        const sameCountry = country !== null && row.country === country;
        const eitherUnknown = country === null || row.country === null;
        if (!sameCountry && !eitherUnknown && !incoming.hasAlias && !theirs.hasAlias) continue;
        match = {
          id: row.id,
          certainty: sameCountry || known ? CERTAINTY.exactCountry : CERTAINTY.fuzzyCountry,
          setCountry: row.country === null && country !== null,
          types: row.types,
          upgradeName: companyNameParts(name).aliases.length > 0 && companyNameParts(row.canonical_name).aliases.length === 0,
        };
        break;
      }
    }
    if (!match && country) {
      let best: { id: string; score: number; types: string[] } | null = null;
      for (const row of candidates.rows) {
        if (row.country !== country) continue;
        const score = tokenSetRatio(row.normalized_name, normalized);
        if (score >= 92 && (!best || score > best.score)) best = { id: row.id, score, types: row.types };
      }
      if (best) match = { id: best.id, certainty: CERTAINTY.fuzzyCountry, setCountry: false, types: best.types, upgradeName: false };
    }
    if (!match) {
      const nameOnly = candidates.rows.find((row) => row.normalized_name === normalized && (row.country === null || country === null));
      if (nameOnly) match = { id: nameOnly.id, certainty: country ? CERTAINTY.exactCountry : CERTAINTY.nameOnly, setCountry: nameOnly.country === null && country !== null, types: nameOnly.types, upgradeName: false };
    }

    let id: string;
    if (match) {
      id = match.id;
      const types = type && !match.types.includes(type) ? [...match.types, type] : match.types;
      await this.db.query(
        `update companies set match_certainty = greatest(match_certainty, $2), types = $3, country = coalesce(country, $4),
           canonical_name = coalesce($5, canonical_name), updated_at = now() where id = $1`,
        [id, match.certainty, types, match.setCountry ? country : null, match.upgradeName ? name : null],
      );
    } else {
      const inserted = await this.db.query<{ id: string }>(
        `insert into companies (canonical_name, normalized_name, country, types, match_certainty, status)
         values ($1, $2, $3, $4, $5, 'unknown') returning id`,
        [name, normalized, country, type ? [type] : [], country ? CERTAINTY.exactCountry : CERTAINTY.nameOnly],
      );
      id = inserted.rows[0].id;
      this.stats.newCompanies++;
    }
    this.stats.companies++;
    await this.link("company", id, "canonical_name", nameFact);
    if (countryFact) await this.link("company", id, "country", countryFact);
    return id;
  }

  /**
   * True when an existing project is a different contract than the incoming order: award dates more
   * than 30 days apart, or USD values more than 15% apart (14 §11). Only checked for
   * orders (supply orders and awards whose project name was derived), where one buyer places many.
   */
  private async differentOrder(projectId: string, awardDate: string | null, money: ReturnType<typeof parseMoney>, compareValues = true): Promise<boolean> {
    const { rows } = await this.db.query<{ award: string | null; estimated_value: number | null; currency: string | null }>(
      `select (select min(event_date)::text from project_stage_events where project_id = p.id and stage = 'awarded') as award,
              p.estimated_value, p.currency
         from projects p where p.id = $1`,
      [projectId],
    );
    const row = rows[0];
    if (!row) return false;
    if (awardDate && row.award) {
      const days = Math.abs(Date.parse(awardDate) - Date.parse(row.award)) / 86_400_000;
      if (days > 30) return true;
    }
    if (compareValues && money && row.estimated_value && row.currency) {
      // Values are compared in USD, so one order reported in SAR and in INR is still one order (14 §11).
      const a = toUsd(Number(row.estimated_value), row.currency);
      const b = money.usd ?? toUsd(money.amount, money.currency);
      if (a && b) return !valuesClose(a, b);
      if (row.currency.toUpperCase() === money.currency.toUpperCase()) return !valuesClose(Number(row.estimated_value), money.amount);
    }
    return false;
  }

  /**
   * An existing project that is the same order as the incoming one although its name differs (14 §11):
   * same owner, same awardee (buyer), a shared discipline, award within 30 days and USD value within 15%.
   */
  private async sameOrderProject(
    ownerId: string | null, country: string | null, awardDate: string | null, money: ReturnType<typeof parseMoney>,
    order: { awardeeIds: string[]; disciplines: string[] },
  ): Promise<string | null> {
    if (!ownerId || !order.awardeeIds.length) return null;
    const { rows } = await this.db.query<{ id: string; company_id: string; value_usd: number | null; award: string | null; disciplines: string[] | null }>(
      `select p.id, pp.company_id, p.value_usd,
              (select min(event_date)::text from project_stage_events where project_id = p.id and stage = 'awarded') as award,
              (select array_agg(distinct discipline) from packages where project_id = p.id) as disciplines
         from projects p join project_parties pp on pp.project_id = p.id
        where p.owner_company_id = $1 and p.country is not distinct from $2 and pp.company_id = any($3::uuid[])
        limit 50`,
      [ownerId, country, order.awardeeIds],
    );
    for (const row of rows) {
      const incoming = { buyerId: row.company_id, ownerId, products: order.disciplines, awardDate, amount: money?.amount ?? null, currency: money?.currency ?? null, usd: money?.usd ?? null };
      const existing = { buyerId: row.company_id, ownerId, products: row.disciplines ?? [], awardDate: row.award, amount: null, currency: null, usd: row.value_usd };
      // Both sides need a date or a value, otherwise any two orders of one buyer would merge.
      if (!(awardDate && row.award) && !(incoming.usd && existing.usd)) continue;
      if (sameOrder(incoming, existing)) return row.id;
    }
    return null;
  }

  async project(
    ex: ExtractedDoc, ownerId: string | null, awardDate: string | null = null, isOrder = false,
    order: { awardeeIds: string[]; disciplines: string[] } = { awardeeIds: [], disciplines: [] },
  ): Promise<string | null> {
    const nameFact = ex.project.name;
    if (!nameFact) return null;
    const name = nameFact.value.replace(/\s+/g, " ").trim();
    const normalized = normalizeProjectName(name);
    const country = projectCountry(ex, this.doc.market);
    const stage = ex.project.stage;
    const money = plausibleMoney(parseMoney(ex.project.value?.value));
    const closing = parseDate(ex.project.closingDate?.value);
    const tenderRef = ex.project.tenderRef?.value ?? null;
    const sector = sectorFor(`${name} ${this.doc.text.slice(0, 2000)}`);
    const projectType = ex.project.type?.value ?? (/pipeline|flowline|crude line|gas line|water line/i.test(name) ? "pipeline" : null);
    const site = ex.project.location?.value ?? null;

    const candidates = await this.db.query<{ id: string; normalized_name: string; owner_company_id: string | null }>(
      "select id, normalized_name, owner_company_id from projects where country is not distinct from $1",
      [country],
    );
    // Exact name first, then fuzzy matches by score; an order never merges into a different order.
    const ranked: string[] = candidates.rows.filter((row) => row.normalized_name === normalized).map((row) => row.id);
    const fuzzy: { id: string; score: number }[] = [];
    for (const row of candidates.rows) {
      if (row.normalized_name === normalized) continue;
      if (ownerId && row.owner_company_id && row.owner_company_id !== ownerId) continue;
      const score = tokenSetRatio(row.normalized_name, normalized);
      if (score >= 90) fuzzy.push({ id: row.id, score });
    }
    ranked.push(...fuzzy.sort((a, b) => b.score - a.score).map((f) => f.id));
    let id: string | null = null;
    for (const candidate of ranked) {
      // Values only tell orders apart when the project is the order itself (a derived "<Buyer> <product>
      // order" name); an order on a named project is part of it, whatever its value.
      if (isOrder && (await this.differentOrder(candidate, awardDate, money, nameFact.extractedBy === "rule:derived"))) continue;
      id = candidate;
      break;
    }
    if (!id && isOrder) id = await this.sameOrderProject(ownerId, country, awardDate, money, order);

    const specsPatch: Record<string, unknown> = {};
    if (closing) specsPatch.closing_date = closing;
    if (tenderRef) specsPatch.tender_ref = tenderRef;
    const status = stage === "completed" ? "completed" : stage === "cancelled" ? "cancelled" : null;

    if (id) {
      const current = await this.db.query<{ current_stage: ProjectStage | null }>("select current_stage from projects where id = $1", [id]);
      const merged = nextStage(current.rows[0]?.current_stage ?? null, stage);
      await this.db.query(
        `update projects set
           owner_company_id = coalesce(owner_company_id, $2), current_stage = $3,
           estimated_value = coalesce(estimated_value, $4), currency = coalesce(currency, $5), value_usd = coalesce(value_usd, $6),
           sector = coalesce(sector, $7), project_type = coalesce(project_type, $8), site = coalesce(site, $9),
           specs = specs || $10::jsonb, status = coalesce($11, status), updated_at = now()
         where id = $1`,
        [id, ownerId, merged, money?.amount ?? null, money?.currency ?? null, money?.usd ?? null, sector, projectType, site, JSON.stringify(specsPatch), status],
      );
    } else {
      const inserted = await this.db.query<{ id: string }>(
        `insert into projects (name, normalized_name, owner_company_id, country, site, sector, project_type, current_stage,
                               estimated_value, currency, value_usd, funding_status, specs, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14) returning id`,
        [
          name, normalized, ownerId, country, site, sector, projectType, stage, money?.amount ?? null, money?.currency ?? null, money?.usd ?? null,
          stage === "awarded" ? "awarded" : stage === "epc_tender" ? "budgeted" : "announced", JSON.stringify(specsPatch), status ?? "active",
        ],
      );
      id = inserted.rows[0].id;
      this.stats.newProject = true;
    }

    await this.link("project", id, "name", nameFact);
    await this.link("project", id, "current_stage", ex.project.stageFact);
    await this.link("project", id, "estimated_value", ex.project.value);
    await this.link("project", id, "site", ex.project.location);
    await this.link("project", id, "specs.closing_date", ex.project.closingDate);
    await this.link("project", id, "specs.tender_ref", ex.project.tenderRef);

    if (stage && ex.project.stageFact) {
      const eventDate =
        stage === "completed"
          ? (ex.project.stageFact.quote.match(/\b(?:completed|commissioned)\s+in\s+(\d{4})/i)?.[1] ?? null)?.concat("-12-31") ?? null
          : stage === "awarded" && awardDate
            ? awardDate
            : (parseDate(ex.project.awardDate?.value) ?? this.doc.publishedAt?.slice(0, 10) ?? null);
      const evidenceId = await this.evidence(ex.project.stageFact);
      const existing = await this.db.query<{ id: string }>("select id from project_stage_events where project_id = $1 and stage = $2 limit 1", [id, stage]);
      let eventId = existing.rows[0]?.id;
      if (!eventId) {
        const inserted = await this.db.query<{ id: string }>(
          "insert into project_stage_events (project_id, stage, event_date, evidence_id) values ($1, $2, $3, $4) returning id",
          [id, stage, eventDate, evidenceId],
        );
        eventId = inserted.rows[0].id;
      }
      await this.link("project_stage_event", eventId, "stage", ex.project.stageFact);
    }
    this.stats.projectId = id;
    return id;
  }

  async package(projectId: string, discipline: Discipline, nameFact: VerifiedFact, ownerId: string | null, route: string, status: string, scope: VerifiedFact | null, ownerFact: VerifiedFact | null): Promise<string> {
    const existing = await this.db.query<{ id: string }>("select id from packages where project_id = $1 and discipline = $2 limit 1", [projectId, discipline]);
    let id = existing.rows[0]?.id;
    if (id) {
      await this.db.query(
        `update packages set package_owner_company_id = coalesce(package_owner_company_id, $2), scope_text = coalesce(scope_text, $3),
           procurement_route = case when procurement_route is null or procurement_route = 'unknown' then $4 else procurement_route end,
           updated_at = now() where id = $1`,
        [id, ownerId, scope?.value ?? null, route],
      );
    } else {
      const inserted = await this.db.query<{ id: string }>(
        `insert into packages (project_id, discipline, name, scope_text, package_owner_company_id, procurement_route, status)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [projectId, discipline, nameFact.value.slice(0, 200), scope?.value ?? null, ownerId, route, status],
      );
      id = inserted.rows[0].id;
    }
    this.stats.packages++;
    await this.link("package", id, "name", nameFact);
    await this.link("package", id, "discipline", nameFact);
    await this.link("package", id, "scope_text", scope);
    await this.link("package", id, "package_owner_company_id", ownerFact);
    return id;
  }
}

/** Company name → id for this document (by normalised name). */
type CompanyIndex = Map<string, { id: string; role: PartyRole | "unknown"; fact: VerifiedFact; roleFact: VerifiedFact | null }>;

function findCompany(index: CompanyIndex, name: string | null | undefined) {
  if (!name) return null;
  const { keys } = companyKeys(name);
  for (const key of keys) {
    const exact = index.get(key);
    if (exact) return exact;
  }
  const normalized = normalizeCompanyName(companyNameParts(name).main);
  for (const [key, value] of index) if (!key.startsWith("known:") && tokenSetRatio(key, normalized) >= 92) return value;
  return null;
}

/** Resolve one document's verified facts into the graph. Runs inside the given transaction handle. */
export async function resolveDocument(db: Queryable, doc: DocContext, ex: ExtractedDoc): Promise<ResolveStats> {
  const r = new Resolver(db, doc);

  // Companies
  const index: CompanyIndex = new Map();
  for (const company of ex.companies) {
    const id = await r.company(company.name, company.role, company.country);
    // Every name key points at one entry per company ("Aramco" and "Saudi Aramco" in one article).
    const current = [...index.values()].find((entry) => entry.id === id);
    const entry = current ?? { id, role: company.role, fact: company.name, roleFact: company.roleFact };
    if (current && current.role === "unknown" && company.role !== "unknown") {
      current.role = company.role;
      current.roleFact = company.roleFact;
    }
    for (const key of companyKeys(company.name.value).keys) if (!index.has(key)) index.set(key, entry);
  }
  const all = [...new Set(index.values())];
  const byRole = (...roles: PartyRole[]) => all.filter((c) => roles.includes(c.role as PartyRole));
  const owner = byRole("owner")[0] ?? null;
  const epcs = byRole("main_epc", "consortium_member");
  const subs = byRole("subcontractor");
  const suppliers = byRole("supplier");

  /** Company for a name mentioned elsewhere (package owner, person company), created if new. */
  const companyFor = async (fact: VerifiedFact | null) => {
    if (!fact) return null;
    const found = findCompany(index, fact.value);
    if (found) return found;
    const id = await r.company(fact, "unknown", null);
    const entry = { id, role: "unknown" as const, fact, roleFact: null };
    for (const key of companyKeys(fact.value).keys) if (!index.has(key)) index.set(key, entry);
    return entry;
  };

  // Award date: from the text, else the article's own publication date (the award is news that day).
  // A text date after the publication date (a delivery deadline read as the award) or in the future is
  // not an award date.
  const stage = ex.project.stage;
  const reportsAward = stage === "awarded" || ex.companies.some((c) => AWARDEE.includes(c.role as PartyRole) && c.roleFact && /award|won|wins|win|secur|bag|order|contract|signed/i.test(c.roleFact.quote));
  const awardDate = awardDateFor(parseDate(ex.project.awardDate?.value), doc.publishedAt, reportsAward && stage !== "completed");
  const money = plausibleMoney(parseMoney(ex.project.value?.value));
  const isOrder = ex.project.name?.extractedBy === "rule:derived" || ex.companies.some((c) => c.role === "supplier" && c.roleFact);

  // Project + stage event
  const projectId = await r.project(ex, owner?.id ?? null, awardDate, isOrder, {
    awardeeIds: [...suppliers, ...epcs, ...subs].map((c) => c.id),
    disciplines: [...new Set(ex.packages.map((p) => p.discipline))],
  });
  if (projectId && owner) await r.link("project", projectId, "owner_company_id", owner.roleFact ?? owner.fact);

  // Packages
  const packageIds = new Map<Discipline, string>();
  const packageStatus = stage === "epc_tender" || stage === "prequalification" ? "tendering" : stage === "completed" ? "closed" : stage === "awarded" ? "awarded" : "planned";
  const defaultOwner = stage === "epc_tender" ? owner : (epcs[0] ?? subs[0] ?? owner);
  if (projectId) {
    for (const pkg of ex.packages) {
      const ownerEntry = pkg.owner ? await companyFor(pkg.owner) : defaultOwner;
      const id = await r.package(projectId, pkg.discipline, pkg.name, ownerEntry?.id ?? null, pkg.route, packageStatus, pkg.scope, pkg.owner ?? ownerEntry?.roleFact ?? null);
      if (!packageIds.has(pkg.discipline)) packageIds.set(pkg.discipline, id);
    }
  }

  // Tender facts for scoring (projects.specs.tenders[], the shape src/mvp/scoring/util.ts readTenders() reads).
  if (projectId && (stage === "epc_tender" || stage === "prequalification") && (ex.project.tenderRef || ex.project.closingDate)) {
    const closing = parseDate(ex.project.closingDate?.value);
    const evidenceIds: string[] = [];
    for (const fact of [ex.project.closingDate, ex.project.tenderRef, ex.project.stageFact]) if (fact) evidenceIds.push(await r.evidence(fact));
    const tenderPackage = packageIds.get("pipeline") ?? [...packageIds.values()][0] ?? null;
    const entry = {
      ref: ex.project.tenderRef?.value ?? null,
      title: ex.project.name?.value ?? null,
      buyer_company_id: owner?.id ?? null,
      package_id: tenderPackage,
      issue_date: doc.publishedAt?.slice(0, 10) ?? null,
      closing_date: closing,
      status: closing && closing < new Date().toISOString().slice(0, 10) ? "closed" : "open",
      route: stage === "prequalification" ? "prequal" : "open_tender",
      budget_usd: money?.usd ?? null,
      is_government: /ted\.europa\.eu/.test(doc.url) ? true : null,
      evidence_ids: [...new Set(evidenceIds)],
    };
    const current = await db.query<{ specs: Record<string, unknown> }>("select specs from projects where id = $1", [projectId]);
    const tenders = (Array.isArray(current.rows[0]?.specs?.tenders) ? current.rows[0].specs.tenders : []) as Record<string, unknown>[];
    const same = (t: Record<string, unknown>) => (entry.ref ? t.ref === entry.ref : !t.ref && t.closing_date === entry.closing_date);
    const merged = tenders.some(same)
      ? tenders.map((t) => (same(t) ? { ...t, ...Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== null)), evidence_ids: [...new Set([...((t.evidence_ids as string[]) ?? []), ...entry.evidence_ids])] } : t))
      : [...tenders, entry];
    await db.query("update projects set specs = jsonb_set(specs, '{tenders}', $2::jsonb) where id = $1", [projectId, JSON.stringify(merged)]);
  }

  // Requirements (create a package for their discipline if the text named none)
  if (projectId) {
    for (const req of ex.requirements) {
      const discipline: Discipline = req.discipline ?? (/valve/i.test(req.item.value) ? "piping" : "pipeline");
      let packageId = packageIds.get(discipline);
      if (!packageId) {
        packageId = await r.package(projectId, discipline, req.item, defaultOwner?.id ?? null, stage === "epc_tender" ? "open_tender" : "unknown", packageStatus, null, defaultOwner?.roleFact ?? null);
        packageIds.set(discipline, packageId);
      }
      const itemCategory = itemCategoryFor(req.item.value);
      const spec: Record<string, unknown> = {};
      if (req.standard) spec.standard = req.standard.value.toUpperCase().replace(/^API\s?/, "API ");
      if (req.grade) spec.grade = req.grade.value.toUpperCase();
      const size = parseNumber(req.sizeIn?.value);
      if (size !== null) spec.od_in = size;
      const quantity = parseNumber(req.quantity?.value);
      const neededBy = parseDate(req.neededBy?.value);
      const productId = productFor(req.item.value, (spec.standard as string | undefined) ?? null);
      const existing = await db.query<{ id: string }>("select id from requirements where package_id = $1 and item_category = $2 limit 1", [packageId, itemCategory]);
      let id = existing.rows[0]?.id;
      if (id) {
        await db.query(
          `update requirements set spec = $2::jsonb || spec, quantity = coalesce(quantity, $3), unit = coalesce(unit, $4),
             delivery_port = coalesce(delivery_port, $5), delivery_site = coalesce(delivery_site, $6), needed_by = coalesce(needed_by, $7),
             client_product_id = coalesce(client_product_id, $8) where id = $1`,
          [id, JSON.stringify(spec), quantity, req.unit, req.deliveryPort?.value ?? null, req.deliverySite?.value ?? null, neededBy, productId],
        );
      } else {
        const inserted = await db.query<{ id: string }>(
          `insert into requirements (package_id, item_category, client_product_id, spec, quantity, unit, needed_by, delivery_site, delivery_port)
           values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9) returning id`,
          [packageId, itemCategory, productId, JSON.stringify(spec), quantity, req.unit, neededBy, req.deliverySite?.value ?? null, req.deliveryPort?.value ?? null],
        );
        id = inserted.rows[0].id;
      }
      r.stats.requirements++;
      await r.link("requirement", id, "item_category", req.item);
      await r.link("requirement", id, "spec.standard", req.standard);
      await r.link("requirement", id, "spec.grade", req.grade);
      await r.link("requirement", id, "spec.od_in", req.sizeIn);
      await r.link("requirement", id, "quantity", req.quantity);
      await r.link("requirement", id, "delivery_port", req.deliveryPort);
      await r.link("requirement", id, "delivery_site", req.deliverySite);
      await r.link("requirement", id, "needed_by", req.neededBy);
    }
  }

  // Project parties. The contract value and award date belong to the primary awardee of the document.
  // Primary awardee = the awarded party named in the award sentence (or the value sentence).
  const AWARDEE_PREF: PartyRole[] = ["subcontractor", "supplier", "main_epc", "consortium_member"];
  const inSentence = (quote: string | undefined) =>
    quote
      ? all
          .filter((c) => c.roleFact?.quote === quote && AWARDEE_PREF.includes(c.role as PartyRole))
          .sort((a, b) => AWARDEE_PREF.indexOf(a.role as PartyRole) - AWARDEE_PREF.indexOf(b.role as PartyRole))[0]
      : undefined;
  const awardee = inSentence(ex.project.value?.quote) ?? inSentence(ex.project.stageFact?.quote) ?? subs[0] ?? suppliers[0] ?? epcs[0] ?? null;
  const packageFor = async (entry: { id: string }, preferred: Discipline[]): Promise<string | null> => {
    if (!projectId) return null;
    const owned = await db.query<{ id: string }>("select id from packages where project_id = $1 and package_owner_company_id = $2 limit 1", [projectId, entry.id]);
    if (owned.rows[0]) return owned.rows[0].id;
    for (const d of preferred) if (packageIds.has(d)) return packageIds.get(d)!;
    return null;
  };
  const partyIds = new Map<string, string>();
  if (projectId) {
    for (const entry of all) {
      if (entry.role === "unknown" || !entry.roleFact) continue;
      const role = entry.role as PartyRole;
      const isAwardee = awardee?.id === entry.id;
      const packageId = role === "subcontractor" || role === "supplier" ? await packageFor(entry, role === "supplier" ? ["piping", "pipeline"] : ["piping", "pipeline", "static_equipment"]) : null;
      const status = stage === "completed" ? "completed" : role === "owner" ? null : stage === "awarded" || isAwardee ? "awarded" : "announced";
      const existing = await db.query<{ id: string }>("select id from project_parties where project_id = $1 and company_id = $2 and role = $3 limit 1", [projectId, entry.id, role]);
      let id = existing.rows[0]?.id;
      const value = isAwardee ? money : null;
      const date = isAwardee || (role !== "owner" && stage === "awarded") ? awardDate : null;
      if (id) {
        await db.query(
          `update project_parties set package_id = coalesce(package_id, $2), contract_value = coalesce(contract_value, $3), currency = coalesce(currency, $4),
             value_usd = coalesce(value_usd, $5), award_date = coalesce(award_date, $6), status = coalesce($7, status) where id = $1`,
          [id, packageId, value?.amount ?? null, value?.currency ?? null, value?.usd ?? null, date, status],
        );
      } else {
        const inserted = await db.query<{ id: string }>(
          `insert into project_parties (project_id, company_id, role, package_id, contract_value, currency, value_usd, award_date, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [projectId, entry.id, role, packageId, value?.amount ?? null, value?.currency ?? null, value?.usd ?? null, date, status],
        );
        id = inserted.rows[0].id;
      }
      partyIds.set(entry.id, id);
      r.stats.parties++;
      await r.link("project_party", id, "*", entry.roleFact);
      await r.link("project_party", id, "role", entry.roleFact);
      if (value) await r.link("project_party", id, "contract_value", ex.project.value);
      if (date && ex.project.awardDate) await r.link("project_party", id, "award_date", ex.project.awardDate);
    }
  }

  // Relationships (07 §6): owner → EPC awarded_to; EPC → sub subcontracted_to; buyer → supplier supplied_by.
  const relationship = async (from: { id: string; fact: VerifiedFact }, to: { id: string; fact: VerifiedFact; roleFact: VerifiedFact | null }, type: string, discipline: Discipline | null) => {
    if (from.id === to.id) return;
    const isAwardee = awardee?.id === to.id;
    const existing = await db.query<{ id: string }>(
      "select id from relationships where from_company_id = $1 and to_company_id = $2 and type = $3 and project_id is not distinct from $4 limit 1",
      [from.id, to.id, type, projectId],
    );
    let id = existing.rows[0]?.id;
    const pkg = discipline ? (packageIds.get(discipline) ?? null) : null;
    if (id) {
      await db.query(
        "update relationships set discipline = coalesce(discipline, $2), event_date = coalesce(event_date, $3), value_usd = coalesce(value_usd, $4), package_id = coalesce(package_id, $5) where id = $1",
        [id, discipline, awardDate, isAwardee ? (money?.usd ?? null) : null, pkg],
      );
    } else {
      const inserted = await db.query<{ id: string }>(
        `insert into relationships (from_company_id, to_company_id, type, project_id, package_id, discipline, event_date, value_usd)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [from.id, to.id, type, projectId, pkg, discipline, awardDate, isAwardee ? (money?.usd ?? null) : null],
      );
      id = inserted.rows[0].id;
    }
    r.stats.relationships++;
    await r.link("relationship", id, "*", to.roleFact ?? to.fact);
  };
  const firstDiscipline = (preferred: Discipline[]): Discipline | null => preferred.find((d) => packageIds.has(d)) ?? [...packageIds.keys()][0] ?? null;
  if (owner) for (const epc of epcs) await relationship(owner, epc, "awarded_to", firstDiscipline(["pipeline", "piping", "static_equipment"]));
  const subcontractFrom = epcs[0] ?? owner;
  if (subcontractFrom) for (const sub of subs) await relationship(subcontractFrom, sub, "subcontracted_to", firstDiscipline(["piping", "pipeline", "static_equipment", "civil_structural", "electrical"]));
  const buyerCandidates = [...epcs, ...subs, ...all.filter((c) => c.role === "unknown"), ...(owner ? [owner] : [])];
  for (const supplier of suppliers) {
    // Not the supplier's own parent ("Welspun Corp's US unit wins …").
    const quote = supplier.roleFact?.quote ?? "";
    const buyer = buyerCandidates.find((c) => c.id !== supplier.id && !isParentMention(quote, c.fact.value) && !isParentInDoc(doc.text, c.fact.value));
    if (buyer) await relationship(buyer, supplier, "supplied_by", firstDiscipline(["piping", "pipeline", "static_equipment"]));
  }

  // People and their buying roles
  for (const person of ex.people) {
    const companyEntry = person.company ? await companyFor(person.company) : null;
    const fullName = person.name.value.replace(/\s+/g, " ").trim();
    const normalized = normalizePersonName(fullName);
    const title = person.title?.value ?? null;
    const existing = await db.query<{ id: string }>(
      "select id from people where normalized_name = $1 and (current_company_id is not distinct from $2 or current_company_id is null or $2::uuid is null) limit 1",
      [normalized, companyEntry?.id ?? null],
    );
    let personId = existing.rows[0]?.id;
    if (personId) {
      await db.query(
        "update people set title = coalesce(title, $2), current_company_id = coalesce(current_company_id, $3), seniority = coalesce(seniority, $4) where id = $1",
        [personId, title, companyEntry?.id ?? null, seniorityFor(title)],
      );
    } else {
      // people.country stays null: the document market is NOT the person's location (a German EPC
      // manager quoted in a Saudi article is in Germany). Outreach rules fall back to the person's
      // company country, then the buyer's, then the strictest rule (compliance.contactCountry).
      const inserted = await db.query<{ id: string }>(
        "insert into people (full_name, normalized_name, current_company_id, title, seniority) values ($1, $2, $3, $4, $5) returning id",
        [fullName, normalized, companyEntry?.id ?? null, title, seniorityFor(title)],
      );
      personId = inserted.rows[0].id;
    }
    r.stats.people++;
    await r.link("person", personId, "full_name", person.name);
    await r.link("person", personId, "title", person.title);
    await r.link("person", personId, "current_company_id", person.company);

    if (projectId) {
      const buyingRole = buyingRoleFor(title);
      const pkg = companyEntry
        ? ((await db.query<{ id: string }>("select id from packages where project_id = $1 and package_owner_company_id = $2 limit 1", [projectId, companyEntry.id])).rows[0]?.id ?? null)
        : null;
      const found = await db.query<{ id: string }>(
        "select id from person_roles where person_id = $1 and project_id = $2 and buying_role = $3 limit 1",
        [personId, projectId, buyingRole],
      );
      let roleId = found.rows[0]?.id;
      if (!roleId) {
        const inserted = await db.query<{ id: string }>(
          "insert into person_roles (person_id, company_id, project_id, package_id, buying_role) values ($1, $2, $3, $4, $5) returning id",
          [personId, companyEntry?.id ?? null, projectId, pkg, buyingRole],
        );
        roleId = inserted.rows[0].id;
      }
      await r.link("person_role", roleId, "buying_role", person.title ?? person.name);
    }
  }

  return r.stats;
}
