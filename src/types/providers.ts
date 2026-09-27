import { z } from "zod";

export type DiscoveryPlayId = "project_owner" | "contractor_map" | "material_package" | "decision_makers" | "tender_watch";

export interface DiscoveryPlayConfig {
  id: DiscoveryPlayId;
  label: string;
  output: string;
  evidenceRules: string[];
}

export interface SearchQueryConfig {
  id: string;
  name: string;
  country?: string;
  product?: string;
  keywordGroup: string;
  sourceType: string;
  language: string;
  priority: number;
  enabled: boolean;
  queries: string[];
  strictProjectQuery?: string;
  requiredMatchTerms?: string[];
  queryMode?: "project" | "broad";
  intentClassification?: DiscoveryIntentClassification;
  discoveryPlay?: DiscoveryPlayConfig;
}

export interface DiscoveryIntentClassification {
  mode: "exact_project" | "material_sourcing" | "contractor_lookup" | "tender_watch" | "broad_procurement" | "historical_research";
  strictness: "strict" | "balanced" | "broad";
  label: string;
  explanation: string;
  requiredTerms: string[];
}

export interface DiscoveryMatchScore {
  total: number;
  project: number;
  material: number;
  region: number;
  freshness: number;
  source: number;
  contractor: number;
  contactability: number;
  reasons: string[];
}

export interface SearchResult {
  query: string;
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string;
  publishedAt?: string;
}

export interface SearchProvider {
  search(config: SearchQueryConfig): Promise<SearchResult[]>;
}

export interface ExtractedContent {
  url: string;
  title?: string;
  markdown: string;
  contentHash: string;
  scrapedAt: string;
}

export interface ContentExtractor {
  extract(url: string): Promise<ExtractedContent>;
}

export const relevanceSchema = z.object({
  relevance: z.enum(["relevant", "irrelevant", "uncertain"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export const structuredExtractionSchema = z.object({
  relevant: z.boolean(),
  companies: z.array(z.object({ name: z.string(), country: z.string().optional() })),
  awardedContractors: z
    .array(
      z.object({
        name: z.string(),
        country: z.string().optional(),
        role: z.string().optional(),
        scope: z.string().optional(),
        contractValue: z.string().optional(),
        packageHint: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .optional(),
  project: z
    .object({
      name: z.string(),
      type: z.string().optional(),
      country: z.string().optional(),
      location: z.string().optional(),
      estimatedValue: z.number().optional(),
      stage: z.string().optional(),
    })
    .optional(),
  tender: z
    .object({
      title: z.string(),
      referenceNumber: z.string().optional(),
      country: z.string().optional(),
      closingDate: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  requirements: z.array(
    z.object({
      productCategory: z.string(),
      productType: z.string().optional(),
      standard: z.string().optional(),
      grade: z.string().optional(),
      diameter: z.string().optional(),
      quantity: z.number().optional(),
      unit: z.string().optional(),
      specification: z.string().optional(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  signalType: z.enum([
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
  ]),
  confidence: z.number().min(0).max(1),
});

export type RelevanceResult = z.infer<typeof relevanceSchema>;
export type StructuredExtraction = z.infer<typeof structuredExtractionSchema>;

export interface AIProvider {
  classifyIndustrialRelevance(content: ExtractedContent): Promise<RelevanceResult>;
  extractStructuredSignal(content: ExtractedContent): Promise<StructuredExtraction>;
}

export interface TradeCompanyMatch {
  status: "Not Connected" | "Pending" | "Verified" | "No Match";
  summary: string;
}

export interface TradeIntelligenceProvider {
  searchCompany(companyName: string): Promise<TradeCompanyMatch>;
  getImports(companyName: string): Promise<unknown[]>;
  getSuppliers(companyName: string): Promise<unknown[]>;
  getProducts(companyName: string): Promise<unknown[]>;
  getRecentShipments(companyName: string): Promise<unknown[]>;
}
