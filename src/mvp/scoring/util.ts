/**
 * Small pure helpers shared by signals, gates, rubric and graph: dates, names, specs, and the
 * slice's tender / hiring facts (which live in `projects.specs` because the slice has no
 * `tenders` table, docs/mvp/12 §4).
 */
import type { Agreement, SourceTier } from "@/mvp/types";

const DAY_MS = 86_400_000;

/** Parse "YYYY-MM-DD" or an ISO timestamp into a Date (UTC). Returns null for empty/invalid input. */
export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = /^\d{4}-\d\d-\d\d$/.test(value) ? `${value}T00:00:00Z` : value;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole days from `from` to `to` (positive when `to` is later), on UTC calendar dates. */
export function daysBetween(from: string | Date, to: string | Date): number {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return Number.NaN;
  const dayA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const dayB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((dayB - dayA) / DAY_MS);
}

/** Whole months (30.44-day average) from `from` to `to`. */
export function monthsBetween(from: string | Date, to: string | Date): number {
  return daysBetween(from, to) / 30.44;
}

/** "YYYY-MM-DD" for a Date (UTC). */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM" of a date string or Date. */
export function yearMonth(value: string | Date): string {
  const date = toDate(value);
  return date ? date.toISOString().slice(0, 7) : "";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Aug 2026" for display in reasons and drafts. */
export function formatDay(value: string | Date | null | undefined): string {
  const date = toDate(value ?? null);
  if (!date) return "";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Compact money for reasons: "$120m", "$4.5m", "$800k". */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  if (value >= 1e9) return `$${round1(value / 1e9)}bn`;
  if (value >= 1e6) return `$${round1(value / 1e6)}m`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}k`;
  return `$${Math.round(value)}`;
}

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

const LEGAL_SUFFIXES =
  /\b(ltd|limited|llc|l\.l\.c|plc|inc|corp|corporation|co|company|pvt|private|gmbh|ag|sa|spa|bv|asa|as|bhd|sdn|pjsc|psc|wll|est|group|holdings?)\b\.?/g;

/** Lower-case, strip punctuation and legal suffixes: "Larsen & Toubro Ltd." → "larsen toubro". */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameName(a: string, b: string): boolean {
  const na = normalizeName(a);
  return na.length > 0 && na === normalizeName(b);
}

export function unique<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

/** An evidence item gates may rely on (07 §3 G6, 06 §4): quote verified and agreement both/rule. */
export function isGateGrade(evidence: { quoteVerified: boolean; agreement: Agreement | null }): boolean {
  return evidence.quoteVerified && (evidence.agreement === "both" || evidence.agreement === "rule");
}

/** Evidence as the scorer sees it (evidence row + document date and sample flag). */
export interface EvidenceInfo {
  id: string;
  tier: SourceTier;
  publisherKey: string;
  quoteVerified: boolean;
  agreement: Agreement | null;
  observedAt: string;
  publishedAt: string | null;
  isSample: boolean;
}

// ───────────────────────── specs (1.2) ─────────────────────────

export interface ParsedSpec {
  grades: string[];
  standards: string[];
  /** Outside diameter(s) in inches. */
  odIn: number[];
}

const GRADE_RE = /\b(X\s?\d{2,3}|L\d{3}|B)\b/gi;
const STANDARD_RE = /\b(API\s?(?:5L|6D|600|602|608|6A|Q1)|ASME\s?B\d+(?:\.\d+)?|ISO\s?3183|EN\s?10208)\b/gi;

function normStandard(value: string): string {
  return value.toUpperCase().replace(/^(API|ASME|ISO|EN)\s?/, "$1 ");
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : null;
  }
  return null;
}

/** Diameter in inches from text like `24"`, `24-inch`, `24 in`, `610 mm`, `NB 600`/`DN 600`. */
export function parseDiameterInches(text: string): number | null {
  const inch = text.match(/(\d+(?:\.\d+)?)\s?(?:"|”|''|-?\s?inch(?:es)?\b|\s?in\b|\s?NPS\b)/i) ?? text.match(/\bNPS\s?(\d+(?:\.\d+)?)/i);
  if (inch) return Number(inch[1]);
  const mm = text.match(/(\d+(?:\.\d+)?)\s?mm\b/i);
  if (mm) return Math.round((Number(mm[1]) / 25.4) * 10) / 10;
  const dn = text.match(/\b(?:DN|NB)\s?(\d{2,4})\b/i);
  if (dn) return Math.round(Number(dn[1]) / 25);
  return null;
}

/** Read grade / standard / diameter from a requirement's `spec` jsonb (lenient about key names). */
export function parseSpec(spec: Record<string, unknown> | null | undefined, extraText = ""): ParsedSpec {
  const out: ParsedSpec = { grades: [], standards: [], odIn: [] };
  const texts: string[] = [extraText];
  for (const [key, raw] of Object.entries(spec ?? {})) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === null || value === undefined) continue;
      const k = key.toLowerCase();
      if (k.includes("grade")) {
        const found = String(value).match(GRADE_RE);
        out.grades.push(...(found ?? [String(value)]).map((g) => g.toUpperCase().replace(/\s/g, "")));
      } else if (k.includes("standard") || k === "std") {
        const found = String(value).match(STANDARD_RE);
        out.standards.push(...(found ?? [String(value)]).map(normStandard));
      } else if (k === "od_mm" || k === "diameter_mm" || k === "size_mm") {
        const n = numberFrom(value);
        if (n !== null) out.odIn.push(Math.round((n / 25.4) * 10) / 10);
      } else if (k.startsWith("od") || k.includes("diameter") || k.startsWith("size") || k === "nps") {
        const n = typeof value === "number" ? value : parseDiameterInches(String(value)) ?? numberFrom(value);
        if (n !== null) out.odIn.push(n);
      } else if (typeof value === "string") {
        texts.push(value);
      }
    }
  }
  const joined = texts.join(" ");
  if (!out.grades.length) out.grades.push(...(joined.match(/\bX\s?\d{2,3}\b/gi) ?? []).map((g) => g.toUpperCase().replace(/\s/g, "")));
  if (!out.standards.length) out.standards.push(...(joined.match(STANDARD_RE) ?? []).map(normStandard));
  if (!out.odIn.length) {
    const d = parseDiameterInches(joined);
    if (d !== null) out.odIn.push(d);
  }
  return { grades: unique(out.grades), standards: unique(out.standards), odIn: unique(out.odIn) };
}

