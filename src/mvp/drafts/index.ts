/**
 * Outreach email drafts (docs/mvp/06 §6.3, 08 §3, 12 §1 F4).
 *
 * - Context is built ONLY from the lead's stored facts (project, buyer, award, package,
 *   requirements, contact) and the client profile. Nothing else goes to the model.
 * - The contact's country decides the outreach rule; `consent_needed` / `blocked` email → no AI call,
 *   the draft row stores `blocked_reason`.
 * - Demo mode (mock provider): a deterministic template filled with the same facts.
 * - Body ≤ 120 words; an opt-out line is appended when the country rule is `opt_out_only`.
 */
import { outreachRules, isOutreachBlocked } from "@/mvp/compliance";
import { getClientProfile } from "@/mvp/config/profile";
import { getDb, type Queryable } from "@/mvp/db";
import { getLLM } from "@/mvp/llm";
import type {
  CompanyRow,
  GateResult,
  LeadRow,
  OutreachRule,
  PackageRow,
  PersonRoleRow,
  PersonRow,
  ProjectPartyRow,
  ProjectRow,
  RequirementRow,
} from "@/mvp/types";
import { formatDay, parseSpec } from "@/mvp/scoring/util";

export const MAX_BODY_WORDS = 120;
export const OPT_OUT_LINE = "If you would prefer not to hear from us, reply \"unsubscribe\" and we will not contact you again.";

