import { env } from "@/lib/env";
import type { AIProvider, ExtractedContent, RelevanceResult, StructuredExtraction } from "@/types/providers";
import { relevanceSchema, structuredExtractionSchema } from "@/types/providers";

const relevancePrompt =
  "Classify whether the page is relevant to industrial buyer intelligence for infrastructure, energy, utilities, EPC, procurement, tenders, contracts, subcontracts, or project material demand. Relevant pages may include pipelines, LNG, water, power plants, CCGT, desalination, industrial facilities, EPC awards, contractor scopes, procurement notices, or public project announcements. Return only JSON with relevance, confidence, and reason. The relevance value must be exactly one of: relevant, irrelevant, uncertain.";

const extractionPrompt =
  [
    "Extract industrial buyer/procurement intelligence as strict JSON. Never infer unsupported facts.",
    "Return one JSON object only. Do not include markdown, comments, prose, null root values, or code fences.",
    "Required keys are relevant:boolean, companies:array, awardedContractors:array, requirements:array, signalType:string, confidence:number.",
    "Optional keys are project:object and tender:object. If optional values are not stated, omit them.",
    "signalType must be exactly one of: NEW_PROJECT, EPC_AWARD, TENDER_RELEASED, PROCUREMENT_REQUIREMENT, PRODUCT_SPECIFICATION, CAPEX_ANNOUNCEMENT, EXPANSION, HIRING, COMPANY_NEWS, FIRST_PARTY_ACTIVITY, TRADE_HISTORY, INTENT_SIGNAL.",
    "Each company must be an object with name and optional country. Use companies for the project owner, buyer, utility, developer, or account named in the source.",
    "Each awardedContractor must be an object with name and optional country, role, scope, contractValue, packageHint, and confidence. Use awardedContractors only for EPC firms, subcontractors, consortium members, suppliers, or contractors explicitly stated as winning, being awarded, appointed, selected, or responsible for scope in the source.",
    "Each requirement must be an object with productCategory and confidence; include productType, standard, grade, diameter, quantity, unit, and specification only when stated.",
    "If companies, awarded contractors, requirements, scopes, product specifications, grades, standards, quantities, tenders, or dates are not explicitly present in the source text, return an empty array for the required array fields.",
    "Use arrays of objects, not arrays of strings. Do not copy field descriptions as data values.",
  ].join(" ");

const relevanceContentLimit = 3000;
const extractionContentLimit = 6500;

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("AI provider returned no JSON object");
  }

  return JSON.parse(match[0]);
}

function markdownSlice(content: ExtractedContent, maxLength: number) {
  return content.markdown.slice(0, maxLength);
}

