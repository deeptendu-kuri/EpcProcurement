import { NextResponse } from "next/server";
import { pipelineSearchTaxonomy } from "@/config/search-taxonomy";
import { createAIProvider } from "@/modules/ai/providers";
import { createSearchProvider } from "@/modules/discovery/providers";
import { createContentExtractor } from "@/modules/sources/providers";
import { normalizeUrl } from "@/lib/urls";
import type { AIProvider, ContentExtractor, DiscoveryMatchScore, DiscoveryPlayConfig, DiscoveryPlayId, ExtractedContent, RelevanceResult, SearchQueryConfig, SearchResult, StructuredExtraction } from "@/types/providers";

interface ProcessedUrl {
  url: string;
  title?: string;
  status: "CHECKED" | "SKIPPED" | "FAILED" | "NEEDS_RETRY";
  stage: "crawl" | "classification" | "extraction" | "complete";
  relevance?: unknown;
  extraction?: unknown;
  sourceQuality?: {
    score: number;
    category: string;
    matchedSignals: string[];
  };
  matchScore?: DiscoveryMatchScore;
  reason?: string;
  error?: string;
}

interface DiscoveryRunRequest {
  query?: unknown;
  regions?: unknown;
  keywords?: unknown;
  playId?: unknown;
}

const discoveryPlayConfigs: Record<DiscoveryPlayId, DiscoveryPlayConfig> = {
  project_owner: {
    id: "project_owner",
    label: "Find project owners",
    output: "Source-backed owner/client accounts tied to a fresh project, tender, award, or procurement event.",
    evidenceRules: ["Project or tender named", "Owner/client identified", "Fresh source", "Requested market matched"],
  },
  contractor_map: {
    id: "contractor_map",
    label: "Map awarded contractors",
    output: "Awarded EPCs, contractors, subcontractors, package scopes, and parent project context.",
    evidenceRules: ["Award/contract signal", "Contractor named", "Scope/package extracted", "Parent project or buyer linked"],
  },
  material_package: {
    id: "material_package",
    label: "Find material package buyers",
    output: "Companies or contractors with evidence-backed material/package requirements.",
    evidenceRules: ["Requested material matched", "Buyer action found", "Source quality passed", "Old/completed opportunities blocked"],
  },
  decision_makers: {
    id: "decision_makers",
    label: "Find decision makers",
    output: "Account/contact targets attached to a proven owner, EPC, contractor, or package requirement.",
    evidenceRules: ["Account evidence exists", "Relevant role/person source", "Profile/contact source captured", "Verification status shown"],
  },
  tender_watch: {
    id: "tender_watch",
    label: "Watch tenders and RFQs",
    output: "Fresh tender/RFQ/procurement notices with buyer, market, and requirement evidence.",
    evidenceRules: ["Tender/RFQ signal", "Buyer or notice owner identified", "Requirement extracted", "Freshness passed"],
  },
};

export async function POST(request: Request) {
  const searchProvider = createSearchProvider();
  const extractor = createContentExtractor();
  const aiProvider = createAIProvider();
  const payload = await readDiscoveryRequest(request);
  const config = buildSearchConfig(payload);

  if (!config) {
    return NextResponse.json({ ok: false, error: "No enabled search configuration" }, { status: 400 });
  }

  try {
    const results = await searchProvider.search(config);
    const candidateResults = selectDiscoveryCandidates(results, config, { includeRecoveryCandidates: true });
    const processed: ProcessedUrl[] = [];
    const runStartedAt = Date.now();
    const maxRunMs = 28_000;
    let pdfAttempts = 0;

    for (const result of candidateResults) {
      if (processed.length > 0 && Date.now() - runStartedAt > maxRunMs) {
        break;
      }

      const url = normalizeUrl(result.url);
      let stage: ProcessedUrl["stage"] = "crawl";
      const sourceQuality = scoreSourceQuality(result, config);

      try {
        if (isUnsupportedDiscoveryUrl(url)) {
          processed.push({ url, title: result.title, status: "SKIPPED", stage, sourceQuality, reason: "Unsupported source type for this discovery run." });
          continue;
        }

        if (isPdfUrl(url)) {
          pdfAttempts += 1;
          if (pdfAttempts > 2) {
            processed.push({ url, title: result.title, status: "SKIPPED", stage, sourceQuality, reason: "Additional PDF source deferred to keep this live run responsive. Use a narrower material or tender query to prioritize it." });
            continue;
          }
        }

        if (sourceQuality.score < 3) {
          processed.push({ url, title: result.title, status: "SKIPPED", stage, sourceQuality, reason: sourceQuality.matchedSignals.length ? "Low source quality after ranking." : "No strong industrial, tender, project, or procurement signal found." });
          continue;
        }

        const previewSkipReason = searchPreviewSkipReason(result, config);
        if (previewSkipReason) {
          processed.push({ url, title: result.title, status: "SKIPPED", stage, sourceQuality, reason: previewSkipReason });
          continue;
        }

        const quickContent = contentFromSearchResult(result);
        const quickExtraction = freshnessFilteredExtraction(buildSourceBackedExtraction(quickContent, result, config, sourceQuality));
        if (quickExtraction && shouldUseFastSourceBackedExtraction(result, sourceQuality, quickExtraction)) {
          const regionReason = regionFitReason(quickExtraction, config);
          if (regionReason) {
            processed.push({ url, title: result.title, status: "SKIPPED", stage: "complete", relevance: highConfidenceSourceRelevance(sourceQuality), extraction: quickExtraction, sourceQuality, reason: regionReason });
            continue;
          }
          const queryFitReason = strictProjectFitReason(quickExtraction, config);
          if (queryFitReason) {
            processed.push({ url, title: result.title, status: "SKIPPED", stage: "complete", relevance: highConfidenceSourceRelevance(sourceQuality), extraction: quickExtraction, sourceQuality, reason: queryFitReason });
            continue;
          }
          const keywordFitReason = keywordFitReasonForExtraction(quickExtraction, config);
          if (keywordFitReason) {
            processed.push({ url, title: result.title, status: "SKIPPED", stage: "complete", relevance: highConfidenceSourceRelevance(sourceQuality), extraction: quickExtraction, sourceQuality, reason: keywordFitReason });
            continue;
          }
          const extractionQualityReason = extractionQualitySkipReason(quickExtraction, result);
          if (extractionQualityReason) {
            processed.push({ url, title: result.title, status: "SKIPPED", stage: "complete", relevance: highConfidenceSourceRelevance(sourceQuality), extraction: quickExtraction, sourceQuality, reason: extractionQualityReason });
            continue;
          }
          const matchScore = scoreLeadMatch(quickExtraction, result, config, sourceQuality);
          const matchScoreReason = matchScoreSkipReason(matchScore, config);
          if (matchScoreReason) {
            processed.push({ url, title: result.title, status: "SKIPPED", stage: "complete", relevance: highConfidenceSourceRelevance(sourceQuality), extraction: quickExtraction, sourceQuality, matchScore, reason: matchScoreReason });
            continue;
          }
          processed.push({ url, title: result.title, status: "CHECKED", stage: "complete", relevance: highConfidenceSourceRelevance(sourceQuality), extraction: quickExtraction, sourceQuality, matchScore, reason: "Relevant buyer/project signal extracted from source preview." });
          continue;
        }

        const content = await extractContentOrSearchSnippet(extractor, result, sourceQuality);
        stage = "classification";
        const relevance = await classifyWithFallback(aiProvider, content, sourceQuality);

        const sourceBackedUncertain = relevance.relevance === "uncertain" && sourceQuality.score >= 6;
        if (relevance.relevance !== "relevant" && !sourceBackedUncertain) {
          processed.push({ url, title: result.title, status: "SKIPPED", stage: "classification", relevance, extraction: null, sourceQuality, reason: relevance.reason || "AI relevance check did not find a buyer/project signal." });
          continue;
        }

        stage = "extraction";
        const extraction = freshnessFilteredExtraction(await extractSignalWithFallback(aiProvider, content, result, config, sourceQuality));
        const regionReason = regionFitReason(extraction, config);
        if (regionReason) {
          processed.push({ url, title: result.title, status: "SKIPPED", stage: "complete", relevance, extraction, sourceQuality, reason: regionReason });
          continue;
        }
        const queryFitReason = strictProjectFitReason(extraction, config);
        if (queryFitReason) {
          processed.push({ url, title: result.title, status: "SKIPPED", stage: "complete", relevance, extraction, sourceQuality, reason: queryFitReason });
          continue;
        }
        const keywordFitReason = keywordFitReasonForExtraction(extraction, config);
        if (keywordFitReason) {
          processed.push({ url, title: result.title, status: "SKIPPED", stage: "complete", relevance, extraction, sourceQuality, reason: keywordFitReason });
          continue;
        }
        const extractionQualityReason = extractionQualitySkipReason(extraction, result);
        if (extractionQualityReason) {
          processed.push({ url, title: result.title, status: "SKIPPED", stage: "complete", relevance, extraction, sourceQuality, reason: extractionQualityReason });
          continue;
        }
        const actionabilityReason = actionabilitySkipReason(extraction);
        if (actionabilityReason) {
          processed.push({ url, title: result.title, status: "SKIPPED", stage: "complete", relevance, extraction, sourceQuality, reason: actionabilityReason });
          continue;
        }

        const matchScore = scoreLeadMatch(extraction, result, config, sourceQuality);
        const matchScoreReason = matchScoreSkipReason(matchScore, config);
        if (matchScoreReason) {
          processed.push({ url, title: result.title, status: "SKIPPED", stage: "complete", relevance, extraction, sourceQuality, matchScore, reason: matchScoreReason });
          continue;
        }

        processed.push({ url, title: result.title, status: "CHECKED", stage: "complete", relevance, extraction, sourceQuality, matchScore, reason: "Relevant buyer/project signal extracted." });
      } catch (error) {
        const message = error instanceof Error ? sanitizeProcessingError(error.message) : "Unknown processing error";
        const recoverable = isRecoverableProcessingError(message);
        processed.push({
          url,
          title: result.title,
          status: recoverable && stage === "extraction" ? "SKIPPED" : recoverable ? "NEEDS_RETRY" : "FAILED",
          stage,
          sourceQuality,
          reason: recoverable && stage === "extraction" ? "Source skipped because extraction did not confirm enough buyer/project fields during this live run." : undefined,
          error: recoverable && stage === "extraction" ? undefined : message,
        });
      }
    }

    const checked = processed.filter((item) => item.status === "CHECKED");
    const coverage = discoveryCoverage(processed);
    const runVerdict = discoveryRunVerdict(processed, config, coverage);

    return NextResponse.json({
      ok: checked.length > 0 && runVerdict.status !== "weak",
      mode: "live",
      queryMode: config.queryMode,
      requiredMatchTerms: config.requiredMatchTerms,
      intentClassification: config.intentClassification,
      discoveryPlay: config.discoveryPlay,
      queries: config.queries,
      discovered: results.length,
      attempted: processed.length,
      autoRecovery: { enabled: true, recoveryCandidateCount: Math.max(0, candidateResults.length - discoveryCandidateLimit(config)) },
      coverage,
      runVerdict,
      processed,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        mode: "live",
        queries: config.queries,
        intentClassification: config.intentClassification,
        discoveryPlay: config.discoveryPlay,
        error: error instanceof Error ? sanitizeProcessingError(error.message) : "Unknown discovery error",
      },
      { status: 500 },
    );
  }
}

