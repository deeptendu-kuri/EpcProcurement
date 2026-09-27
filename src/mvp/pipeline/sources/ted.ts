/**
 * EU TED search API v3 (05 §2.3): POST https://api.ted.europa.eu/v3/notices/search, no key.
 * Expert query syntax, e.g.
 *   (FT~"line pipe" OR FT~"pipeline") AND buyer-country IN (NOR) AND notice-type IN (can-standard cn-standard)
 *   AND publication-date>=20260401 SORT BY publication-date DESC
 * Verified fields: publication-number, notice-type, title-proc{lang}, notice-title{lang}, buyer-name{lang:[]},
 * buyer-country[], winner-name{lang:[]}, winner-country[], total-value, total-value-cur[], description-lot{lang:[]},
 * classification-cpv[], publication-date ("2026-09-23+02:00"), deadline-receipt-tender-date-lot[].
 *
 * Award notices give buyer, winners and value as structured fields, so they become rule evidence
 * (extracted_by 'rule:ted') and need no AI. Only EU/EEA markets apply (in the slice: NO).
 */
import type { Discipline } from "@/mvp/types";
import type { RawDoc, Source, SourceContext, StructuredFacts } from "../contracts";
import { GENERIC_QUERY_TERMS } from "../filter";
import { timedFetch } from "../read";
import type { P1Output, P2Output } from "../schemas";

export const TED_SEARCH_URL = "https://api.ted.europa.eu/v3/notices/search";

/** Slice markets covered by TED (ISO-2 → TED ISO-3). */
export const TED_COUNTRIES: Record<string, string> = { NO: "NOR" };

const ISO3_TO_2: Record<string, string> = {
  NOR: "NO", SWE: "SE", DNK: "DK", FIN: "FI", DEU: "DE", NLD: "NL", GBR: "GB", FRA: "FR", ITA: "IT", ESP: "ES", POL: "PL",
  BEL: "BE", AUT: "AT", IRL: "IE", ISL: "IS", EST: "EE", LVA: "LV", LTU: "LT", PRT: "PT", CZE: "CZ",
};

const FIELDS = [
  "publication-number", "notice-type", "notice-title", "title-proc", "buyer-name", "buyer-country", "winner-name",
  "winner-country", "total-value", "total-value-cur", "description-lot", "classification-cpv", "publication-date",
  "deadline-receipt-tender-date-lot",
];

type Multi = Record<string, string | string[]> | undefined;

interface TedNotice {
  "publication-number"?: string;
  "notice-type"?: string;
  "notice-title"?: Multi;
  "title-proc"?: Multi;
  "buyer-name"?: Multi;
  "buyer-country"?: string[];
  "winner-name"?: Multi;
  "winner-country"?: string[];
  "total-value"?: number | string;
  "total-value-cur"?: string[] | string;
  "description-lot"?: Multi;
  "classification-cpv"?: string[];
  "publication-date"?: string;
  "deadline-receipt-tender-date-lot"?: string[] | string;
}

/** Pick the English value (or the first language) of a multilingual field, as a list. */
function pick(field: Multi): string[] {
  if (!field) return [];
  const value = field.eng ?? field.ENG ?? Object.values(field)[0];
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean);
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * CPV codes for the client's scope (pipes, fittings, pipeline works, valves).
 * Checked against live TED results: broader parents (e.g. 44613 containers, 71311 civil engineering)
 * pulled in municipal notices unrelated to EPC work, so only these narrow codes are used.
 */
export const TED_SCOPE_CPV = [
  "44163100", // pipes
  "44163200", // pipe fittings
  "45231100", // general construction work for pipelines
  "45231110", // pipelaying
  "45231113", // pipeline relaying
  "45231200", // oil and gas pipelines
  "45231300", // water and sewage pipelines
  "42131100", // valves defined by function
  "42131200", // valves defined by construction
  "42131400", // taps and valves
];

/** Scope words used in TED full-text search (English and Norwegian); never generic words like "contract". */
const TED_DEFAULT_TERMS = ["pipeline", "line pipe", "piping", "valves", "rørledning"];