// ───────────────────────── tenders and hiring (projects.specs) ─────────────────────────

/**
 * A tender as the slice stores it: an entry of `projects.specs.tenders` (array) or
 * `projects.specs.tender` (object). snake_case or camelCase keys are both accepted.
 *
 * ```json
 * {"tenders":[{"ref":"GAIL/2026/123","title":"…","buyer_company_id":"<uuid>","package_id":"<uuid>",
 *   "issue_date":"2026-09-01","closing_date":"2026-10-20","status":"open","route":"open_tender",
 *   "budget_usd":12000000,"is_government":true,"bidders_count":4,"approved_vendors":["…"],
 *   "evidence_ids":["<evidence uuid>"]}]}
 * ```
 */
export interface TenderSpec {
  ref: string | null;
  title: string | null;
  buyerCompanyId: string | null;
  packageId: string | null;
  issueDate: string | null;
  closingDate: string | null;
  status: "open" | "closed" | "awarded" | "cancelled" | null;
  route: "open_tender" | "prequal" | "vendor_registration" | null;
  budgetUsd: number | null;
  isGovernment: boolean | null;
  biddersCount: number | null;
  approvedVendors: string[];
  evidenceIds: string[];
}

/** A job post naming the project (`projects.specs.hiring[]`), for `hiring_project_roles`. */
export interface HiringSpec {
  date: string | null;
  companyId: string | null;
  title: string | null;
  evidenceIds: string[];
}

type Loose = Record<string, unknown>;

function pick(obj: Loose, ...keys: string[]): unknown {
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  return null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}
function list(value: unknown): Loose[] {
  if (Array.isArray(value)) return value.filter((v): v is Loose => typeof v === "object" && v !== null);
  if (value && typeof value === "object") return [value as Loose];
  return [];
}

export function readTenders(specs: Record<string, unknown> | null | undefined): TenderSpec[] {
  const raw = [...list(specs?.tenders), ...list(specs?.tender)];
  return raw.map((t) => {
    const status = str(pick(t, "status"));
    const route = str(pick(t, "route", "procurement_route", "procurementRoute"));
    return {
      ref: str(pick(t, "ref", "tender_ref", "tenderRef", "portal_ref")),
      title: str(pick(t, "title")),
      buyerCompanyId: str(pick(t, "buyer_company_id", "buyerCompanyId")),
      packageId: str(pick(t, "package_id", "packageId")),
      issueDate: str(pick(t, "issue_date", "issueDate")),
      closingDate: str(pick(t, "closing_date", "closingDate")),
      status: status === "open" || status === "closed" || status === "awarded" || status === "cancelled" ? status : null,
      route: route === "prequal" || route === "vendor_registration" ? route : route ? "open_tender" : null,
      budgetUsd: num(pick(t, "budget_usd", "budgetUsd", "estimated_value_usd")),
      isGovernment: typeof pick(t, "is_government", "isGovernment") === "boolean" ? (pick(t, "is_government", "isGovernment") as boolean) : null,
      biddersCount: num(pick(t, "bidders_count", "biddersCount")),
      approvedVendors: strArray(pick(t, "approved_vendors", "approvedVendors")),
      evidenceIds: strArray(pick(t, "evidence_ids", "evidenceIds")),
    };
  });
}

export function readHiring(specs: Record<string, unknown> | null | undefined): HiringSpec[] {
  return list(specs?.hiring).map((h) => ({
    date: str(pick(h, "date", "posted_at", "postedAt")),
    companyId: str(pick(h, "company_id", "companyId")),
    title: str(pick(h, "title")),
    evidenceIds: strArray(pick(h, "evidence_ids", "evidenceIds")),
  }));
}