function parseRelevanceResult(text: string): RelevanceResult {
  const parsed = parseJsonObject(text);

  if (isRecord(parsed)) {
    const candidate: Record<string, unknown> = { ...parsed };
    const value = candidate.relevance;
    if (typeof value === "string") {
      candidate.relevance = value.toLowerCase().trim();
    }

    if (typeof candidate.confidence === "string") {
      const parsedConfidence = Number(candidate.confidence);
      candidate.confidence = Number.isFinite(parsedConfidence) ? parsedConfidence : 0.5;
    }

    return relevanceSchema.parse(candidate);
  }

  return relevanceSchema.parse(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStructuredExtraction(text: string): StructuredExtraction {
  const parsed = parseJsonObject(text);

  if (!isRecord(parsed)) {
    return structuredExtractionSchema.parse(parsed);
  }

  const candidate: Record<string, unknown> = { ...parsed };

  if (Array.isArray(candidate.relevant)) {
    candidate.relevant = candidate.relevant.length > 0;
  }

  if (typeof candidate.relevant !== "boolean") {
    candidate.relevant = true;
  }

  if (Array.isArray(candidate.companies)) {
    candidate.companies = candidate.companies.map((company) =>
      typeof company === "string" ? { name: company } : company,
    ).filter((company) => isRecord(company) && typeof company.name === "string" && company.name.trim());
  } else if (typeof candidate.companies === "string") {
    candidate.companies = [{ name: candidate.companies }];
  } else if (isRecord(candidate.company)) {
    candidate.companies = [candidate.company];
  } else {
    candidate.companies = [];
  }

  if (Array.isArray(candidate.awardedContractors)) {
    candidate.awardedContractors = candidate.awardedContractors.map((contractor) =>
      typeof contractor === "string" ? { name: contractor, confidence: 0.5 } : normalizeContractor(contractor),
    ).filter((contractor) => isRecord(contractor) && typeof contractor.name === "string" && contractor.name.trim());
  } else if (typeof candidate.awardedContractors === "string") {
    candidate.awardedContractors = [{ name: candidate.awardedContractors, confidence: 0.5 }];
  } else {
    candidate.awardedContractors = [];
  }

  if (typeof candidate.project === "string") {
    candidate.project = { name: candidate.project };
  }

  if (candidate.tender === null || (isRecord(candidate.tender) && typeof candidate.tender.title !== "string")) {
    delete candidate.tender;
  }
  if (typeof candidate.tender === "string") {
    candidate.tender = { title: candidate.tender };
  }

  if (Array.isArray(candidate.requirements)) {
    candidate.requirements = candidate.requirements.map((requirement) =>
      typeof requirement === "string"
        ? { productCategory: requirement, specification: requirement, confidence: 0.5 }
        : normalizeRequirement(requirement),
    ).filter((requirement) => isRecord(requirement) && typeof requirement.productCategory === "string" && requirement.productCategory.trim());
  }

  if (!Array.isArray(candidate.requirements)) {
    candidate.requirements = [];
  }

  if (typeof candidate.signalType === "string") {
    const normalizedSignalType = candidate.signalType.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const signalMap: Record<string, StructuredExtraction["signalType"]> = {
      "epc contract": "EPC_AWARD",
      "epc contracts": "EPC_AWARD",
      "epc award": "EPC_AWARD",
      "epc awarded": "EPC_AWARD",
      "contract award": "EPC_AWARD",
      "contract awarded": "EPC_AWARD",
      "award": "EPC_AWARD",
      tender: "TENDER_RELEASED",
      "tender released": "TENDER_RELEASED",
      "tender release": "TENDER_RELEASED",
      bid: "TENDER_RELEASED",
      procurement: "PROCUREMENT_REQUIREMENT",
      "procurement requirement": "PROCUREMENT_REQUIREMENT",
      "product specification": "PRODUCT_SPECIFICATION",
      capex: "CAPEX_ANNOUNCEMENT",
      expansion: "EXPANSION",
      hiring: "HIRING",
      news: "COMPANY_NEWS",
      "company news": "COMPANY_NEWS",
    };
    const upper = candidate.signalType.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    candidate.signalType = signalMap[normalizedSignalType] ?? (isSignalType(upper) ? upper : "COMPANY_NEWS");
  } else {
    candidate.signalType = "COMPANY_NEWS";
  }

  if (typeof candidate.confidence !== "number") {
    const parsedConfidence = typeof candidate.confidence === "string" ? Number(candidate.confidence) : Number.NaN;
    candidate.confidence = Number.isFinite(parsedConfidence) ? parsedConfidence : 0.5;
  }
  if (typeof candidate.confidence === "number" && candidate.confidence > 1) {
    candidate.confidence = Math.min(1, candidate.confidence / 100);
  }

  return structuredExtractionSchema.parse(candidate);
}

function normalizeContractor(value: unknown) {
  if (!isRecord(value)) return value;
  const contractor = { ...value };
  if (typeof contractor.confidence === "string") {
    const parsedConfidence = Number(contractor.confidence);
    contractor.confidence = Number.isFinite(parsedConfidence) ? parsedConfidence : 0.5;
  }
  if (typeof contractor.confidence === "number" && contractor.confidence > 1) {
    contractor.confidence = Math.min(1, contractor.confidence / 100);
  }
  return contractor;
}

function normalizeRequirement(value: unknown) {
  if (!isRecord(value)) return value;
  const requirement = { ...value };
  if (typeof requirement.productCategory !== "string") {
    requirement.productCategory = typeof requirement.productType === "string" ? requirement.productType : "Industrial requirement";
  }
  if (typeof requirement.confidence === "string") {
    const parsedConfidence = Number(requirement.confidence);
    requirement.confidence = Number.isFinite(parsedConfidence) ? parsedConfidence : 0.5;
  }
  if (typeof requirement.confidence !== "number") {
    requirement.confidence = 0.5;
  }
  if (typeof requirement.confidence === "number" && requirement.confidence > 1) {
    requirement.confidence = Math.min(1, requirement.confidence / 100);
  }
  if (typeof requirement.quantity === "string") {
    const parsedQuantity = Number(requirement.quantity.replace(/,/g, ""));
    if (Number.isFinite(parsedQuantity)) requirement.quantity = parsedQuantity;
  }
  return requirement;
}

function isSignalType(value: string): value is StructuredExtraction["signalType"] {
  return [
    "NEW_PROJECT",
    "EPC_AWARD",
    "TENDER_RELEASED",
    "PROCUREMENT_REQUIREMENT",
    "PRODUCT_SPECIFICATION",
    "CAPEX_ANNOUNCEMENT",
    "EXPANSION",
    "HIRING",
    "COMPANY_NEWS",
    "FIRST_PARTY_ACTIVITY",
    "TRADE_HISTORY",
    "INTENT_SIGNAL",
  ].includes(value);
}

async function postJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`AI provider request failed with ${response.status}: ${body.slice(0, 240)}`);
  }

  return (await response.json()) as T;
}