export function discoveryCoverage(processed: ProcessedUrl[]) {
  const domains = new Set<string>();
  const sourceCategories = new Set<string>();
  const evidenceSignals = new Set<string>();
  const accepted = processed.filter((item) => item.status === "CHECKED");
  const retry = processed.filter((item) => item.status === "NEEDS_RETRY");
  const rejected = processed.filter((item) => ["SKIPPED", "FAILED"].includes(item.status));

  processed.forEach((item) => {
    try {
      domains.add(new URL(item.url).hostname.replace(/^www\./, ""));
    } catch {
      // Keep coverage resilient for malformed external URLs.
    }
    if (item.sourceQuality?.category) sourceCategories.add(item.sourceQuality.category);
    item.sourceQuality?.matchedSignals.forEach((signal) => evidenceSignals.add(signal));
  });

  const sourceDiversity = Math.min(100, domains.size * 16 + sourceCategories.size * 8);
  const evidenceStrength = Math.min(100, accepted.length * 30 + evidenceSignals.size * 4 + sourceCategories.size * 5);
  const retryPressure = processed.length > 0 ? Math.round((retry.length / processed.length) * 100) : 0;
  const rejectionPressure = processed.length > 0 ? Math.round((rejected.length / processed.length) * 100) : 0;

  return {
    domainsChecked: domains.size,
    sourceCategories: Array.from(sourceCategories).slice(0, 8),
    evidenceSignals: Array.from(evidenceSignals).slice(0, 12),
    accepted: accepted.length,
    rejected: rejected.length,
    retry: retry.length,
    sourceDiversity,
    evidenceStrength,
    retryPressure,
    rejectionPressure,
  };
}

export function discoveryRunVerdict(
  processed: ProcessedUrl[],
  config: SearchQueryConfig,
  coverage = discoveryCoverage(processed),
) {
  const accepted = processed.filter((item) => item.status === "CHECKED");
  const bestScore = Math.max(0, ...accepted.map((item) => item.matchScore?.total ?? 0));
  const minimum = minimumLeadMatchScore(config);
  const reasons: string[] = [];

  if (accepted.length === 0) {
    reasons.push("No saveable candidate passed the evidence gates.");
  }
  if (bestScore > 0 && bestScore < minimum + 8) {
    reasons.push(`Best candidate score ${bestScore}/100 is close to the minimum ${minimum}/100 gate.`);
  }
  if (coverage.sourceDiversity < 45) {
    reasons.push("Source diversity is low; confirm with another independent source before client review.");
  }
  if (coverage.evidenceStrength < 55) {
    reasons.push("Evidence strength is low; the run needs stronger source-backed buyer action.");
  }
  if (coverage.retryPressure >= 30) {
    reasons.push("Extraction/provider retry pressure is high; useful evidence may be missing from this run.");
  }
  if (coverage.rejectionPressure >= 75 && accepted.length <= 1) {
    reasons.push("Most checked sources were rejected, so the result set may be too thin.");
  }

  const playId = config.discoveryPlay?.id;
  if (playId === "material_package" && !accepted.some((item) => (item.matchScore?.material ?? 0) >= 13)) {
    reasons.push("Material-package play needs a candidate with clear requested product/material evidence.");
  }
  if (playId === "contractor_map" && !accepted.some((item) => (item.matchScore?.contractor ?? 0) > 0)) {
    reasons.push("Contractor-map play needs a named awarded contractor or subcontractor.");
  }
  if (playId === "project_owner" && !accepted.some((item) => (item.matchScore?.project ?? 0) >= 16 && (item.matchScore?.contactability ?? 0) > 0)) {
    reasons.push("Project-owner play needs a named project plus identifiable owner/client account.");
  }

  const uniqueReasons = Array.from(new Set(reasons)).slice(0, 5);
  const status = accepted.length === 0 || bestScore < minimum
    ? "weak"
    : uniqueReasons.length > 0
      ? "review"
      : "client_safe";

  return {
    status,
    label: status === "client_safe" ? "Client-safe" : status === "review" ? "Needs review" : "Weak run",
    bestScore,
    acceptedCount: accepted.length,
    minimumScore: minimum,
    reasons: uniqueReasons,
  };
}
function actionabilitySkipReason(extraction: StructuredExtraction) {
  const actionableSignals: StructuredExtraction["signalType"][] = [
    "EPC_AWARD",
    "TENDER_RELEASED",
    "PROCUREMENT_REQUIREMENT",
    "PRODUCT_SPECIFICATION",
    "CAPEX_ANNOUNCEMENT",
    "EXPANSION",
  ];
  const hasCompany = extraction.companies.length > 0;
  const hasProject = Boolean(extraction.project?.name);
  const hasTender = Boolean(extraction.tender?.title);
  const hasContractor = Boolean(extraction.awardedContractors?.length);
  const hasRequirement = extraction.requirements.length > 0;
  const hasActionableSignal = actionableSignals.includes(extraction.signalType);
  const hasProcurementSignal = ["EPC_AWARD", "TENDER_RELEASED", "PROCUREMENT_REQUIREMENT", "CAPEX_ANNOUNCEMENT", "EXPANSION"].includes(extraction.signalType);

  if (hasCompany && (hasProject || hasTender || hasContractor || (hasRequirement && hasActionableSignal && hasProcurementSignal))) {
    return "";
  }

  return "Source had industrial/material context, but no specific buyer action, project, tender, award, or requirement was confirmed.";
}

export function strictProjectFitReason(extraction: StructuredExtraction, config: SearchQueryConfig) {
  if (!config.strictProjectQuery) return undefined;

  const terms = distinctiveQueryTerms(config.strictProjectQuery);
  if (terms.length < 2) return undefined;

  const haystack = structuredExtractionText(extraction);
  const matchedTerms = terms.filter((term) => haystack.includes(term));
  const strongUniqueMatch = matchedTerms.some((term) => term.length >= 6);

  if (strongUniqueMatch || matchedTerms.length >= 2) return undefined;

  return `Skipped because the extracted account/project did not match the searched project phrase "${config.strictProjectQuery}".`;
}

function keywordFitReasonForExtraction(extraction: StructuredExtraction, config: SearchQueryConfig) {
  if (!config.requiredMatchTerms?.length) return undefined;

  const haystack = structuredExtractionText(extraction);
  if (matchesRequiredTerms(haystack, config.requiredMatchTerms)) return undefined;

  return `Skipped because the extracted lead did not match the requested keyword/material terms: ${config.requiredMatchTerms.slice(0, 4).join(", ")}.`;
}

function freshnessFilteredExtraction(extraction: StructuredExtraction): StructuredExtraction;
function freshnessFilteredExtraction(extraction: StructuredExtraction | null): StructuredExtraction | null;
function freshnessFilteredExtraction(extraction: StructuredExtraction | null): StructuredExtraction | null {
  if (!extraction) return null;

  const companies = extraction.companies.filter((company) => isUsefulEntityName(company.name));
  const awardedContractors = extraction.awardedContractors?.filter((contractor) => isUsefulEntityName(contractor.name) && !hasStaleHistoricalYear([contractor.name, contractor.scope, contractor.packageHint, contractor.role].filter(Boolean).join(" "))) ?? [];
  return { ...extraction, companies, awardedContractors };
}

function structuredExtractionText(extraction: StructuredExtraction) {
  return [
    extraction.companies.map((company) => [company.name, company.country].filter(Boolean).join(" ")).join(" "),
    extraction.awardedContractors?.map((contractor) => [contractor.name, contractor.role, contractor.scope, contractor.packageHint, contractor.country].filter(Boolean).join(" ")).join(" "),
    extraction.project ? [extraction.project.name, extraction.project.type, extraction.project.country, extraction.project.location, extraction.project.stage].filter(Boolean).join(" ") : "",
    extraction.tender ? [extraction.tender.title, extraction.tender.referenceNumber, extraction.tender.country, extraction.tender.status].filter(Boolean).join(" ") : "",
    extraction.requirements.map((requirement) => [requirement.productCategory, requirement.productType, requirement.standard, requirement.grade, requirement.specification].filter(Boolean).join(" ")).join(" "),
    extraction.signalType,
  ]
    .join(" ")
    .toLowerCase();
}