/** The facts a draft may use (and nothing else). */
export interface DraftFacts {
  clientName: string;
  clientProducts: string[];
  buyerName: string;
  projectName: string | null;
  projectCountry: string | null;
  packageName: string | null;
  discipline: string | null;
  awardDate: string | null;
  awardRole: string | null;
  requirement: string | null;
  deliveryPlace: string | null;
  contactName: string | null;
  contactTitle: string | null;
  kind: LeadRow["kind"];
  closingDate: string | null;
  tenderRef: string | null;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Trim a body to ≤ max words, cutting at the last full sentence when possible. */
export function limitWords(body: string, max = MAX_BODY_WORDS): string {
  if (countWords(body) <= max) return body.trim();
  const words = body.trim().split(/(\s+)/);
  let count = 0;
  let out = "";
  for (const token of words) {
    if (/\S/.test(token)) {
      if (count === max) break;
      count++;
    }
    out += token;
  }
  const lastStop = Math.max(out.lastIndexOf(". "), out.lastIndexOf(".\n"), out.lastIndexOf("?"));
  return (lastStop > out.length * 0.6 ? out.slice(0, lastStop + 1) : out).trim();
}

function clientShortName(name: string): string {
  return name.replace(/\s*\(.*?\)\s*/g, " ").trim();
}

/** Deterministic template (demo mode, or fallback when a live reply can't be parsed). */
export function templateDraft(f: DraftFacts): { subject: string; body: string } {
  const what = f.packageName ?? (f.discipline ? `${f.discipline.replace(/_/g, " ")} package` : "project");
  const subject = f.projectName ? `${f.projectName}: ${what}` : `${f.buyerName}: ${what}`;
  const greeting = f.contactName ? `Dear ${f.contactName.split(/\s+/)[0]},` : `Dear ${f.buyerName} procurement team,`;
  const hook =
    f.kind === "bid"
      ? `We saw that ${f.buyerName} has opened ${f.tenderRef ? `tender ${f.tenderRef}` : "a tender"}${f.projectName ? ` for ${f.projectName}` : ""}${f.closingDate ? `, closing ${formatDay(f.closingDate)}` : ""}.`
      : f.awardDate && f.projectName
        ? `Congratulations on the ${f.awardRole ?? "contract"} award for ${f.projectName} (${formatDay(f.awardDate)}).`
        : f.projectName
          ? `We understand ${f.buyerName} is working on ${f.projectName}.`
          : `We understand ${f.buyerName} is procuring for a new project.`;
  const need = f.requirement ? ` The scope includes ${f.requirement}${f.deliveryPlace ? ` for delivery to ${f.deliveryPlace}` : ""}.` : "";
  const offer = `${clientShortName(f.clientName)} supplies ${f.clientProducts.slice(0, 2).join(" and ") || "this scope"}.`;
  const ask = `Could we share our references and discuss your plans for the ${what}${f.contactTitle ? " with you" : ""}?`;
  const body = [greeting, "", `${hook}${need}`, "", `${offer} ${ask}`, "", "Kind regards,", clientShortName(f.clientName)].join("\n");
  return { subject: subject.slice(0, 120), body };
}

function systemPrompt(): string {
  return [
    "You write short, factual B2B outreach emails for an industrial supplier.",
    "Use ONLY the facts given between <facts> tags. Do not invent numbers, dates, names or claims.",
    `The body must be ${MAX_BODY_WORDS} words or fewer, plain text, polite, no marketing hype, one clear ask.`,
    "Do not include an unsubscribe line; it is added separately.",
    'Return JSON: {"subject": string, "body": string}.',
  ].join("\n");
}

function userPrompt(f: DraftFacts): string {
  const lines = Object.entries(f)
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("; ") : v}`);
  return `<facts>\n${lines.join("\n")}\n</facts>`;
}

function parseLive(text: string): { subject: string; body: string } | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as { subject?: unknown; body?: unknown };
    if (typeof parsed.subject !== "string" || typeof parsed.body !== "string" || !parsed.body.trim()) return null;
    return { subject: parsed.subject.trim(), body: parsed.body.trim() };
  } catch {
    return null;
  }
}

async function one<T>(db: Queryable, sql: string, params: unknown[]): Promise<T | null> {
  return (await db.query<T>(sql, params)).rows[0] ?? null;
}

/** Load the lead facts for a draft. */
async function loadFacts(db: Queryable, lead: LeadRow, person: PersonRow | null): Promise<{ facts: DraftFacts; buyer: CompanyRow | null }> {
  const profile = getClientProfile();
  const buyer = await one<CompanyRow>(db, "select * from companies where id = $1", [lead.buyer_company_id]);
  const project = lead.project_id ? await one<ProjectRow>(db, "select * from projects where id = $1", [lead.project_id]) : null;
  const pkg = lead.package_id ? await one<PackageRow>(db, "select * from packages where id = $1", [lead.package_id]) : null;
  const reqs = pkg ? (await db.query<RequirementRow>("select * from requirements where package_id = $1 order by created_at", [pkg.id])).rows : [];
  const party = lead.project_id
    ? await one<ProjectPartyRow>(
        db,
        "select * from project_parties where project_id = $1 and company_id = $2 order by award_date desc nulls last limit 1",
        [lead.project_id, lead.buyer_company_id],
      )
    : null;
  const role = person
    ? await one<PersonRoleRow>(db, "select * from person_roles where person_id = $1 order by created_at limit 1", [person.id])
    : null;
  const req = reqs[0];
  let requirement: string | null = null;
  if (req) {
    const spec = parseSpec(req.spec, req.item_category);
    requirement = [
      spec.odIn[0] !== undefined ? `${spec.odIn[0]}-inch` : "",
      spec.grades.join("/"),
      req.item_category,
      req.quantity !== null ? `(${req.quantity} ${req.unit ?? ""})`.replace(" )", ")") : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const productNames = lead.client_product_ids
    .map((id) => profile.products.find((p) => p.id === id)?.name)
    .filter((n): n is string => Boolean(n));
  return {
    buyer,
    facts: {
      clientName: profile.company_name,
      clientProducts: productNames.length ? productNames : profile.products.filter((p) => p.active).map((p) => p.name),
      buyerName: buyer?.canonical_name ?? "your company",
      projectName: project?.name ?? null,
      projectCountry: project?.country ?? null,
      packageName: pkg?.name ?? null,
      discipline: pkg?.discipline ?? null,
      awardDate: party?.award_date ?? null,
      awardRole: party?.role === "main_epc" ? "EPC contract" : party?.role === "subcontractor" ? "subcontract" : party ? "contract" : null,
      requirement,
      deliveryPlace: req?.delivery_port ?? req?.delivery_site ?? null,
      contactName: person?.full_name ?? null,
      contactTitle: person?.title ?? (role ? role.buying_role.replace(/_/g, " ") : null),
      kind: lead.kind,
      closingDate: lead.closing_date,
      tenderRef: lead.tender_ref,
    },
  };
}

async function storeDraft(
  db: Queryable,
  row: { leadId: string; personId: string | null; subject: string | null; body: string | null; blockedReason: string | null; model: string | null },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into outreach_drafts (lead_id, person_id, subject, body, language, blocked_reason, model)
     values ($1, $2, $3, $4, 'en', $5, $6) returning id`,
    [row.leadId, row.personId, row.subject, row.body, row.blockedReason, row.model],
  );
  return rows[0].id;
}

