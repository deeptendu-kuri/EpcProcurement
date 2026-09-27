/**
 * Rules-based extractor (06 §1 "rules first", 12 §2 "mock"). Deterministic regexes for award and
 * tender sentences, specs (API 5L, grade Xnn, NN-inch, km/tonnes), money, dates and "Name, Title" /
 * "Title Name" people patterns. It returns the same P1/P2/P3 shapes as the AI passes and ONLY values
 * whose quotes are verbatim substrings of the text (every quote is a sentence or span of the input).
 *
 * Used (a) as the demo-mode mock via setMockExtractor(), and (b) in live mode to fill specs the model
 * missed. Facts from it are labelled `rule`.
 */
import type { Discipline } from "@/mvp/types";
import type { CompanyRole, P1Output, P2Output, P3Output } from "./schemas";
import { MONEY_RE } from "./text";

type Fact = { value: string; quote: string };

// ───────────────────────── sentence splitting ─────────────────────────

const ABBREVIATIONS = new Set(["ltd", "co", "inc", "rs", "no", "mr", "mrs", "ms", "dr", "bhd", "st", "corp", "approx", "e.g", "i.e", "vs", "jr", "sr", "pvt"]);

/** Split into sentences that are exact substrings of `text` (abbreviation-aware). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]["'”’)]?\s+(?=[\p{Lu}\p{N}"“‘(؀-ۿ])|\n+/gu;
  for (const m of text.matchAll(re)) {
    const punct = m[0].match(/^[.!?]["'”’)]?/)?.[0] ?? "";
    const end = m.index! + punct.length;
    const before = text.slice(start, m.index!);
    const lastWord = before.match(/([\p{L}.]+)$/u)?.[1]?.toLowerCase().replace(/\.$/, "");
    if (!m[0].startsWith("\n") && lastWord && ABBREVIATIONS.has(lastWord)) continue;
    const sentence = text.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = m.index! + m[0].length;
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

// ───────────────────────── patterns ─────────────────────────

const CAP = String.raw`(?:\p{Lu}[\p{L}\p{N}&'’.–-]*|\p{Lu}{2,})`;
/** Company-like name: capitalised tokens, allowing "and"/"of"/"&" between them. */
const NAME = String.raw`${CAP}(?:\s+(?:and|of|&)\s+${CAP}|\s+${CAP})*`;
/** Optional appositive after a subject: ", the main EPC contractor on the X Project,". */
const APPOS = String.raw`(?:,[^,]{0,140},)?`;
const PROJECT_KEYWORDS = "Project|Pipeline|Scheme|System|Plant|Expansion|Development|Upgrade|Network|Line|Facility|Complex|Programme|Program|Replacement|Terminal|Refinery";
const PROJ = String.raw`${CAP}(?:\s+(?:and|of)\s+${CAP}|\s+${CAP})*?\s+(?:${PROJECT_KEYWORDS})(?:\s+(?:${PROJECT_KEYWORDS}))*(?![\p{L}])`;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const DATE = String.raw`(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTHS})\.?,?\s+\d{4}|(?:${MONTHS})\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}-\d{2}-\d{2}|(?:${MONTHS})\s+\d{4})`;