export function scoreLeadMatch(
  extraction: StructuredExtraction,
  result: SearchResult,
  config: SearchQueryConfig,
  sourceQuality: { score: number; category: string; matchedSignals: string[] } | undefined,
): DiscoveryMatchScore {
  const text = structuredExtractionText(extraction);
  const sourceText = [result.title, result.snippet, result.url].join(" ").toLowerCase();
  const requiredTerms = config.requiredMatchTerms ?? [];
  const projectTerms = config.strictProjectQuery ? distinctiveQueryTerms(config.strictProjectQuery) : [];
  const materialTerms = materialTermsForQuery([config.queries.join(" "), sourceText, text].join(" "));
  const reasons: string[] = [];

  const matchedProjectTerms = projectTerms.filter((term) => text.includes(term) || sourceText.includes(term));
  const project = config.strictProjectQuery
    ? Math.min(25, matchedProjectTerms.length * 8 + (matchedProjectTerms.some((term) => term.length >= 6) ? 8 : 0))
    : extraction.project?.name || extraction.tender?.title
      ? 16
      : 6;
  if (config.strictProjectQuery && matchedProjectTerms.length > 0) {
    reasons.push(`Project terms matched: ${matchedProjectTerms.slice(0, 3).join(", ")}`);
  } else if (extraction.project?.name) {
    reasons.push(`Project extracted: ${extraction.project.name}`);
  }

  const matchedMaterialTerms = Array.from(new Set([...requiredTerms, ...materialTerms])).filter((term) => {
    const normalized = cleanText(term).toLowerCase();
    return normalized && (text.includes(normalized) || sourceText.includes(normalized));
  });
  const material = matchedMaterialTerms.length > 0 ? Math.min(20, 10 + matchedMaterialTerms.length * 3) : extraction.requirements.length > 0 ? 10 : 0;
  if (matchedMaterialTerms.length > 0) reasons.push(`Requirement/material matched: ${matchedMaterialTerms.slice(0, 3).join(", ")}`);

  const regionMatches = regionTerms(config.country).filter((term) => term !== "global" && (text.includes(term) || sourceText.includes(term)));
  const requestedRegions = regionTerms(config.country).filter((term) => term !== "global");
  const region = requestedRegions.length === 0 ? 10 : regionMatches.length > 0 ? 12 : 2;
  if (regionMatches.length > 0) reasons.push(`Region matched: ${regionMatches.slice(0, 2).join(", ")}`);

  const freshness = sourceFreshnessSkipReason(result) ? 0 : 13;
  if (freshness > 0) reasons.push("Freshness guard passed");

  const source = Math.max(0, Math.min(12, sourceQuality?.score ?? 0));
  if (sourceQuality?.category) reasons.push(`Source class: ${sourceQuality.category}`);

  const contractor = extraction.awardedContractors?.length ? 12 : 0;
  if (contractor > 0) reasons.push(`${extraction.awardedContractors?.length ?? 0} awarded contractor${extraction.awardedContractors?.length === 1 ? "" : "s"} extracted`);

  const contactability = extraction.companies.length > 0 ? 8 : 0;
  if (contactability > 0) reasons.push("Account/contact enrichment path available");

  const total = Math.max(0, Math.min(100, project + material + region + freshness + source + contractor + contactability));

  return {
    total,
    project,
    material,
    region,
    freshness,
    source,
    contractor,
    contactability,
    reasons: Array.from(new Set(reasons)).slice(0, 5),
  };
}

export function minimumLeadMatchScore(config: SearchQueryConfig) {
  switch (config.intentClassification?.mode) {
    case "exact_project":
      return 68;
    case "material_sourcing":
      return 58;
    case "contractor_lookup":
    case "tender_watch":
      return 56;
    case "historical_research":
      return 72;
    default:
      return 52;
  }
}

export function matchScoreSkipReason(matchScore: DiscoveryMatchScore, config: SearchQueryConfig) {
  const evidenceReason = evidenceGateSkipReason(matchScore, config);
  if (evidenceReason) return evidenceReason;

  const minimum = minimumLeadMatchScore(config);
  if (matchScore.total >= minimum) return "";

  return `Source extracted fields, but match score ${matchScore.total}/100 is below the ${minimum}/100 save threshold for ${config.intentClassification?.label ?? "this search"}.`;
}

function evidenceGateSkipReason(matchScore: DiscoveryMatchScore, config: SearchQueryConfig) {
  const mode = config.intentClassification?.mode;
  const playId = config.discoveryPlay?.id;
  const hasRequestedRegion = regionTerms(config.country).some((term) => term !== "global");

  if (matchScore.freshness <= 0) {
    return "Source extracted fields, but it did not pass the fresh-opportunity evidence gate.";
  }

  if (hasRequestedRegion && matchScore.region < 10) {
    return `Source extracted fields, but it did not prove the requested market/region: ${config.country}.`;
  }

  if (mode === "exact_project" && matchScore.project < 16) {
    return "Source extracted fields, but it did not prove the searched project strongly enough to save.";
  }

  if (playId === "contractor_map") {
    if (matchScore.contractor <= 0) {
      return "Source extracted fields, but the contractor-map play requires a named awarded EPC, contractor, subcontractor, or package owner.";
    }
    if (matchScore.project < 10) {
      return "Source extracted fields, but the contractor-map play requires parent project, owner, or package context.";
    }
    if (matchScore.source < 6) {
      return "Source extracted fields, but the contractor-map source quality was too weak to save.";
    }
  }

  if (playId === "project_owner") {
    if (matchScore.contactability <= 0) {
      return "Source extracted fields, but the project-owner play requires an identifiable owner/client account.";
    }
    if (matchScore.project < 16) {
      return "Source extracted fields, but the project-owner play requires a named project, tender, award, or procurement event.";
    }
    if (matchScore.source < 6) {
      return "Source extracted fields, but the project-owner source quality was too weak to save.";
    }
  }

  if (playId === "tender_watch") {
    if (matchScore.material < 10 && matchScore.project < 16) {
      return "Source extracted fields, but the tender/RFQ play requires a named tender, project, or requirement.";
    }
    if (matchScore.source < 6) {
      return "Source extracted fields, but the tender/RFQ source quality was too weak to save.";
    }
  }

  if (playId === "decision_makers") {
    if (matchScore.contactability <= 0) {
      return "Source extracted fields, but the decision-maker play requires an identifiable account before contact enrichment.";
    }
    if (matchScore.project < 10 && matchScore.material < 10 && matchScore.contractor <= 0) {
      return "Source extracted fields, but the decision-maker play requires account, project, contractor, or package evidence before contact search.";
    }
    if (matchScore.source < 6) {
      return "Source extracted fields, but the decision-maker source quality was too weak to save.";
    }
  }

  if (mode === "material_sourcing") {
    if (matchScore.material < 13) {
      return `Source extracted fields, but it did not prove the requested material/product terms: ${config.intentClassification?.requiredTerms?.slice(0, 4).join(", ") || config.requiredMatchTerms?.slice(0, 4).join(", ") || "requested product"}.`;
    }

    if (matchScore.source < 6) {
      return "Source extracted fields, but the source quality was too weak for a material sourcing lead.";
    }
  }

  if ((mode === "contractor_lookup" || mode === "tender_watch") && matchScore.source < 6) {
    return "Source extracted fields, but the tender/contractor source quality was too weak to save.";
  }

  return "";
}

function extractionQualitySkipReason(extraction: StructuredExtraction, result: SearchResult) {
  const preview = [result.title, result.snippet, result.url].join(" ");
  const genericSupplierPage = /\b(supplier|stockist|trader|trading|distributor|manufacturer|catalog|catalogue)\b/i.test(preview);
  const explicitBuyingEvent = /\b(tender|procurement|bid|rfq|rfi|awards?|awarded|wins?|secured?|contract|subcontract|purchase order|project)\b/i.test(preview);

  if (genericSupplierPage && !explicitBuyingEvent) {
    return "Generic supplier/catalog page skipped because it did not identify a buyer action, project, tender, or contract.";
  }

  const projectName = extraction.project?.name ?? "";
  if (genericSupplierPage && /\b(supplier|stockist|trader|trading|distributor|manufacturer|catalog|catalogue)\b/i.test(projectName)) {
    return "Generic supplier page skipped because the extracted project was actually a company/catalog title.";
  }

  return "";
}

export function searchPreviewSkipReason(result: SearchResult, config: SearchQueryConfig) {
  const preview = [result.title, result.snippet, result.url].join(" ");
  const titleAndUrl = [result.title, result.url].join(" ");
  const genericProductPage = /\b(supplier|stockist|trader|trading|distributor|manufacturer|catalog|catalogue|specification|datasheet|product range|products)\b/i.test(preview);
  const explicitBuyingEvent = /\b(tender|procurement|bid|rfq|rfi|awards?|awarded|wins?|secured?|contract|subcontract|purchase order|eprocurement|solicitation|prequalification)\b/i.test(preview);
  const genericArticle = /\b(shortage|crunch|market|forecast|price|prices|index|guide|how to|what is|what .*look|buyers look for|overview)\b/i.test(preview);
  const marketReportPage = /\b(market|forecast|analysis|insights?|report)\b/i.test(titleAndUrl) && !/\b(tender|bid|rfq|rfi|awards?|awarded|wins?|secured?|contract|purchase order)\b/i.test(titleAndUrl);
  const legalOrCrimeArticle = /\b(crime|jailed|illegal tender|fraud|bribery|corruption|court|sentenced|arrested|lawsuit)\b/i.test(preview);
  const proceduralDocument = /\b(tender instructions|bidding instructions|instructions to bidders|terms and conditions|general conditions|standard bidding|procurement manual|guidelines)\b/i.test(preview);
  const genericTenderListing = /\b(construction tenders and rfps|tenders and rfps|latest .*tenders|tender notices|tender alerts|procurement news|contract procurement news|category_tender|all-tender-list)\b/i.test(preview);
  const numberedProcurementNotice = /\/procurement(?:\/procurement-news)?\/\d+\b/i.test(preview) || /\bProcurement News Notice\s*-\s*\d+\b/i.test(preview);
  const materialProductOnly = /\b(boiler|vessel|tank|reactor|plate|plates|pipe|pipes|beam|beams|sheet|sheets|bar|bars|hollow section|rhs|shs|sa ?516|astm|api 5l)\b/i.test(preview) && !explicitBuyingEvent;
  const sourceFreshnessReason = sourceFreshnessSkipReason(result);
  const requestedRegions = regionTerms(config.country).filter((term) => term !== "global");
  const originalRegionText = (config.country ?? "").toLowerCase();
  const requestsGccRegion = /\bgcc\b|gulf/.test(originalRegionText);
  const requestsGcc = requestedRegions.some((term) => ["gcc", "gulf", "saudi", "uae", "qatar", "oman", "kuwait", "bahrain"].includes(term));
  const nonGccPublicSource = /\b(india|indian|railway|railways|karnataka|kerala|maharashtra|delhi|gem\.gov\.in|gov\.in|tenderkart\.in|east central railway|kavika)\b|\.in\//i.test(preview);
  const specificGccSignal = /\b(gulf|saudi|uae|qatar|oman|kuwait|bahrain|aramco|adnoc|qatarenergy|pdo|oq|dewa|etihadwe|bapco|knpc|swcc)\b/i.test(preview);
  const requestedSpecificRegion = requestsGccRegion ? undefined : requestedRegions.find((term) => ["uae", "abu dhabi", "dubai", "emirates", "oman", "muscat", "duqm", "sohar"].includes(term));
  const outsideRequestedSpecificRegion =
    Boolean(requestedSpecificRegion) &&
    /\b(turkey|turkish|botas|toscelik|india|indian|kuwait|bahrain|qatar|saudi|tenderboard\.gov\.bh|\.bh\/)\b/i.test(preview) &&
    !new RegExp(`\\b${escapeRegExp(requestedSpecificRegion!)}\\b`, "i").test(preview);

  if (requestsGcc && nonGccPublicSource && !specificGccSignal) {
    return "Source skipped before extraction because the search preview points outside the requested GCC market.";
  }

  if (outsideRequestedSpecificRegion) {
    return "Source skipped before extraction because the preview points outside the requested market.";
  }

  if (sourceFreshnessReason) {
    return sourceFreshnessReason;
  }

  if (config.requiredMatchTerms?.length && !matchesRequiredTerms(preview.toLowerCase(), config.requiredMatchTerms)) {
    return `Source skipped before extraction because the preview did not match the requested keyword/material terms: ${config.requiredMatchTerms.slice(0, 4).join(", ")}.`;
  }

  if (marketReportPage) {
    return "Market report/forecast page skipped before extraction because it does not identify a current buyer requirement.";
  }

  if (legalOrCrimeArticle) {
    return "Legal/crime article skipped before extraction because it does not identify a current buyer requirement.";
  }

  if (proceduralDocument) {
    return "Generic tender instruction/procedure document skipped before extraction because it does not identify a specific buyer requirement.";
  }

  if (genericTenderListing && !numberedProcurementNotice) {
    return "Generic tender listing/news page skipped before extraction because it does not identify a specific buyer requirement.";
  }

  if (genericProductPage && !explicitBuyingEvent) {
    return "Generic supplier/catalog page skipped before extraction because it did not show a buyer action, project, tender, or contract.";
  }

  if (materialProductOnly) {
    return "Generic material/specification page skipped before extraction because it did not show a buyer action, project, tender, or contract.";
  }

  if (genericArticle && !/\b(tender|bid|rfq|rfi|awards?|awarded|wins?|secured?|contract|purchase order)\b/i.test(preview)) {
    return "General market/article page skipped before extraction because it did not identify a buyer action, project, tender, or contract.";
  }

  return "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readDiscoveryRequest(request: Request): Promise<DiscoveryRunRequest> {
  try {
    return (await request.json()) as DiscoveryRunRequest;
  } catch {
    return {};
  }
}