/**
 * Generate an outreach email draft for a lead (docs/mvp/06 §6.3, 08 §3, 12 §1 F4) with
 * getLLM('draft') (template via the mock in demo mode): subject + body ≤ 120 words + opt-out line where
 * the contact's country requires it. Stores a row in `outreach_drafts` and an 'email_draft' activity.
 *
 * When outreach for the contact's country is `consent_needed` or `blocked`, or the lead has a failed
 * sanctions gate, no text is generated: the draft is stored with `blocked_reason` and returned with
 * empty subject/body and `blockedReason`.
 *
 * @param personId the contact to write to, or null for a company-level draft.
 * @throws Error("Lead not found") / Error("Person not found").
 */
export async function generateDraft(
  leadId: string,
  personId: string | null,
): Promise<{ id: string; subject: string; body: string; blockedReason?: string }> {
  const db = getDb();
  const lead = await one<LeadRow>(db, "select * from leads where id = $1", [leadId]);
  if (!lead) throw new Error("Lead not found");
  const person = personId ? await one<PersonRow>(db, "select * from people where id = $1", [personId]) : null;
  if (personId && !person) throw new Error("Person not found");

  const { facts, buyer } = await loadFacts(db, lead, person);
  const personCompanyCountry =
    person?.current_company_id && person.current_company_id !== buyer?.id
      ? (await one<{ country: string | null }>(db, "select country from companies where id = $1", [person.current_company_id]))?.country ?? null
      : null;
  const country = person?.country ?? personCompanyCountry ?? buyer?.country ?? facts.projectCountry ?? "";
  const rule: OutreachRule = outreachRules(country);

  const sanctions = (lead.gate_results as GateResult[] | null)?.find((g) => g.id === "G7");
  let blockedReason: string | null = null;
  if (sanctions && !sanctions.pass) blockedReason = `Blocked: open sanctions match (${sanctions.why}).`;
  else if (isOutreachBlocked(rule.email))
    blockedReason = `Email outreach to ${rule.country || "this country"} is ${rule.email.replace("_", " ")}. ${rule.steps[rule.steps.length - 1] ?? ""}`.trim();

  if (blockedReason) {
    const id = await storeDraft(db, { leadId, personId, subject: null, body: null, blockedReason, model: null });
    return { id, subject: "", body: "", blockedReason };
  }

  const llm = getLLM("draft");
  let draft: { subject: string; body: string };
  let model = `${llm.name}/${llm.model}`;
  if (llm.name === "mock") {
    draft = templateDraft(facts);
    model = "template";
  } else {
    const response = await llm.complete({
      system: systemPrompt(),
      user: userPrompt(facts),
      json: true,
      maxTokens: 500,
      temperature: 0.5,
      purpose: "draft",
    });
    const parsed = parseLive(response.text);
    if (parsed) draft = parsed;
    else {
      draft = templateDraft(facts);
      model = `template (fallback from ${llm.name})`;
    }
  }

  let body = limitWords(draft.body, MAX_BODY_WORDS);
  if (rule.email === "opt_out_only") body = `${body}\n\n${OPT_OUT_LINE}`;
  const subject = draft.subject.replace(/\s+/g, " ").trim().slice(0, 150);

  const id = await storeDraft(db, { leadId, personId, subject, body, blockedReason: null, model });
  await db.query("insert into activities (lead_id, person_id, type, body) values ($1, $2, 'email_draft', $3)", [
    leadId,
    personId,
    `Draft: ${subject}`,
  ]);
  return { id, subject, body };
}