const RE = {
  awardedX: new RegExp(String.raw`(${NAME})${APPOS}\s+(?:has\s+|had\s+)?awarded\s+(${NAME})\s+(?:a|an|the)\s+[^.]*?(?:contract|order|package|subcontract|scope)`, "u"),
  awardTo: new RegExp(String.raw`(${NAME})${APPOS}\s+(?:has\s+|had\s+)?(?:awarded|awards|subcontracted|subcontracts|let)\s+(?:(?:a|an|the)\s+)?[^.]*?\s+to\s+(${NAME})`, "u"),
  win: new RegExp(
    String.raw`(${NAME})${APPOS}\s+(?:has\s+|have\s+)?(?:won|wins|secured|secures|bagged|bags|received|receives|bagged|clinched|clinches|landed|lands|been awarded|was awarded)\s+(?:(?:a|an|the)\s+)?[^.]*?(?:contract|order|package|subcontract|work|works)[^.]*?\s+(?:from|by)\s+(?:the\s+)?(${NAME})`,
    "u",
  ),
  tender: new RegExp(
    String.raw`(${NAME})${APPOS}\s+(?:has\s+)?(?:invited|invites|issued|issues|floated|floats|released|releases|launched|launches|announced|announces)\s+(?:(?:e-)?tenders?|bids|(?:a|an)\s+(?:(?:EPC|open|international|global)\s+)*(?:e-)?tender|expressions? of interest|(?:a\s+)?requests? for (?:proposals?|quotations?))`,
    "u",
  ),
  mainEpcAppos: new RegExp(String.raw`(${NAME}),\s+(?:the\s+)?(?:main\s+|lead\s+)?EPC\s+contractor`, "u"),
  ownedBy: new RegExp(String.raw`(?:owned|developed|operated)\s+by\s+(?:the\s+)?(${NAME})`, "u"),
  completed: /\b(?:was|were|has been|had been)\s+(?:completed|commissioned)\s+in\s+(\d{4})\b/i,
  project: new RegExp(String.raw`\bthe\s+(${PROJ})`, "u"),
  projectAny: new RegExp(String.raw`(${PROJ})`, "u"),
  money: MONEY_RE,
  date: new RegExp(DATE, "i"),
  valueCue: /\b(?:valued at|worth|value of|contract value|order value|amounting to|estimated at)\b/i,
  dateCue: /\b(?:signed|awarded|received on|announced on|letter of award|dated)\b/i,
  closingCue: /\b(?:closing date|due date|bid due|submission deadline|deadline|must be submitted|are due|close[sd]? on|last date)\b/i,
  tenderRef: /\b(?:Tender|Bid|RFQ|RFP|Enquiry|Inquiry)\s+(?:No\.?|Number|Ref(?:erence)?\.?)\s*[:#]?\s*([A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)+)/i,
  standard: /\b(API\s?5L|API\s?6D|API\s?600|ASME\s?B31\.\d|ISO\s?3183)\b/i,
  grade: /\b(X(?:42|46|52|56|60|65|70|80))\b/,
  size: /\b(\d{1,2}(?:\.\d)?)(?:\s?-?\s?inch(?:es)?\b|\s?in\.|["”])(?!-?dia)/i,
  quantity: /\b(\d[\d,]*(?:\.\d+)?)\s?(km|kilometres|kilometers|tonnes|tons|MT|metres|meters)\b/,
  port: /(?:deliver(?:ed|y|ies)[^.]{0,60}?\b(?:at|to)\s+(?:the\s+)?(?:port of\s+)?|\bport of\s+)(\p{Lu}[\p{L}]+(?:\s\p{Lu}[\p{L}]+)?)/u,
  neededBy: new RegExp(String.raw`(?:needed|required|delivery|delivered)\s+(?:by|before)\s+(${DATE})`, "i"),
};

const TITLE = String.raw`(?:(?:Senior|Deputy|Chief|General|Assistant|Regional|Group)\s+)?(?:(?:Procurement|Project|Projects|Package|Contracts?|Tender|Tenders|Purchase|Purchasing|Supply Chain|Managing|Technical|Commercial|Construction|Engineering|Operations|Pipeline|Piping)(?:\s+(?:Committee|Execution|and\s+Contracts))?\s+(?:Manager|Director|Head|Officer|Lead|Engineer|Secretary|Coordinator))|Head of (?:Procurement|Contracts|Supply Chain|Projects|Purchasing)|Chief (?:Executive|Procurement|Operating) Officer|Managing Director|CEO|CPO`;
const PERSON = String.raw`\p{Lu}\p{Ll}+(?:[ -](?:(?:Al|al|El|el|bin|binti|bint|van|de|da)[ -])?\p{Lu}[\p{Ll}'’]+){1,2}`;
const PERSON_RE = {
  nameTitle: new RegExp(String.raw`(${PERSON}),\s+(?:the\s+)?(?:company's\s+)?(${TITLE})\b`, "gu"),
  titleName: new RegExp(String.raw`(${TITLE})\s+(${PERSON})`, "gu"),
  nameParen: new RegExp(String.raw`(${PERSON})\s+\((${TITLE})\)`, "gu"),
};
const COMPANY_AFTER = new RegExp(String.raw`^\s*(?:,\s*)?(?:at|of|with|from|,)?\s*(?:the\s+)?(${NAME})`, "u");

const NOT_A_NAME = new Set(["the", "it", "this", "that", "these", "company", "epc", "government", "ministry", "tender", "bids", "project", "he", "she", "they", "we", "our", "its"]);

function cleanName(raw: string): string | null {
  let name = raw.trim().replace(/[,.;:]+$/, "");
  name = name.replace(/^(?:The|A|An)\s+/, "");
  name = name.replace(/^(?:[\p{L}-]+-(?:based|run|owned|listed|headquartered)\s+)+/u, "");
  if (name.length < 3 || NOT_A_NAME.has(name.toLowerCase())) return null;
  return name;
}

// ───────────────────────── P1 ─────────────────────────

const ROLE_RANK: Record<CompanyRole, number> = {
  main_epc: 5, subcontractor: 5, supplier: 5, consortium_member: 4, owner: 3, pmc: 3, consultant: 3, logistics: 3, financier: 2, unknown: 0,
};

interface Mention {
  name: string;
  nameQuote: string;
  role: CompanyRole;
  roleQuote: string | null;
}

function classifyAward(sentence: string): { awardee: CompanyRole; awarder: CompanyRole } {
  if (/subcontract/i.test(sentence)) return { awardee: "subcontractor", awarder: "main_epc" };
  const supply = /\b(?:supply|supplies|supplying|purchase order)\b|\border for\b/i.test(sentence);
  if (supply && !/\bEPC\s+(?:contract|order)\b/i.test(sentence)) return { awardee: "supplier", awarder: "unknown" };
  if (/\bconsortium\b/i.test(sentence)) return { awardee: "consortium_member", awarder: "owner" };
  return { awardee: "main_epc", awarder: "owner" };
}

function findProject(text: string): Fact | null {
  const sentences = splitSentences(text);
  for (const re of [RE.project, RE.projectAny]) {
    for (const s of sentences) {
      const m = s.match(re);
      if (m) {
        const value = m[1].trim();
        if (value.split(/\s+/).length >= 2) return { value, quote: s };
      }
    }
  }
  return null;
}

/** P1: project, stage, companies with roles, contract value, award date, tender ref, closing date. */
export function rulesP1(text: string): P1Output {
  const sentences = splitSentences(text);
  const project = findProject(text);
  const mentions = new Map<string, Mention>();
  const add = (rawName: string, role: CompanyRole, quote: string) => {
    const name = cleanName(rawName);
    if (!name || (project && project.value.includes(name))) return;
    const key = name.toLowerCase();
    const current = mentions.get(key);
    if (!current) {
      mentions.set(key, { name, nameQuote: quote, role, roleQuote: role === "unknown" ? null : quote });
    } else if (ROLE_RANK[role] > ROLE_RANK[current.role]) {
      current.role = role;
      current.roleQuote = quote;
    }
  };

  let stage: P1Output["stage"] = "unknown";
  let stageQuote: string | null = null;
  let awardSentence: string | null = null;
  let tenderSentence: string | null = null;

  for (const s of sentences) {
    let m: RegExpMatchArray | null;
    if ((m = s.match(RE.awardedX))) {
      const roles = classifyAward(s);
      add(m[1], roles.awarder, s);
      add(m[2], roles.awardee, s);
      awardSentence ??= s;
    } else if ((m = s.match(RE.awardTo))) {
      const roles = classifyAward(s);
      add(m[1], roles.awarder, s);
      add(m[2], roles.awardee, s);
      awardSentence ??= s;
    } else if ((m = s.match(RE.win))) {
      const roles = classifyAward(s);
      add(m[1], roles.awardee, s);
      add(m[2], roles.awarder, s);
      awardSentence ??= s;
    }
    if ((m = s.match(RE.tender))) {
      add(m[1], "owner", s);
      tenderSentence ??= s;
    }
    if ((m = s.match(RE.mainEpcAppos))) add(m[1], "main_epc", s);
    if ((m = s.match(RE.ownedBy))) add(m[1], "owner", s);
  }

  const completed = sentences.find((s) => RE.completed.test(s));
  if (completed) {
    stage = "completed";
    stageQuote = completed;
  } else if (awardSentence) {
    stage = "awarded";
    stageQuote = awardSentence;
  } else if (tenderSentence) {
    stage = "epc_tender";
    stageQuote = tenderSentence;
  }

  const valueSentence =
    (awardSentence && RE.money.test(awardSentence) ? awardSentence : null) ??
    sentences.find((s) => RE.valueCue.test(s) && RE.money.test(s)) ??
    null;
  const moneyMatch = valueSentence?.match(RE.money);

  const dateSentence =
    (awardSentence && RE.date.test(awardSentence) ? awardSentence : null) ??
    (awardSentence ? sentences.find((s) => RE.dateCue.test(s) && RE.date.test(s)) : undefined) ??
    null;
  const dateMatch = dateSentence?.match(RE.date);

  const closingSentence = sentences.find((s) => RE.closingCue.test(s) && RE.date.test(s));
  const closingMatch = closingSentence?.match(RE.date);
  const refSentence = sentences.find((s) => RE.tenderRef.test(s));
  const refMatch = refSentence?.match(RE.tenderRef);

  return {
    project_name: project,
    stage,
    stage_quote: stageQuote,
    companies: [...mentions.values()].slice(0, 10).map((c) => ({
      name: { value: c.name, quote: c.nameQuote },
      role: c.role,
      role_quote: c.roleQuote,
    })),
    contract_value: moneyMatch && valueSentence ? { value: moneyMatch[0].trim(), quote: valueSentence } : null,
    award_date: dateMatch && dateSentence ? { value: dateMatch[0], quote: dateSentence } : null,
    tender_ref: refMatch && refSentence ? { value: refMatch[1], quote: refSentence } : null,
    closing_date: closingMatch && closingSentence ? { value: closingMatch[0], quote: closingSentence } : null,
  };
}

// ───────────────────────── P2 ─────────────────────────

const DISCIPLINE_PHRASES: { discipline: Discipline; re: RegExp }[] = [
  {
    discipline: "pipeline",
    re: /\b(supply of [^.]{0,40}?line pipe|pipeline (?:laying|construction|installation) works?|pipeline laying|laying of [^.]{0,40}?pipeline|(?:gas|water|crude|oil|product)(?: transmission| export)? pipeline|flowlines?|line pipe)\b/i,
  },
  { discipline: "piping", re: /\b(mechanical and piping works|piping works|process piping|piping fabrication|pipeline (?:ball )?valves|valves?)\b/i },
  { discipline: "static_equipment", re: /\b(pressure vessels|storage tanks|heat exchangers|static equipment)\b/i },
  { discipline: "civil_structural", re: /\b(civil (?:and structural )?works)\b/i },
  { discipline: "electrical", re: /\b(electrical works|substations?)\b/i },
];

const ITEM_PATTERNS: { discipline: Discipline; re: RegExp; withSpecs: boolean }[] = [
  { discipline: "pipeline", re: /\b(line ?pipes?)\b/i, withSpecs: true },
  { discipline: "piping", re: /\b((?:ball |gate |check |block )?valves?)\b/i, withSpecs: false },
];

const VALVE_STANDARD = /\b(API\s?6D|API\s?600|API\s?608|ASME\s?B16\.34)\b/i;

function firstSentenceMatch(sentences: string[], re: RegExp): { match: RegExpMatchArray; sentence: string } | null {
  for (const s of sentences) {
    const match = s.match(re);
    if (match) return { match, sentence: s };
  }
  return null;
}

/** P2: packages by discipline (owner = awardee/EPC/owner per the award or tender) and requirements with specs. */
export function rulesP2(text: string, p1: P1Output = rulesP1(text)): P2Output {
  const sentences = splitSentences(text);
  const projectName = p1.project_name?.value;
  // Mask the project name so "X Gas Pipeline Project" is not read as a package phrase.
  const masked = (s: string) => (projectName ? s.split(projectName).join(" ".repeat(projectName.length)) : s);

  const byRole = (role: CompanyRole) => p1.companies.find((c) => c.role === role)?.name ?? null;
  const subcontractor = p1.companies.find((c) => c.role === "subcontractor");
  const tender = p1.stage === "epc_tender";
  const defaultOwner = tender ? byRole("owner") : (byRole("main_epc") ?? byRole("consortium_member") ?? byRole("owner"));

  const packages: P2Output["packages"] = [];
  for (const { discipline, re } of DISCIPLINE_PHRASES) {
    for (const s of sentences) {
      const m = masked(s).match(re);
      if (!m || m.index === undefined) continue;
      const value = s.slice(m.index, m.index + m[0].length);
      let owner = defaultOwner;
      if (subcontractor && s === subcontractor.role_quote) owner = subcontractor.name;
      const supplier = p1.companies.find((c) => c.role === "supplier");
      if (supplier && s === supplier.role_quote) owner = byRole("main_epc") ?? byRole("subcontractor") ?? defaultOwner;
      packages.push({
        discipline,
        name: { value, quote: s },
        scope: null,
        owner: owner ? { value: owner.value, quote: owner.quote } : null,
        procurement_route: tender ? "open_tender" : "unknown",
      });
      break;
    }
  }

  const requirements: P2Output["requirements"] = [];
  for (const item of ITEM_PATTERNS) {
    const hit = firstSentenceMatch(sentences, item.re);
    if (!hit) continue;
    const scope = item.withSpecs ? sentences : [hit.sentence];
    const fact = (re: RegExp, group = 1): Fact | null => {
      const found = firstSentenceMatch(scope, re);
      return found ? { value: found.match[group], quote: found.sentence } : null;
    };
    const quantity = item.withSpecs ? firstSentenceMatch(sentences, RE.quantity) : null;
    requirements.push({
      discipline: item.discipline,
      item: { value: hit.match[1], quote: hit.sentence },
      standard: item.withSpecs ? fact(RE.standard) : fact(VALVE_STANDARD),
      grade: item.withSpecs ? fact(RE.grade) : null,
      size_in: item.withSpecs ? fact(RE.size) : null,
      quantity: quantity ? { value: quantity.match[1], quote: quantity.sentence } : null,
      unit: quantity ? quantity.match[2].toLowerCase().replace(/^kilomet(?:re|er)s$/, "km").replace(/^(?:tons|mt)$/, "tonnes") : null,
      delivery_port: item.withSpecs || /deliver|port/i.test(hit.sentence) ? fact(RE.port) : null,
      delivery_site: null,
      needed_by: fact(RE.neededBy),
    });
  }
  return { packages, requirements };
}

// ───────────────────────── P3 ─────────────────────────

/** P3: people with titles and (when printed next to them) their company. */
export function rulesP3(text: string): P3Output {
  const people: P3Output["people"] = [];
  const seen = new Set<string>();
  for (const s of splitSentences(text)) {
    const found: { name: string; title: string; end: number }[] = [];
    for (const m of s.matchAll(PERSON_RE.nameTitle)) found.push({ name: m[1], title: m[2], end: m.index! + m[0].length });
    for (const m of s.matchAll(PERSON_RE.nameParen)) found.push({ name: m[1], title: m[2], end: m.index! + m[0].length });
    for (const m of s.matchAll(PERSON_RE.titleName)) found.push({ name: m[2], title: m[1], end: m.index! + m[0].length });
    for (const f of found) {
      const name = f.name.trim();
      const first = name.split(/\s+/)[0];
      if (/example/i.test(name) || NOT_A_NAME.has(first.toLowerCase()) || /^(?:Tender|Project|Head|Chief|Managing|Procurement|Contracts?)$/.test(first)) continue;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const after = s.slice(f.end).match(COMPANY_AFTER);
      const company = after ? cleanName(after[1]) : null;
      people.push({
        name: { value: name, quote: s },
        title: { value: f.title, quote: s },
        company: company ? { value: company, quote: s } : null,
        project_role: null,
      });
    }
  }
  return { people: people.slice(0, 10) };
}