export function buildSearchConfig(payload: DiscoveryRunRequest): SearchQueryConfig | undefined {
  const baseConfig = pipelineSearchTaxonomy.find((item) => item.enabled);
  if (!baseConfig) return undefined;

  const query = cleanText(payload.query);
  const regions = cleanStringList(payload.regions).slice(0, 3);
  const keywords = cleanStringList(payload.keywords).slice(0, 3);
  const discoveryPlay = discoveryPlayFromPayload(payload.playId);

  if (!query && regions.length === 0 && keywords.length === 0) {
    return baseConfig;
  }

  const locations = regions.length > 0 ? regions : [baseConfig.country ?? "global"];
  const intentTerms = keywords.length > 0 ? keywords : defaultIntentTermsForPlay(discoveryPlay.id);
  const strictProjectQuery = isSpecificProjectQuery(query) ? query : "";
  const materialTerms = materialQueryVariants([query, ...intentTerms].join(" "), locations);
  const buyerMaterialTerms = buyerMaterialQueryVariants([query, ...intentTerms].join(" "), locations);
  const requiredMatchTerms = strictProjectQuery ? distinctiveQueryTerms(strictProjectQuery) : requiredKeywordTerms([query, ...keywords].join(" "));
  const intentClassification = classifyDiscoveryIntent(query, regions, keywords, strictProjectQuery, requiredMatchTerms);
  const customQueries = strictProjectQuery
    ? [
        query,
        ...focusedQueryVariants(query, locations),
        ...playQueryVariants(query, locations, discoveryPlay.id, requiredMatchTerms),
        ...locations.flatMap((location) => [
          `"${query}" ${location}`,
          `"${query}" EPC award ${location}`,
          `"${query}" subcontractors ${location}`,
          `"${query}" procurement ${location}`,
        ]),
      ].filter(Boolean)
    : [
        query,
        ...focusedQueryVariants(query, locations),
        ...buyerMaterialTerms,
        ...playQueryVariants(query, locations, discoveryPlay.id, requiredMatchTerms),
        ...materialTerms,
        ...locations.flatMap((location) =>
          intentTerms.map((term) => `${term} ${location} buyer project tender procurement`),
        ),
      ].filter(Boolean);

  return {
    ...baseConfig,
    id: "custom-discovery-run",
    name: "Custom Discovery Run",
    country: locations.join(", "),
    keywordGroup: "custom",
    queryMode: strictProjectQuery ? "project" : "broad",
    strictProjectQuery: strictProjectQuery || undefined,
    requiredMatchTerms,
    intentClassification,
    discoveryPlay,
    queries: orchestrateDiscoveryQueries({ query, locations, keywords, discoveryPlay, requiredMatchTerms, strictProjectQuery, baseQueries: customQueries }),
  };
}

export function classifyDiscoveryIntent(query: string, regions: string[], keywords: string[], strictProjectQuery = "", requiredTerms: string[] = []) {
  const text = [query, ...keywords, ...regions].join(" ").toLowerCase();
  const materialTerms = materialTermsForQuery(text);
  const hasHistoricalIntent = /\b(archive|historical|history|past|completed|201[0-9]|202[0-3])\b/.test(text);
  const hasTenderIntent = /\b(tender|rfq|rfi|bid|solicitation|prequalification)\b/.test(text);
  const hasContractorIntent = /\b(contractor|contractors|subcontract|subcontracts|epc|package|awarded)\b/.test(text);

  if (hasHistoricalIntent) {
    return {
      mode: "historical_research" as const,
      strictness: "strict" as const,
      label: "Historical research",
      explanation: "Search is treated as research, and old/completed items are not promoted as fresh leads.",
      requiredTerms,
    };
  }

  if (strictProjectQuery) {
    return {
      mode: "exact_project" as const,
      strictness: "strict" as const,
      label: "Exact project search",
      explanation: "Only sources that match the named project phrase or distinctive project terms should become candidates.",
      requiredTerms,
    };
  }

  if (materialTerms.length > 0) {
    return {
      mode: "material_sourcing" as const,
      strictness: "balanced" as const,
      label: "Material sourcing search",
      explanation: "Search expands related material terms but still requires a buyer action, award, tender, project, or procurement signal.",
      requiredTerms: requiredTerms.length ? requiredTerms : materialTerms.slice(0, 6),
    };
  }

  if (hasTenderIntent) {
    return {
      mode: "tender_watch" as const,
      strictness: "balanced" as const,
      label: "Tender watch",
      explanation: "Search prioritizes active tender/procurement notices and rejects generic portals without a specific requirement.",
      requiredTerms,
    };
  }

  if (hasContractorIntent) {
    return {
      mode: "contractor_lookup" as const,
      strictness: "balanced" as const,
      label: "Contractor lookup",
      explanation: "Search looks for awarded EPCs, subcontractors, and package owners tied to a project or buyer event.",
      requiredTerms,
    };
  }

  return {
    mode: "broad_procurement" as const,
    strictness: "broad" as const,
    label: "Broad procurement search",
    explanation: "Search is broad, so results still need a specific company, project, requirement, tender, or award before they can be saved.",
    requiredTerms,
  };
}