/** Build the expert query for the run from scope terms only. Exported for tests. */
export function buildTedQuery(terms: string[], countries: string[], leadKinds: string[], now = new Date(), windowDays = 180): string {
  const safe = terms
    .map((t) => t.replace(/["\\()~]/g, " ").trim())
    .filter((t) => t.length >= 3 && !GENERIC_QUERY_TERMS.has(t.toLowerCase()))
    .slice(0, 5);
  const words = [...new Set([...safe, ...TED_DEFAULT_TERMS])].slice(0, 7);
  const ft = words.map((w) => `FT~"${w}"`).join(" OR ");
  const types: string[] = [];
  if (leadKinds.includes("supply_subcontract") || !leadKinds.length) types.push("can-standard");
  if (leadKinds.includes("bid") || !leadKinds.length) types.push("cn-standard");
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  return `(classification-cpv IN (${TED_SCOPE_CPV.join(" ")}) OR ${ft}) AND buyer-country IN (${countries.join(" ")}) AND notice-type IN (${types.join(" ")}) AND publication-date>=${yyyymmdd(since)} SORT BY publication-date DESC`;
}

/** CPV / keyword → discipline for the notice's package. Plumbing and tanks on vehicles are not client scope. */
export function disciplineFor(cpv: string[], text: string): Discipline {
  if (cpv.some((c) => /^(4523111|4523112|4523113|452312|452313|4416310|4416320)/.test(c)) || /\bpipelines?\b|line pipe|rørledning|pipelaying/i.test(text)) return "pipeline";
  if (cpv.some((c) => /^(421311|421312|421314)/.test(c)) || /\b(?:industrial|process) piping\b|\bpiping (?:works|fabrication|erection)\b|\bvalves?\b/i.test(text)) return "piping";
  if (/\bpressure vessels?\b|\bheat exchangers?\b|\bstorage tanks?\b|\btank farm\b|\breactors?\b|\bdistillation columns?\b/i.test(text)) return "static_equipment";
  if (cpv.some((c) => /^4531/.test(c))) return "electrical";
  if (cpv.some((c) => /^45/.test(c))) return "construction_services";
  if (cpv.some((c) => /^71/.test(c))) return "engineering_services";
  return "other";
}

/** Turn one notice into a document whose text contains every structured value (so quotes verify). */
export function noticeToDoc(notice: TedNotice): RawDoc | null {
  const pubNo = notice["publication-number"];
  if (!pubNo) return null;
  const title = pick(notice["title-proc"])[0] ?? pick(notice["notice-title"])[0]?.replace(/^.*? – .*? – /, "") ?? `TED notice ${pubNo}`;
  const buyers = uniq(pick(notice["buyer-name"]));
  const winners = uniq(pick(notice["winner-name"]));
  const buyerCountry = notice["buyer-country"]?.[0] ?? null;
  const market = buyerCountry ? (ISO3_TO_2[buyerCountry] ?? null) : null;
  const winnerCountries = notice["winner-country"] ?? [];
  const isAward = (notice["notice-type"] ?? "").startsWith("can");
  const value = notice["total-value"] !== undefined ? Number(notice["total-value"]) : null;
  const currency = [notice["total-value-cur"]].flat().filter(Boolean)[0] ?? null;
  const description = pick(notice["description-lot"]).join(" ").slice(0, 3000);
  const cpv = uniq(notice["classification-cpv"] ?? []);
  const published = notice["publication-date"]?.slice(0, 10) ?? null;
  const deadline = [notice["deadline-receipt-tender-date-lot"]].flat().filter(Boolean)[0]?.slice(0, 10) ?? null;
  const url = `https://ted.europa.eu/en/notice/-/detail/${pubNo}`;

  const lines: string[] = [];
  const titleLine = `Title: ${title}.`;
  lines.push(titleLine);
  const category = pick(notice["notice-title"])[0];
  if (category && category !== title) lines.push(`Category: ${category}.`);
  const noticeLine = `Notice type: ${isAward ? "Contract award notice" : "Contract notice (call for tenders)"} ${pubNo}.`;
  lines.push(noticeLine);
  const buyerLine = buyers.length ? `Buyer: ${buyers.join("; ")}${market ? ` (${market})` : ""}.` : null;
  if (buyerLine) lines.push(buyerLine);
  const winnerLines = winners.map((w, i) => `Winner: ${w}${winnerCountries[i] ? ` (${ISO3_TO_2[winnerCountries[i]] ?? winnerCountries[i]})` : ""}.`);
  lines.push(...winnerLines);
  const valueLine = value !== null && Number.isFinite(value) ? `Total value: ${value} ${currency ?? ""}.`.replace(" .", ".") : null;
  if (valueLine) lines.push(valueLine);
  const publishedLine = published ? `Published: ${published}.` : null;
  if (publishedLine) lines.push(publishedLine);
  const deadlineLine = deadline ? `Tender deadline: ${deadline}.` : null;
  if (deadlineLine) lines.push(deadlineLine);
  if (cpv.length) lines.push(`CPV: ${cpv.slice(0, 8).join(", ")}.`);
  if (description) lines.push(`Description: ${description}`);
  const text = lines.join("\n");

  // Title and category only: descriptions mention pipes in passing (helicopters, containers).
  const discipline = disciplineFor(cpv, `${title} ${pick(notice["notice-title"])[0] ?? ""}`);
  const stage = isAward ? "awarded" : "epc_tender";
  const buyer = buyers[0] ?? null;
  const p1: P1Output = {
    project_name: { value: title, quote: titleLine },
    stage,
    stage_quote: noticeLine,
    companies: [
      ...(buyer && buyerLine ? [{ name: { value: buyer, quote: buyerLine }, role: "owner" as const, role_quote: buyerLine, country: market ? { value: market, quote: buyerLine } : null }] : []),
      ...winners.slice(0, 5).map((w, i) => ({
        name: { value: w, quote: winnerLines[i] },
        role: "main_epc" as const,
        role_quote: winnerLines[i],
        country: winnerCountries[i] && ISO3_TO_2[winnerCountries[i]] ? { value: ISO3_TO_2[winnerCountries[i]], quote: winnerLines[i] } : null,
      })),
    ],
    contract_value: valueLine && value !== null ? { value: `${value} ${currency ?? ""}`.trim(), quote: valueLine } : null,
    award_date: isAward && publishedLine && published ? { value: published, quote: publishedLine } : null,
    tender_ref: { value: pubNo, quote: noticeLine },
    closing_date: !isAward && deadlineLine && deadline ? { value: deadline, quote: deadlineLine } : null,
  };
  const owner = isAward ? winners[0] : buyer;
  const ownerQuote = isAward ? winnerLines[0] : buyerLine;
  const p2: P2Output = {
    packages: [
      {
        discipline,
        name: { value: title, quote: titleLine },
        scope: description ? { value: description.slice(0, 300), quote: `Description: ${description}`.slice(0, 320) } : null,
        owner: owner && ownerQuote ? { value: owner, quote: ownerQuote } : null,
        procurement_route: "open_tender",
      },
    ],
    requirements: [],
  };
  const structured: StructuredFacts = { extractedBy: "rule:ted", p1, p2 };
  return {
    sourceKey: "ted",
    sourceName: "EU TED",
    tier: "A",
    publisherKey: "ted.europa.eu",
    url,
    title,
    publishedAt: published ? `${published}T00:00:00.000Z` : null,
    text,
    market,
    language: "en",
    isSample: false,
    structured,
  };
}

export const tedSource: Source = {
  key: "ted",
  name: "EU TED",
  async collect(ctx: SourceContext): Promise<RawDoc[]> {
    const countries = ctx.input.markets.map((m) => TED_COUNTRIES[m.toUpperCase()]).filter(Boolean);
    if (!countries.length) {
      await ctx.log("TED skipped: no EU/EEA market selected");
      return [];
    }
    const search = async (windowDays: number): Promise<TedNotice[]> => {
      const query = buildTedQuery(ctx.terms, countries, ctx.input.leadKinds, new Date(), windowDays);
      await ctx.log(`TED query (${windowDays} days): ${query}`);
      const res = await timedFetch(TED_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, fields: FIELDS, limit: 20, scope: "ALL" }),
      });
      if (!res.ok) throw new Error(`TED HTTP ${res.status}: ${res.text.slice(0, 200)}`);
      if (res.truncated) throw new Error("TED response too large");
      return (JSON.parse(res.text) as { notices?: TedNotice[] }).notices ?? [];
    };
    let notices = await search(180);
    if (notices.length < 5) notices = await search(365); // widen to 12 months when results are few
    // Keep only notices whose CPV codes or title/category are in scope (a description hit alone is noise).
    return notices
      .map(noticeToDoc)
      .filter((d): d is RawDoc => d !== null && ["pipeline", "piping", "static_equipment"].includes(d.structured?.p2.packages[0]?.discipline ?? ""));
  },
};