export class OpenAIExtractionProvider implements AIProvider {
  constructor(private readonly apiKey: string) {}

  async classifyIndustrialRelevance(content: ExtractedContent): Promise<RelevanceResult> {
    const data = await postJson<{ output_text?: string }>("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: relevancePrompt },
          { role: "user", content: markdownSlice(content, relevanceContentLimit) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "industrial_relevance",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                relevance: { type: "string", enum: ["relevant", "irrelevant", "uncertain"] },
                confidence: { type: "number" },
                reason: { type: "string" },
              },
              required: ["relevance", "confidence", "reason"],
            },
          },
        },
      }),
    });

    return parseRelevanceResult(data.output_text ?? "{}");
  }

  async extractStructuredSignal(content: ExtractedContent): Promise<StructuredExtraction> {
    const data = await postJson<{ output_text?: string }>("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: extractionPrompt },
          { role: "user", content: markdownSlice(content, extractionContentLimit) },
        ],
        text: {
          format: {
            type: "json_object",
          },
        },
      }),
    });

    return normalizeStructuredExtraction(data.output_text ?? "{}");
  }
}

export class GroqExtractionProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = env.GROQ_MODEL || "openai/gpt-oss-20b",
  ) {}

  async classifyIndustrialRelevance(content: ExtractedContent): Promise<RelevanceResult> {
    const text = await this.chatJson(relevancePrompt, markdownSlice(content, relevanceContentLimit));
    return parseRelevanceResult(text);
  }

  async extractStructuredSignal(content: ExtractedContent): Promise<StructuredExtraction> {
    const text = await this.chatJson(extractionPrompt, markdownSlice(content, extractionContentLimit), true);
    return normalizeStructuredExtraction(text);
  }

  private async chatJson(system: string, user: string, allowLooseRetry = false): Promise<string> {
    const data = await postJson<{ choices?: Array<{ message?: { content?: string } }> }>(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      },
    ).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!allowLooseRetry || !isProviderJsonValidationError(message)) throw error;

      return postJson<{ choices?: Array<{ message?: { content?: string } }> }>(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: `${system} Return parseable JSON only. If unsure, use empty arrays and COMPANY_NEWS.` },
              { role: "user", content: user },
            ],
            temperature: 0,
          }),
        },
      );
    });

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Groq returned an empty message");
    }

    return content;
  }
}

function isProviderJsonValidationError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("json_validate_failed") || lower.includes("failed to validate json") || lower.includes("json validation");
}

export class GeminiExtractionProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = env.GEMINI_MODEL || "gemini-3.7-flash",
  ) {}

  async classifyIndustrialRelevance(content: ExtractedContent): Promise<RelevanceResult> {
    const text = await this.generateJson(relevancePrompt, markdownSlice(content, relevanceContentLimit));
    return parseRelevanceResult(text);
  }

  async extractStructuredSignal(content: ExtractedContent): Promise<StructuredExtraction> {
    const text = await this.generateJson(extractionPrompt, markdownSlice(content, extractionContentLimit));
    return normalizeStructuredExtraction(text);
  }

  private async generateJson(system: string, user: string): Promise<string> {
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`);
    url.searchParams.set("key", this.apiKey);

    const data = await postJson<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: system }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: user }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });

    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!text) {
      throw new Error("Gemini returned an empty response");
    }

    return text;
  }
}

export function createAIProvider(): AIProvider {
  if (env.OPENAI_API_KEY) {
    return new OpenAIExtractionProvider(env.OPENAI_API_KEY);
  }

  if (env.GROQ_API_KEY) {
    return new GroqExtractionProvider(env.GROQ_API_KEY);
  }

  if (env.GEMINI_API_KEY) {
    return new GeminiExtractionProvider(env.GEMINI_API_KEY);
  }

  throw new Error("OPENAI_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY is required for AI extraction");
}