function playQueryVariants(query: string, locations: string[], playId: DiscoveryPlayId, requiredTerms: string[]) {
  const locationTerms = locations.length > 0 ? locations : ["global"];
  const normalizedQuery = query.trim();
  const materialTerms = (requiredTerms.length ? requiredTerms : materialTermsForQuery(query)).slice(0, 4);
  const variants: string[] = [];

  switch (playId) {
    case "contractor_map":
      variants.push(
        ...locationTerms.flatMap((location) => [
          `"${normalizedQuery}" awarded contractor ${location}`,
          `"${normalizedQuery}" EPC contractor package ${location}`,
          `"${normalizedQuery}" subcontractors ${location}`,
          `"${normalizedQuery}" contract award scope ${location}`,
        ]),
      );
      break;
    case "project_owner":
      variants.push(
        ...locationTerms.flatMap((location) => [
          `"${normalizedQuery}" project owner ${location}`,
          `"${normalizedQuery}" client award ${location}`,
          `"${normalizedQuery}" developer procurement ${location}`,
          `"${normalizedQuery}" project tender ${location}`,
        ]),
      );
      break;
    case "tender_watch":
      variants.push(
        ...locationTerms.flatMap((location) => [
          `"${normalizedQuery}" tender ${location}`,
          `"${normalizedQuery}" RFQ ${location}`,
          `"${normalizedQuery}" procurement notice ${location}`,
          `"${normalizedQuery}" bid package ${location}`,
        ]),
      );
      break;
    case "decision_makers":
      variants.push(
        ...locationTerms.flatMap((location) => [
          `"${normalizedQuery}" procurement manager ${location}`,
          `"${normalizedQuery}" supply chain manager ${location}`,
          `"${normalizedQuery}" project director ${location}`,
          `"${normalizedQuery}" contracts manager ${location}`,
        ]),
      );
      break;
    case "material_package":
    default:
      variants.push(
        ...locationTerms.flatMap((location) =>
          (materialTerms.length ? materialTerms : [normalizedQuery]).flatMap((term) => [
            `"${term}" procurement package ${location}`,
            `"${term}" supply contract ${location}`,
            `"${term}" purchase order ${location}`,
            `"${term}" EPC material package ${location}`,
          ]),
        ),
      );
      break;
  }

  return variants.filter((item) => item.replace(/["\s]/g, "").length > 0);
}

function orchestrateDiscoveryQueries({
  query,
  locations,
  keywords,
  discoveryPlay,
  requiredMatchTerms,
  strictProjectQuery,
  baseQueries,
}: {
  query: string;
  locations: string[];
  keywords: string[];
  discoveryPlay: DiscoveryPlayConfig;
  requiredMatchTerms: string[];
  strictProjectQuery: string;
  baseQueries: string[];
}) {
  const terms = requiredMatchTerms.length ? requiredMatchTerms : materialTermsForQuery([query, ...keywords].join(" "));
  const primary = query.trim() || terms[0] || keywords[0] || "industrial procurement";
  const quotedPrimary = primary.includes(" ") ? `"${primary}"` : primary;
  const locationTerms = locations.length > 0 ? locations : ["global"];
  const buyers = strategicBuyerTerms(locationTerms).slice(0, 4);
  const materialTerms = materialTermsForQuery([query, ...keywords].join(" ")).slice(0, 4);
  const sourceAngles = locationTerms.flatMap((location) => [
    `${quotedPrimary} tender procurement ${location}`,
    `${quotedPrimary} RFQ bid package ${location}`,
    `${quotedPrimary} supply contract purchase order ${location}`,
    `${quotedPrimary} awarded contractor EPC scope ${location}`,
    `${quotedPrimary} project owner client award ${location}`,
    `${quotedPrimary} procurement notice requirement ${location}`,
  ]);
  const buyerAngles = buyers.flatMap((buyer) =>
    (materialTerms.length ? materialTerms : [primary]).flatMap((term) => [
      `"${term}" "${buyer}" tender procurement`,
      `"${term}" "${buyer}" supply contract`,
      `"${term}" "${buyer}" purchase order`,
    ]),
  ).slice(0, 6);
  const playAngles = playQueryVariants(primary, locationTerms, discoveryPlay.id, terms);
  const exactAngles = strictProjectQuery ? focusedQueryVariants(strictProjectQuery, locationTerms) : [];

  return prioritizeDiscoveryQueries([
    primary,
    ...exactAngles,
    ...sourceAngles,
    ...buyerAngles,
    ...playAngles,
    ...baseQueries,
  ], discoveryPlay.id);
}

function prioritizeDiscoveryQueries(queries: string[], playId: DiscoveryPlayId) {
  const limit = playId === "project_owner" ? 12 : playId === "material_package" || playId === "tender_watch" ? 16 : 12;
  const seen = new Set<string>();
  return queries
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((query) => {
      const key = query.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function discoveryPlayFromPayload(value: unknown): DiscoveryPlayConfig {
  const playId = typeof value === "string" && value in discoveryPlayConfigs ? value as DiscoveryPlayId : "material_package";
  return discoveryPlayConfigs[playId];
}

function defaultIntentTermsForPlay(playId: DiscoveryPlayId) {
  switch (playId) {
    case "project_owner":
      return ["project award", "owner procurement", "industrial project"];
    case "contractor_map":
      return ["EPC award", "awarded contractor", "subcontract package"];
    case "decision_makers":
      return ["procurement manager", "supply chain manager", "project director"];
    case "tender_watch":
      return ["tender", "RFQ", "procurement notice"];
    case "material_package":
    default:
      return ["material package", "industrial procurement", "supply contract"];
  }
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/[^\w\s,./&+-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "";
}

function cleanStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanText).filter(Boolean);
}

function distinctiveQueryTerms(query: string) {
  const weakTerms = new Set([
    "and",
    "the",
    "for",
    "with",
    "project",
    "plant",
    "power",
    "gas",
    "oil",
    "epc",
    "contract",
    "contracts",
    "contractor",
    "contractors",
    "subcontract",
    "subcontracts",
    "procurement",
    "tender",
    "tenders",
    "award",
    "awards",
    "combined",
    "cycle",
  ]);

  return Array.from(
    new Set(
      cleanText(query)
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.replace(/[^a-z0-9-]/g, ""))
        .filter((term) => term.length >= 3 && !weakTerms.has(term)),
    ),
  ).slice(0, 8);
}

function requiredKeywordTerms(query: string) {
  const materialTerms = materialTermsForQuery(query);
  if (materialTerms.length > 0) return materialTerms.slice(0, 6);
  return distinctiveQueryTerms(query).slice(0, 6);
}

function matchesRequiredTerms(haystack: string, terms: string[]) {
  const lower = haystack.toLowerCase();
  return terms.some((term) => {
    const normalizedTerm = cleanText(term).toLowerCase();
    if (!normalizedTerm) return false;
    if (lower.includes(normalizedTerm)) return true;

    const termWords = normalizedTerm.split(/\s+/).filter((word) => word.length >= 3);
    if (termWords.length === 0) return false;
    return termWords.every((word) => lower.includes(word));
  });
}

function isUsefulEntityName(value: string | undefined) {
  const normalized = cleanText(value).toLowerCase();
  if (normalized.length < 3) return false;

  const genericNames = new Set([
    "the",
    "epc",
    "project",
    "contract",
    "contracts",
    "contractor",
    "supplier",
    "procurement",
    "tender",
    "company",
    "consortium",
    "consortium including",
    "joint venture",
    "news",
    "source",
  ]);

  if (genericNames.has(normalized)) return false;
  if (/^(the|a|an)\s/.test(normalized)) return false;
  if (/^(consortium including|joint venture including)\b/.test(normalized)) return false;

  return /[a-z]/.test(normalized);
}

function sourceFreshnessSkipReason(result: SearchResult) {
  const currentYear = new Date().getUTCFullYear();
  const staleYear = staleHistoricalYear([result.publishedAt, result.title, result.url].filter(Boolean).join(" "), currentYear);
  if (!staleYear) return undefined;

  const preview = [result.title, result.snippet, result.url].join(" ");
  const hasFreshSignal = new RegExp(`\\b(${currentYear}|${currentYear - 1})\\b`).test(preview) || /\b(open|ongoing|current|active)\b/i.test(preview);
  if (hasFreshSignal) return undefined;

  return `Source skipped because it appears to describe an old/completed ${staleYear} opportunity, not a fresh buyer lead.`;
}

function hasStaleHistoricalYear(value: string) {
  return Boolean(staleHistoricalYear(value, new Date().getUTCFullYear()));
}

function staleHistoricalYear(value: string, currentYear: number) {
  const staleCutoff = currentYear - 2;
  const years = Array.from(value.matchAll(/\b(20\d{2})\b/g)).map((match) => Number(match[1]));
  return years.find((year) => year >= 2010 && year <= staleCutoff);
}

function isSpecificProjectQuery(query: string) {
  if (!query) return false;
  const lower = query.toLowerCase();

  const distinctiveTerms = distinctiveQueryTerms(query);
  const projectMarker = /\b(project|plant|development|expansion|facility|terminal|field|ccgt|combined cycle|gas turbine|subcontract|subcontracts|contractors?)\b/.test(lower);
  const namedProjectShape = distinctiveTerms.length >= 3 && /\b[A-Z][a-z0-9&-]+/.test(query);

  return projectMarker && (distinctiveTerms.length >= 3 || namedProjectShape);
}

function focusedQueryVariants(query: string, locations: string[]) {
  if (!query) return [];

  const lower = query.toLowerCase();
  const locationTerms = locations.length > 0 ? locations : ["global"];
  const variants: string[] = [];

  if (lower.includes("taweelah") || lower.includes("ccgt") || lower.includes("combined cycle") || lower.includes("gas turbine")) {
    variants.push(
      ...locationTerms.flatMap((location) => [
        `Taweelah C CCGT EPC contract ${location}`,
        `Taweelah C power plant subcontractors ${location}`,
        `Taweelah C combined cycle power plant EPC ${location}`,
        `Taweelah C gas turbine project procurement ${location}`,
      ]),
    );
  }

  if (lower.includes("subcontract")) {
    variants.push(
      ...locationTerms.flatMap((location) => [
        `${query} EPC contractor ${location}`,
        `${query} procurement ${location}`,
      ]),
    );
  }

  if (lower.includes("desalination")) {
    variants.push(
      ...locationTerms.flatMap((location) => [
        `desalination plant pipe tender ${location}`,
        `desalination project steel pipe procurement ${location}`,
        `water transmission desalination pipeline tender ${location}`,
        `desalination plant mechanical package procurement ${location}`,
      ]),
    );
  }

  if (lower.includes("hollow section") || lower.includes("hollow sections") || lower.includes("rhs") || lower.includes("shs")) {
    variants.push(
      ...locationTerms.flatMap((location) => [
        `structural hollow sections tender ${location}`,
        `RHS SHS steel procurement ${location}`,
        `hollow section steel supply contract ${location}`,
        `structural steel hollow sections RFQ ${location}`,
      ]),
    );
  }

  return variants;
}

const industrialMaterialFamilies = [
  {
    triggers: [
      "carbon steel pipe",
      "carbon steel pipes",
      "cs pipe",
      "cs pipes",
      "api 5l",
      "line pipe",
      "line pipes",
      "steel pipe",
      "steel pipes",
      "pipe",
      "pipes",
      "pipeline materials",
    ],
    terms: ["steel pipe", "API 5L line pipe", "line pipe", "pipeline materials", "pipe supply"],
  },
  {
    triggers: ["steel", "plate", "plates", "ms plate", "ss plate", "stainless", "alloy", "aluminum", "aluminium"],
    terms: ["steel plates", "MS plates", "SS plates", "alloy plates", "aluminium plates"],
  },
  {
    triggers: ["bar", "bars", "solid bar", "round bar", "flat bar"],
    terms: ["solid bars", "steel bars", "round bars", "flat bars"],
  },
  {
    triggers: ["hollow", "hollow section", "hollow sections", "rhs", "shs", "tube", "tubes"],
    terms: ["hollow sections", "RHS steel", "SHS steel", "structural tubes"],
  },
  {
    triggers: ["sheet", "sheets", "galvanized", "galvanised", "electroplated", "chequered", "checker plate"],
    terms: ["galvanized sheets", "electroplated sheets", "chequered plates", "steel sheets"],
  },
  {
    triggers: ["mesh", "wire mesh", "grating", "expanded metal"],
    terms: ["wire mesh", "steel mesh", "industrial grating", "expanded metal"],
  },
  {
    triggers: ["beam", "beams", "i beam", "h beam", "structural", "structural steel", "section"],
    terms: ["steel beams", "I beams", "H beams", "structural steel", "steel sections"],
  },
  {
    triggers: ["valve", "valves", "flange", "flanges", "gasket", "gaskets", "fitting", "fittings"],
    terms: ["valves", "flanges", "gaskets", "pipe fittings", "mechanical package"],
  },
] as const;

export function materialTermsForQuery(query: string) {
  const lower = query.toLowerCase();
  const matchedFamilies: Array<(typeof industrialMaterialFamilies)[number]> = [];
  const terms = new Set<string>();
  const isCarbonSteelPipeSearch = /\b(?:carbon steel|cs)\s+pipes?\b/.test(lower);

  industrialMaterialFamilies.forEach((family) => {
    if (family.triggers.some((trigger) => lower.includes(trigger))) {
      matchedFamilies.push(family);
    }
  });

  matchedFamilies.forEach((family) => terms.add(family.terms[0]));
  matchedFamilies.forEach((family) => family.terms.slice(1).forEach((term) => terms.add(term)));

  if (lower.includes("api 5l")) {
    const ordered = ["API 5L line pipe", "steel pipe", "line pipe"];
    return [...ordered, ...Array.from(terms).filter((term) => !ordered.includes(term))].slice(0, 8);
  }

  if (isCarbonSteelPipeSearch) {
    const ordered = ["carbon steel pipe", "steel pipe", "API 5L line pipe", "line pipe", "pipe supply", "pipeline materials"];
    return [...ordered, ...Array.from(terms).filter((term) => !ordered.includes(term) && !/plates?/i.test(term))].slice(0, 8);
  }

  if ((lower.includes("material") || lower.includes("materials") || lower.includes("product") || lower.includes("products")) && terms.size === 0) {
    ["steel pipes", "steel plates", "hollow sections", "steel beams", "galvanized sheets", "wire mesh"].forEach((term) => terms.add(term));
  }

  return Array.from(terms).slice(0, 8);
}

function strategicBuyerTerms(locations: string[]) {
  const locationText = locations.join(" ").toLowerCase();
  const buyers = new Set<string>();

  if (/\bgcc\b|gulf/.test(locationText)) {
    [
      "Saudi Aramco",
      "ADNOC",
      "QatarEnergy",
      "Petroleum Development Oman",
      "OQ",
      "Oman LNG",
      "DEWA",
      "EtihadWE",
      "Maaden",
      "SABIC",
      "Emirates Steel",
      "Emirates Global Aluminium",
    ].forEach((buyer) => buyers.add(buyer));
  }

  if (/saudi|riyadh|jeddah/.test(locationText)) {
    ["Saudi Aramco", "Maaden", "SABIC", "SWCC"].forEach((buyer) => buyers.add(buyer));
  }

  if (/oman/.test(locationText)) {
    ["Petroleum Development Oman", "OQ", "Oman LNG", "Oman Water", "ASYAD"].forEach((buyer) => buyers.add(buyer));
  }

  if (/uae|dubai|abu dhabi/.test(locationText)) {
    ["ADNOC", "DEWA", "EtihadWE", "Emirates Steel", "Emirates Global Aluminium"].forEach((buyer) => buyers.add(buyer));
  }

  if (/qatar|doha/.test(locationText)) {
    ["QatarEnergy", "Qatar Gas", "Qatar General Electricity and Water Corporation"].forEach((buyer) => buyers.add(buyer));
  }

  if (/kuwait/.test(locationText)) {
    ["KNPC", "Kuwait Oil Company", "Kuwait Petroleum Corporation"].forEach((buyer) => buyers.add(buyer));
  }

  if (/bahrain/.test(locationText)) {
    ["BAPCO", "Bapco Refining", "BAPCO UPSTREAM W.L.L"].forEach((buyer) => buyers.add(buyer));
  }

  return Array.from(buyers);
}

function materialQueryVariants(query: string, locations: string[]) {
  const locationTerms = locations.length > 0 ? locations : ["global"];
  const materialTerms = materialTermsForQuery(query);
  const buyerTerms = strategicBuyerTerms(locationTerms);
  const variants: string[] = [];

  if (materialTerms.length > 0) {
    variants.push(
      ...locationTerms.flatMap((location) =>
        [
          ...materialTerms.map((material) => `"${material}" tender ${location}`),
          ...materialTerms.map((material) => `"${material}" procurement ${location}`),
          ...materialTerms.map((material) => `"${material}" RFQ ${location}`),
          ...materialTerms.map((material) => `"${material}" EPC package ${location}`),
          ...materialTerms.map((material) => `"${material}" supply contract ${location}`),
        ],
      ),
    );
  }

  if (buyerTerms.length > 0 && materialTerms.length > 0) {
    variants.push(
      ...buyerTerms.flatMap((buyer) =>
        materialTerms.slice(0, 5).map((material) => `"${material}" "${buyer}" tender procurement`),
      ),
    );
  }

  if (materialTerms.length > 0) {
    variants.push(
      ...locationTerms.flatMap((location) => [
        `"mechanical package" industrial project procurement ${location}`,
        `"steel supply" oil gas project tender ${location}`,
        `"steel materials" petrochemical plant procurement ${location}`,
        `"steel materials" desalination project tender ${location}`,
        `"structural steel" power plant procurement ${location}`,
        `"pipe steel" port marine project procurement ${location}`,
      ]),
    );
  }

  return variants;
}

function buyerMaterialQueryVariants(query: string, locations: string[]) {
  const materialTerms = materialTermsForQuery(query).slice(0, 3);
  const buyerTerms = strategicBuyerTerms(locations).slice(0, 5);
  if (materialTerms.length === 0 || buyerTerms.length === 0) return [];

  return buyerTerms.flatMap((buyer) =>
    materialTerms.map((material) => `"${material}" "${buyer}" tender procurement`),
  ).slice(0, 5);
}

function isUnsupportedDiscoveryUrl(url: string) {
  const hostname = new URL(url).hostname.toLowerCase();
  const unsupportedDomains = ["linkedin.com", "facebook.com", "instagram.com", "tiktok.com", "x.com", "twitter.com", "youtube.com", "studocu.com"];
  const unsupportedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".zip"];
  return (
    unsupportedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) ||
    unsupportedExtensions.some((extension) => new URL(url).pathname.toLowerCase().endsWith(extension))
  );
}

function isPdfUrl(url: string) {
  return new URL(url).pathname.toLowerCase().endsWith(".pdf");
}

export function selectDiscoveryCandidates(results: SearchResult[], config: SearchQueryConfig, options: { includeRecoveryCandidates?: boolean } = {}) {
  const byUrl = new Map<string, SearchResult>();
  results.forEach((result) => {
    const url = normalizeUrl(result.url);
    if (!byUrl.has(url)) byUrl.set(url, { ...result, url });
  });

  const ranked = Array.from(byUrl.values())
    .map((result) => ({ result, sourceQuality: scoreSourceQuality(result, config) }))
    .filter((item) => item.sourceQuality.score > 0)
    .sort((a, b) => b.sourceQuality.score - a.sourceQuality.score);

  const limit = discoveryCandidateLimit(config) + (options.includeRecoveryCandidates ? recoveryCandidateLimit(config) : 0);
  const selected: typeof ranked = [];
  const selectedUrls = new Set<string>();
  const domainCounts = new Map<string, number>();
  const queryCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  const trySelect = (maxPerDomain: number, maxPerQuery: number, maxPerCategory: number) => {
    for (const item of ranked) {
      if (selected.length >= limit) return;
      const url = normalizeUrl(item.result.url);
      if (selectedUrls.has(url)) continue;
      const domain = item.result.sourceDomain || new URL(url).hostname;
      const query = item.result.query || "unknown";
      const category = item.sourceQuality.category || "General web result";
      if ((domainCounts.get(domain) ?? 0) >= maxPerDomain) continue;
      if ((queryCounts.get(query) ?? 0) >= maxPerQuery) continue;
      if ((categoryCounts.get(category) ?? 0) >= maxPerCategory) continue;
      selected.push(item);
      selectedUrls.add(url);
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
      queryCounts.set(query, (queryCounts.get(query) ?? 0) + 1);
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  };

  trySelect(1, 2, 3);
  trySelect(2, 3, 5);
  trySelect(3, 4, options.includeRecoveryCandidates ? limit : 8);

  return selected.map((item) => item.result);
}

function recoveryCandidateLimit(config: SearchQueryConfig) {
  switch (config.discoveryPlay?.id) {
    case "material_package":
    case "tender_watch":
      return 4;
    case "contractor_map":
      return 3;
    default:
      return 2;
  }
}

function discoveryCandidateLimit(config: SearchQueryConfig) {
  switch (config.discoveryPlay?.id) {
    case "contractor_map":
    case "material_package":
    case "tender_watch":
      return 8;
    default:
      return 6;
  }
}

function scoreSourceQuality(result: SearchResult, config: SearchQueryConfig) {
  const haystack = [result.title, result.snippet, result.url, result.sourceDomain].join(" ").toLowerCase();
  const matchedSignals: string[] = [];
  const regionMatches = regionTerms(config.country).filter((term) => term !== "global" && haystack.includes(term));
  let score = 0;
  let category = "General web result";

  const preferredSignals = [
    [
      "material/procurement source",
      [
        "carbon steel pipe",
        "carbon steel pipes",
        "cs pipe",
        "cs pipes",
        "api 5l",
        "line pipe",
        "line pipes",
        "steel pipe",
        "steel pipes",
        "pipe supply",
        "pipeline materials",
        "steel plate",
        "steel plates",
        "ms plate",
        "ss plate",
        "alloy plate",
        "aluminium plate",
        "aluminum plate",
        "solid bar",
        "solid bars",
        "hollow section",
        "hollow sections",
        "rhs",
        "shs",
        "chequered plate",
        "checker plate",
        "electroplated sheet",
        "galvanized sheet",
        "galvanised sheet",
        "wire mesh",
        "steel mesh",
        "steel beam",
        "steel beams",
        "i beam",
        "h beam",
        "structural steel",
        "steel supply",
        "material package",
        "mechanical package",
        "valve station",
        "metering station",
      ],
    ],
    ["tender/procurement portal", ["tender", "procurement portal", "eprocurement", "rfq", "rfi", "bid", "prequalification", "solicitation", "subcontract", "subcontracts", "subcontractor", "supply", "supplier"]],
    ["government/procurement source", [".gov", "ministry", "authority", "municipality", "public procurement"]],
    ["company announcement", ["press release", "news release", "announces", "awards", "awarded", "contract award"]],
    ["EPC/project news", ["epc contract", "epc contracts", "pipeline", "lng", "water transmission", "infrastructure project", "project award", "power plant", "combined cycle", "ccgt", "gas turbine", "power project"]],
  ] as const;

  preferredSignals.forEach(([label, terms]) => {
    const matched = terms.filter((term) => haystack.includes(term));
    if (matched.length > 0) {
      score += Math.min(3, matched.length + 1);
      if (category === "General web result") category = label;
      matchedSignals.push(...matched);
    }
  });

  const weakSignals = ["blog", "what is", "top ", "best ", "provider", "guide", "course", "services", "wikipedia", "youtube", "facebook", "instagram", "linkedin", "market size", "market analysis", "market report"];
  weakSignals.forEach((signal) => {
    if (haystack.includes(signal)) score -= 2;
  });

  if (haystack.includes("engineering procurement construction") && !haystack.includes("award") && !haystack.includes("tender")) {
    score -= 3;
  }
  if ((haystack.includes("supplier") || haystack.includes("directory")) && !haystack.includes("tender") && !haystack.includes("award") && !haystack.includes("procurement")) {
    score -= 4;
  }
  if (regionTerms(config.country).filter((term) => term !== "global").length > 0) {
    if (regionMatches.length > 0) {
      score += Math.min(6, regionMatches.length + 3);
      matchedSignals.push(...regionMatches);
    } else {
      score -= 6;
    }
  }

  const requestedTerms = [...regionTerms(config.country), ...config.queries.flatMap((query) => query.toLowerCase().split(/\s+/)).filter((term) => term.length > 4)];
  const requestedMatches = Array.from(new Set(requestedTerms)).filter((term) => haystack.includes(term));
  score += Math.min(4, requestedMatches.length);
  matchedSignals.push(...requestedMatches.slice(0, 8));

  return {
    score,
    category,
    matchedSignals: Array.from(new Set(matchedSignals)).slice(0, 10),
  };
}

function highConfidenceSourceRelevance(sourceQuality: ProcessedUrl["sourceQuality"]): RelevanceResult {
  return {
    relevance: "relevant",
    confidence: 0.75,
    reason: `Source matched high-confidence discovery signals: ${sourceQuality?.matchedSignals.slice(0, 4).join(", ") || "industrial procurement evidence"}.`,
  };
}

function contentFromSearchResult(result: SearchResult): ExtractedContent {
  return {
    url: normalizeUrl(result.url),
    title: result.title,
    markdown: [result.title, result.snippet].filter(Boolean).join("\n\n"),
    contentHash: `search-result:${normalizeUrl(result.url)}`,
    scrapedAt: new Date().toISOString(),
  };
}

function shouldUseFastSourceBackedExtraction(
  result: SearchResult,
  sourceQuality: ProcessedUrl["sourceQuality"],
  extraction: StructuredExtraction | null,
) {
  if (!extraction || actionabilitySkipReason(extraction) || extractionQualitySkipReason(extraction, result)) return false;

  const preview = [result.title, result.snippet, result.url].join(" ");
  const explicitPublicProcurement =
    /\b(tender|procurement|bid|rfq|rfi|contract award|awarded|wins?|secured?|purchase order)\b/i.test(preview) ||
    /tender|procurement|eprocurement|bid|rfq|rfi|award|contract/i.test(result.url);
  const strongMaterialMatch = (sourceQuality?.matchedSignals ?? []).some((signal) =>
    /pipe|plate|beam|hollow|steel|flange|valve|mesh|sheet|material/i.test(signal),
  );

  return explicitPublicProcurement && strongMaterialMatch && (sourceQuality?.score ?? 0) >= 12;
}

async function extractContentOrSearchSnippet(extractor: ContentExtractor, result: SearchResult, sourceQuality: ProcessedUrl["sourceQuality"]): Promise<ExtractedContent> {
  try {
    return await extractWithRetry(extractor, normalizeUrl(result.url));
  } catch (error) {
    if ((sourceQuality?.score ?? 0) < 7 || !result.snippet || result.snippet.length < 80) {
      throw error;
    }

    return {
      url: normalizeUrl(result.url),
      title: result.title,
      markdown: [result.title, result.snippet].filter(Boolean).join("\n\n"),
      contentHash: `search-snippet:${normalizeUrl(result.url)}`,
      scrapedAt: new Date().toISOString(),
    };
  }
}

async function classifyWithFallback(aiProvider: AIProvider, content: ExtractedContent, sourceQuality: ProcessedUrl["sourceQuality"]): Promise<RelevanceResult> {
  if ((sourceQuality?.score ?? 0) >= 8) {
    return highConfidenceSourceRelevance(sourceQuality);
  }

  try {
    return await runAiWithRetry(() => aiProvider.classifyIndustrialRelevance(content));
  } catch (error) {
    if ((sourceQuality?.score ?? 0) >= 6 && isRecoverableProcessingError(error instanceof Error ? sanitizeProcessingError(error.message) : String(error))) {
      return highConfidenceSourceRelevance(sourceQuality);
    }
    throw error;
  }
}

async function extractSignalWithFallback(
  aiProvider: AIProvider,
  content: ExtractedContent,
  result: SearchResult,
  config: SearchQueryConfig,
  sourceQuality: ProcessedUrl["sourceQuality"],
) {
  const fallback = buildSourceBackedExtraction(content, result, config, sourceQuality);
  try {
    const aiExtraction = runAiWithRetry(() => aiProvider.extractStructuredSignal(content))
      .then((extraction) => withAwardedContractorFallback(extraction, content));

    if (fallback && !actionabilitySkipReason(fallback) && !extractionQualitySkipReason(fallback, result)) {
      const resultOrTimeout = await Promise.race([
        aiExtraction,
        sleep(12_000).then(() => fallback),
      ]);
      return resultOrTimeout;
    }

    return await aiExtraction;
  } catch (error) {
    const message = error instanceof Error ? sanitizeProcessingError(error.message) : String(error);
    if (isRecoverableProcessingError(message)) {
      const repairedContent = repairExtractionContent(content, result, config, sourceQuality);
      if (repairedContent.markdown !== content.markdown) {
        try {
          return await runAiWithRetry(() => aiProvider.extractStructuredSignal(repairedContent))
            .then((extraction) => withAwardedContractorFallback(extraction, repairedContent));
        } catch {
          // Continue to source-backed fallback below.
        }
      }
    }
    if (fallback && !actionabilitySkipReason(fallback)) {
      return fallback;
    }
    if (isRecoverableProcessingError(message)) {
      throw new Error(message);
    }
    throw error;
  }
}

function repairExtractionContent(
  content: ExtractedContent,
  result: SearchResult,
  config: SearchQueryConfig,
  sourceQuality: ProcessedUrl["sourceQuality"],
): ExtractedContent {
  const sourceText = [content.title, result.title, result.snippet, result.query, content.markdown].filter(Boolean).join("\n");
  const terms = Array.from(new Set([
    ...config.queries.flatMap((query) => query.split(/\s+/)).filter((term) => term.replace(/["']/g, "").length >= 4),
    ...(config.requiredMatchTerms ?? []),
    ...(sourceQuality?.matchedSignals ?? []),
    "tender",
    "procurement",
    "award",
    "contract",
    "scope",
    "package",
    "buyer",
    "owner",
    "contractor",
    "supply",
  ].map((term) => term.toLowerCase().replace(/["']/g, "").trim()).filter(Boolean))).slice(0, 60);
  const sentences = sourceText
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const ranked = sentences
    .map((sentence, index) => {
      const lower = sentence.toLowerCase();
      const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
      return { sentence, index, score };
    })
    .filter((item) => item.score > 0 || item.index < 3)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 28)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);
  const repairedMarkdown = [
    result.title,
    result.snippet,
    "Source class: " + (sourceQuality?.category ?? "unknown"),
    "Matched signals: " + ((sourceQuality?.matchedSignals ?? []).join(", ") || "none"),
    ...ranked,
  ].filter(Boolean).join("\n\n").slice(0, 9000);

  return {
    ...content,
    markdown: repairedMarkdown || content.markdown.slice(0, 9000),
    contentHash: content.contentHash + ":repair",
  };
}
function buildSourceBackedExtraction(
  content: ExtractedContent,
  result: SearchResult,
  config: SearchQueryConfig,
  sourceQuality: ProcessedUrl["sourceQuality"],
): StructuredExtraction | null {
  const text = [content.title, content.markdown, result.title, result.snippet, result.query].filter(Boolean).join("\n");
  const compactText = text.replace(/\s+/g, " ").trim();
  if (!isEligibleForSourceBackedFallback(compactText, result, sourceQuality)) return null;

  const contractors = extractAwardedContractorsFromText(compactText);
  const companies = extractBuyerCompanies(compactText, result, config, contractors);
  const projectName = extractProjectName(compactText, result);
  const requirements = extractMaterialRequirements(compactText);

  if (companies.length === 0 && contractors.length === 0) return null;

  const extraction: StructuredExtraction = {
    relevant: true,
    companies: companies.length > 0 ? companies : contractors.slice(0, 1).map((contractor) => ({ name: contractor.name, country: contractor.country })),
    awardedContractors: contractors,
    requirements,
    signalType: inferSignalType(compactText),
    confidence: Math.min(0.78, Math.max(0.52, ((sourceQuality?.score ?? 5) / 14))),
  };

  if (projectName) {
    extraction.project = {
      name: projectName,
      country: inferCountry(compactText, config.country),
    };
  }

  if (/tender|rfq|rfi|bid|solicitation|prequalification/i.test(compactText)) {
    extraction.tender = {
      title: projectName ? `${projectName} procurement` : cleanTitle(result.title || content.title || "Industrial procurement notice"),
      country: inferCountry(compactText, config.country),
      status: "Source-backed public notice",
    };
  }

  return extraction;
}

function hasBuyingEventSignal(text: string) {
  return /\b(award(?:ed|s)?|contract(?:ed|s)?|tender|procurement|rfq|rfi|bid|solicitation|prequalification|subcontract(?:or|s)?|supply contract|purchase order|epc|package)\b/i.test(text);
}

function isEligibleForSourceBackedFallback(text: string, result: SearchResult, sourceQuality: ProcessedUrl["sourceQuality"]) {
  const url = result.url.toLowerCase();
  const titleAndSnippet = [result.title, result.snippet].join(" ");
  const strongSource =
    /tender|procurement|eprocurement|bid|rfq|rfi|news|press|award|contract|project/i.test(url) ||
    /tender|procurement|bid|rfq|rfi|awards?|awarded|contract|subcontract|project/i.test(titleAndSnippet) ||
    sourceQuality?.category === "government/procurement source" ||
    sourceQuality?.category === "company announcement" ||
    sourceQuality?.category === "EPC/project news";

  const genericSupplier =
    /\b(supplier|stockist|trader|trading|distributor|manufacturer|catalog|catalogue)\b/i.test(titleAndSnippet) &&
    !/\b(tender|procurement|bid|rfq|rfi|awards?|awarded|contract|subcontract|purchase order)\b/i.test(titleAndSnippet);

  return strongSource && !genericSupplier && hasBuyingEventSignal(text);
}

function extractBuyerCompanies(
  text: string,
  result: SearchResult,
  config: SearchQueryConfig,
  contractors: NonNullable<StructuredExtraction["awardedContractors"]>,
) {
  const contractorNames = new Set(contractors.map((contractor) => contractor.name.toLowerCase()));
  const candidates = [
    ...strategicBuyerTerms(regionTerms(config.country)),
    "ADNOC",
    "ADNOC Gas",
    "ADNOC LNG",
    "Saudi Aramco",
    "Aramco",
    "QatarEnergy",
    "Petroleum Development Oman",
    "PDO",
    "OQ",
    "Oman LNG",
    "DEWA",
    "EtihadWE",
    "Maaden",
    "SABIC",
    "SWCC",
    "KNPC",
    "BAPCO",
    "Bapco Refining",
    "BAPCO UPSTREAM W.L.L",
  ];

  const companies = new Map<string, { name: string; country?: string }>();
  candidates.forEach((name) => {
    if (contractorNames.has(name.toLowerCase())) return;
    if (text.toLowerCase().includes(name.toLowerCase())) {
      companies.set(name.toLowerCase(), { name, country: inferCountry(text, config.country) });
    }
  });

  const awardOwner =
    text.match(/\b([A-Z][A-Za-z0-9&.' -]{2,60}?)\s+(?:awards?|awarded|appoints?|selected|signs)\b/) ??
    result.title.match(/\b([A-Z][A-Za-z0-9&.' -]{2,60}?)\s+(?:awards?|awarded|appoints?|selected|signs)\b/);

  const ownerName = awardOwner?.[1]?.trim();
  if (ownerName && isLikelyCompanyName(ownerName) && !contractorNames.has(ownerName.toLowerCase())) {
    companies.set(ownerName.toLowerCase(), { name: ownerName, country: inferCountry(text, config.country) });
  }

  const acronymBuyer = text.match(/\b([A-Z]{3,10})\s+(?:contract|tender|procurement)\b/);
  const acronymName = acronymBuyer?.[1]?.trim();
  if (acronymName && !contractorNames.has(acronymName.toLowerCase())) {
    companies.set(acronymName.toLowerCase(), { name: acronymName, country: inferCountry(text, config.country) });
  }

  return Array.from(companies.values()).slice(0, 3);
}

function extractProjectName(text: string, result: SearchResult) {
  const candidates = [
    text.match(/\b(?:project|development|programme|program|plant|pipeline|package)\s+(?:called|named|for)?\s*([A-Z][A-Za-z0-9&,.()' -]{8,120})/i)?.[1],
    text.match(/\b([A-Z][A-Za-z0-9&,.()' -]{8,120}?\s+(?:project|development|programme|program|plant|pipeline|package|terminal|facility|expansion))\b/i)?.[1],
    result.title,
  ];

  const selected = candidates
    .map((item) => cleanTitle(item ?? ""))
    .find((item) => item.length >= 8 && !/^(latest|news|tenders?|procurement|epc contract procurement)/i.test(item));

  return selected?.slice(0, 140);
}

function extractMaterialRequirements(text: string) {
  const terms = materialTermsForQuery(text);
  return terms.slice(0, 5).map((term) => ({
    productCategory: term,
    productType: term,
    specification: `Source/search context mentions ${term} in an industrial procurement or project signal.`,
    confidence: 0.55,
  }));
}

function inferSignalType(text: string): StructuredExtraction["signalType"] {
  if (/\baward(?:ed|s)?|contract award|epc contract/i.test(text)) return "EPC_AWARD";
  if (/\btender|rfq|rfi|bid|solicitation|prequalification/i.test(text)) return "TENDER_RELEASED";
  if (/\bprocurement|purchase order|supply contract|material package|mechanical package/i.test(text)) return "PROCUREMENT_REQUIREMENT";
  if (/\bexpansion|development|capex|investment/i.test(text)) return "EXPANSION";
  return "COMPANY_NEWS";
}

function inferCountry(text: string, fallback?: string) {
  const lower = text.toLowerCase();
  const matches: Array<[RegExp, string]> = [
    [/\bsaudi|aramco|riyadh|jeddah\b/, "Saudi Arabia"],
    [/\buae|abu dhabi|dubai|emirates|adnoc|dewa|etihadwe|taweelah\b/, "UAE"],
    [/\boman|muscat|duqm|sohar|pdo|oq\b/, "Oman"],
    [/\bqatar|qatarenergy|doha\b/, "Qatar"],
    [/\bkuwait\b/, "Kuwait"],
    [/\bbahrain\b/, "Bahrain"],
  ];
  const match = matches.find(([pattern]) => pattern.test(lower));
  if (match) return match[1];
  return fallback?.split(",")[0]?.trim();
}

function cleanTitle(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s[-|]\s[^-|]{2,40}$/g, "")
    .trim();
}

function regionTerms(country?: string) {
  const rawTerms = (country ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const expansions: Record<string, string[]> = {
    gcc: ["gcc", "gulf", "saudi", "uae", "qatar", "oman", "kuwait", "bahrain"],
    "north america": ["north america", "usa", "united states", "canada", "mexico"],
    canada: ["canada", "british columbia", "alberta", "ontario"],
    "saudi arabia": ["saudi", "saudi arabia", "riyadh", "jeddah", "aramco"],
    uae: ["uae", "abu dhabi", "dubai", "emirates", "taweelah"],
    "south america": ["south america", "brazil", "argentina", "chile", "peru", "colombia"],
  };

  return Array.from(new Set(rawTerms.flatMap((term) => expansions[term] ?? [term])));
}

function regionFitReason(extraction: unknown, config: SearchQueryConfig) {
  const terms = regionTerms(config.country);
  if (terms.length === 0 || terms.includes("global")) return "";

  const serialized = JSON.stringify(extraction).toLowerCase();
  const hasRegionMatch = terms.some((term) => serialized.includes(term));
  return hasRegionMatch ? "" : `Skipped because extracted company/project did not match requested region: ${config.country}.`;
}

function withAwardedContractorFallback(extraction: StructuredExtraction, content: ExtractedContent): StructuredExtraction {
  if (extraction.awardedContractors?.length) return extraction;

  const text = [content.title, content.markdown].filter(Boolean).join("\n");
  const contractors = extractAwardedContractorsFromText(text);
  if (contractors.length === 0) return extraction;

  return {
    ...extraction,
    awardedContractors: contractors,
  };
}

function extractAwardedContractorsFromText(text: string): NonNullable<StructuredExtraction["awardedContractors"]> {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => /award|awarded|appoint|appointed|select|selected|contract|subcontract|epc/i.test(sentence))
    .slice(0, 10);

  const names = new Map<string, NonNullable<StructuredExtraction["awardedContractors"]>[number]>();

  for (const sentence of sentences) {
    const match =
      sentence.match(/\b(?:awards?|awarded|appoints?|appointed|selects?|selected|signed|granted)\b.{0,180}?\b(?:to|with)\s+([^.;:]+)/i) ??
      sentence.match(/\b(?:contractors?|subcontractors?|epc contractors?|awardees?)\b.{0,80}?\b(?:include|are|were)\s+([^.;:]+)/i) ??
      sentence.match(/\b([A-Z][A-Za-z0-9&.' -]{2,70}?)\s+(?:wins?|secures?|lands?)\b.{0,140}?\bcontract\b/i);

    if (!match?.[1]) continue;

    splitContractorNames(match[1]).forEach((name) => {
      if (/^smes?$/i.test(name)) return;
      if (!isLikelyCompanyName(name) || names.has(name.toLowerCase())) return;
      names.set(name.toLowerCase(), {
        name,
        role: /subcontract/i.test(sentence) ? "Subcontractor" : /epc/i.test(sentence) ? "EPC contractor" : "Awarded contractor",
        scope: cleanContractorScope(sentence),
        confidence: 0.65,
      });
    });
  }

  return Array.from(names.values()).slice(0, 5);
}

function splitContractorNames(value: string) {
  const cleaned = value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:for|under|on|as part of|covering|worth)\b[\s\S]*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .split(/\s*,\s*|\s+and\s+|&/)
    .map((item) => item.replace(/^(?:the|a|an)\s+/i, "").replace(/[^A-Za-z0-9.' -]/g, "").trim())
    .filter((item) => item.length >= 3 && item.length <= 70 && /[A-Z]/.test(item))
    .filter((item) => !/^(contracts?|project|package|work|scope|company|development)$/i.test(item))
    .slice(0, 5);
}

function isLikelyCompanyName(value: string) {
  if (value.split(/\s+/).length > 6) return false;
  if (/^(all|scope|work|services|package|project|included|provided)\b/i.test(value)) return false;
  if (/^(smes?|companies|contractors?|suppliers?|bidders?|vendors?)$/i.test(value)) return false;
  if (!/[A-Z][a-z]+|[A-Z]{2,}/.test(value)) return false;
  return true;
}

function cleanContractorScope(sentence: string) {
  return sentence
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

async function extractWithRetry(extractor: ContentExtractor, url: string): Promise<ExtractedContent> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 1; attempt += 1) {
    try {
      return await extractor.extract(url);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Source extraction failed");
}

async function runAiWithRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (!message.includes("429") && !message.includes("rate limit") && !message.includes("json_validate_failed") && !message.includes("failed to validate json")) {
        break;
      }
      await sleep(1_500 + attempt * 1_500);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("AI extraction failed");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeProcessingError(message: string) {
  if (message.includes("429") || message.toLowerCase().includes("rate limit")) {
    return "Extraction service is busy. Retry this source in a moment; no candidate was saved without confirmed structured fields.";
  }

  if (message.toLowerCase().includes("fetch failed") || message.includes("SEC_E_NO_CREDENTIALS")) {
    return "Live discovery could not reach the external search or content service from this environment. Check network/TLS access and provider keys, then run again.";
  }

  if (message.includes("401") || message.toLowerCase().includes("unauthorized") || message.toLowerCase().includes("authentication")) {
    return "Live discovery provider authentication failed. Check the configured provider key, then run again.";
  }

  if (message.includes("403")) {
    return "Live discovery provider access was denied. Check provider account permissions or quota, then run again.";
  }

  if (
    message.includes("400") ||
    message.includes("invalid_type") ||
    message.toLowerCase().includes("invalid_request_error") ||
    message.includes("Invalid input") ||
    message.toLowerCase().includes("json_validate_failed") ||
    message.toLowerCase().includes("failed to validate json") ||
    message.toLowerCase().includes("no json object") ||
    message.toLowerCase().includes("unexpected structured data")
  ) {
    return "Source found, but structured extraction needs a retry. No candidate was saved until company, project, and requirement fields are confirmed.";
  }

  if (message.toLowerCase().includes("timeout") || message.toLowerCase().includes("operation was aborted")) {
    return "Source found, but the provider timed out before extraction finished. Retry this source or narrow the search terms.";
  }

  return message
    .replaceAll("SerpApi", "Search provider")
    .replaceAll("serpapi", "search provider")
    .replaceAll("Firecrawl", "Content provider")
    .replaceAll("firecrawl", "content provider")
    .replaceAll("Groq", "AI provider")
    .replaceAll("groq", "AI provider")
    .replaceAll("Gemini", "AI provider")
    .replaceAll("gemini", "AI provider")
    .replaceAll("OpenAI", "AI provider")
    .replaceAll("openai", "AI provider")
    .replaceAll("SUPABASE", "DATABASE")
    .replaceAll("supabase", "database")
    .replaceAll("GROQ", "AI")
    .replaceAll("GEMINI", "AI")
    .replaceAll("OPENAI", "AI");
}

function isRecoverableProcessingError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("extraction service is busy") ||
    lower.includes("structured extraction needs a retry") ||
    lower.includes("provider timed out") ||
    lower.includes("timed out") ||
    lower.includes("operation was aborted") ||
    lower.includes("could not reach") ||
    lower.includes("network/tls") ||
    lower.includes("source found") ||
    lower.includes("retry")
  );
}



