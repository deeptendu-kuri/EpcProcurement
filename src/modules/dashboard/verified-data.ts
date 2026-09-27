import { calculateBuyerScore } from "@/modules/scoring/buyer-scoring";
import type {
  BuyerOpportunity,
  Company,
  DecisionMaker,
  ProductRequirement,
  Project,
  Signal,
  SourceEvidence,
  Tender,
} from "@/types/domain";

const sources: SourceEvidence[] = [
  {
    id: "source-mexico-pacific-sierra-madre",
    url: "https://mexicopacific.com/press-release-mexico-pacific-awards-sierra-madre-pipeline-epc-contract-to-gdi-sicim-pipelines-and-bonatti",
    domain: "mexicopacific.com",
    sourceType: "Company announcement",
    reliability: "Very High",
    title: "Mexico Pacific awards Sierra Madre Pipeline EPC contract to GDI Sicim Pipelines and Bonatti",
  },
  {
    id: "source-mexico-pacific-ceo-nelly-molina",
    url: "https://mexicopacific.com/mexico-pacific-lng-appoints-manuela-nelly-molina-as-chief-executive-officer/",
    domain: "mexicopacific.com",
    sourceType: "Company announcement",
    reliability: "Very High",
    title: "Mexico Pacific LNG appoints Manuela (Nelly) Molina as Chief Executive Officer",
  },
  {
    id: "source-mexico-pacific-linkedin",
    url: "https://www.linkedin.com/company/mexico-pacific-limited",
    domain: "linkedin.com",
    sourceType: "Company profile",
    reliability: "High",
    title: "Mexico Pacific LinkedIn company profile",
  },
  {
    id: "source-faith-parker-linkedin",
    url: "https://www.linkedin.com/in/faith-parker",
    domain: "linkedin.com",
    sourceType: "Professional profile",
    reliability: "High",
    title: "Faith Parker, CPA - Mexico Pacific Limited",
  },
  {
    id: "source-percival-cleetus-linkedin",
    url: "https://www.linkedin.com/in/percival-cleetus-179181113",
    domain: "linkedin.com",
    sourceType: "Professional profile",
    reliability: "High",
    title: "Percival Cleetus - Mexico Pacific",
  },
  {
    id: "source-lng-canada-procurement",
    url: "https://www.lngcanada.ca/opportunities/contracting-procurement/",
    domain: "lngcanada.ca",
    sourceType: "Company procurement page",
    reliability: "Very High",
    title: "LNG Canada contracting and procurement opportunities",
  },
  {
    id: "source-coastal-gaslink-phase-2",
    url: "https://www.tcenergy.com/newsroom/statements/2026/coastal-gaslink-phase-2-advances-step-forward-with-new-commercial-agreements/",
    domain: "tcenergy.com",
    sourceType: "Company statement",
    reliability: "Very High",
    title: "Coastal GasLink Phase 2 advances with commercial agreements",
  },
  {
    id: "source-dewa-gre-water-pipeline-award",
    url: "https://dewa.gov.ae/en/about-us/media-publications/latest-news/2025/12/dewa-awards-major-contract",
    domain: "dewa.gov.ae",
    sourceType: "Utility contract award",
    reliability: "Very High",
    title: "DEWA awards major contract for GRE water pipelines in Dubai",
  },
  {
    id: "source-etihadwe-water-pipeline-tender",
    url: "https://guest.meed.com/etihadwe-tenders-water-storage-and-pipeline-project/",
    domain: "meed.com",
    sourceType: "EPC tender news",
    reliability: "High",
    title: "EtihadWE tenders water storage and DN1000 pipeline project",
  },
];

const companies: Company[] = [
  {
    id: "mexico-pacific",
    canonicalName: "Mexico Pacific",
    domain: "mexicopacific.com",
    industry: "Oil & Gas",
    subIndustry: "LNG / Gas Pipeline Development",
    country: "Mexico",
    region: "North America",
    city: "Puerto Libertad, Sonora",
    employeeCount: 180,
    employeeRange: "51-200",
    description:
      "Mexico Pacific surfaced in live discovery from a company announcement describing EPC contracts for the Sierra Madre Pipeline project.",
    lastUpdatedAt: "2026-08-27T08:10:00Z",
    lastSignalAt: "2026-08-27T08:10:00Z",
  },
  {
    id: "lng-canada",
    canonicalName: "LNG Canada",
    domain: "lngcanada.ca",
    industry: "Oil & Gas",
    subIndustry: "LNG / Operations Procurement",
    country: "Canada",
    region: "North America",
    city: "Kitimat, British Columbia",
    employeeCount: 450,
    employeeRange: "201-500",
    description:
      "LNG Canada has an active contracting and procurement page with upcoming bid/RFP guidance and operations contract opportunities.",
    lastUpdatedAt: "2026-09-08T00:00:00Z",
    lastSignalAt: "2026-06-02T00:00:00Z",
  },
  {
    id: "tc-energy-coastal-gaslink",
    canonicalName: "TC Energy / Coastal GasLink",
    domain: "tcenergy.com",
    industry: "Oil & Gas",
    subIndustry: "Gas Pipeline Infrastructure",
    country: "Canada",
    region: "North America",
    city: "British Columbia",
    employeeCount: 7000,
    employeeRange: "500+",
    description:
      "TC Energy announced commercial agreements advancing Coastal GasLink Phase 2, including FEED and execution activities that would follow subject to approvals.",
    lastUpdatedAt: "2026-09-08T00:00:00Z",
    lastSignalAt: "2026-03-25T00:00:00Z",
  },
  {
    id: "dewa",
    canonicalName: "Dubai Electricity and Water Authority",
    domain: "dewa.gov.ae",
    industry: "Utilities",
    subIndustry: "Water Infrastructure",
    country: "UAE",
    region: "GCC",
    city: "Dubai",
    employeeCount: 12000,
    employeeRange: "500+",
    description:
      "DEWA awarded a major contract for GRE water pipeline supply, installation, testing, commissioning, diversion, and protection works in Dubai.",
    lastUpdatedAt: "2026-09-08T00:00:00Z",
    lastSignalAt: "2025-12-24T00:00:00Z",
  },
  {
    id: "etihadwe",
    canonicalName: "Etihad Water & Electricity",
    domain: "etihadwe.ae",
    industry: "Utilities",
    subIndustry: "Water Transmission",
    country: "UAE",
    region: "GCC",
    city: "Northern Emirates",
    employeeCount: 2500,
    employeeRange: "500+",
    description:
      "EtihadWE tender activity includes water storage and DN1000 ductile iron transmission pipeline scope in the Northern Emirates.",
    lastUpdatedAt: "2026-09-08T00:00:00Z",
    lastSignalAt: "2026-06-22T00:00:00Z",
  },
];

const projects: Project[] = [
  {
    id: "sierra-madre-pipeline",
    companyId: "mexico-pacific",
    name: "Sierra Madre Pipeline Project",
    projectType: "Natural Gas Pipeline",
    country: "Mexico",
    location: "Puerto Libertad, Sonora, Mexico",
    stage: "EPC contract awarded",
    description:
      "The live intelligence pipeline identified a Sierra Madre Pipeline EPC award involving Mexico Pacific, GDI Sicim Pipelines, and Bonatti.",
    confidence: 0.95,
  },
  {
    id: "lng-canada-operations-procurement",
    companyId: "lng-canada",
    name: "LNG Canada Operations Procurement",
    projectType: "LNG operations procurement",
    country: "Canada",
    location: "Kitimat, British Columbia, Canada",
    stage: "Upcoming bids and supplier registration active",
    description:
      "LNG Canada publishes contracting and procurement guidance, supplier registration, upcoming contract scopes, and recently awarded operations contracts.",
    confidence: 0.88,
  },
  {
    id: "coastal-gaslink-phase-2",
    companyId: "tc-energy-coastal-gaslink",
    name: "Coastal GasLink Phase 2",
    projectType: "Natural Gas Pipeline Expansion",
    country: "Canada",
    location: "British Columbia, Canada",
    stage: "Commercial agreements / pre-FID development",
    description:
      "Commercial agreements establish a framework for advancing FEED and execution activities for CGL Phase 2, subject to FID and approvals.",
    confidence: 0.86,
  },
  {
    id: "dewa-gre-water-pipelines",
    companyId: "dewa",
    name: "Dubai GRE Water Pipeline Protection and Diversion Works",
    projectType: "Water Pipeline Infrastructure",
    country: "UAE",
    location: "Dubai, UAE",
    stage: "Contract awarded",
    description:
      "DEWA awarded a contract for supply, installation, testing, and commissioning of GRE water pipelines and associated network works.",
    confidence: 0.9,
  },
  {
    id: "etihadwe-madam-fujairah-water-pipeline",
    companyId: "etihadwe",
    name: "Madam Water Tank and Fujairah DN1000 Pipeline",
    projectType: "Water Transmission Pipeline",
    country: "UAE",
    location: "Madam, Sharjah / Fujairah, UAE",
    stage: "Tender released",
    description:
      "EtihadWE invited bids for a water tank scope that includes a DN1000 ductile iron transmission pipeline in Fujairah.",
    confidence: 0.82,
  },
];

const tenders: Tender[] = [];
const requirements: ProductRequirement[] = [
  {
    id: "requirement-dewa-gre-water-pipe",
    companyId: "dewa",
    projectId: "dewa-gre-water-pipelines",
    sourceId: "source-dewa-gre-water-pipeline-award",
    productCategory: "Water pipeline materials",
    productType: "GRE water pipeline",
    material: "Glass-reinforced epoxy",
    specification: "Supply, installation, testing, commissioning, diversion, protection works, and water network connections",
    confidence: 0.9,
  },
  {
    id: "requirement-etihadwe-dn1000-ductile-iron",
    companyId: "etihadwe",
    projectId: "etihadwe-madam-fujairah-water-pipeline",
    sourceId: "source-etihadwe-water-pipeline-tender",
    productCategory: "Water transmission pipeline",
    productType: "Ductile iron pipeline",
    diameter: "DN1000",
    specification: "Transmission pipeline serving the proposed water storage tank scope",
    confidence: 0.82,
  },
];

const signals: Signal[] = [
  {
    id: "signal-sierra-madre-epc-award",
    companyId: "mexico-pacific",
    projectId: "sierra-madre-pipeline",
    sourceId: "source-mexico-pacific-sierra-madre",
    signalType: "EPC_AWARD",
    signalStrength: 82,
    signalDate: "2026-08-27",
    confidence: 0.95,
    summary:
      "The live intelligence pipeline identified an EPC contract award for the Sierra Madre Pipeline. Product specifications were not detected in the verified source.",
  },
  {
    id: "signal-lng-canada-procurement",
    companyId: "lng-canada",
    projectId: "lng-canada-operations-procurement",
    sourceId: "source-lng-canada-procurement",
    signalType: "PROCUREMENT_REQUIREMENT",
    signalStrength: 74,
    signalDate: "2026-09-08",
    confidence: 0.88,
    summary:
      "LNG Canada publishes supplier registration and upcoming procurement scope guidance, indicating active contracting workflows for operations and project support.",
  },
  {
    id: "signal-coastal-gaslink-phase-2",
    companyId: "tc-energy-coastal-gaslink",
    projectId: "coastal-gaslink-phase-2",
    sourceId: "source-coastal-gaslink-phase-2",
    signalType: "NEW_PROJECT",
    signalStrength: 77,
    signalDate: "2026-03-25",
    confidence: 0.86,
    summary:
      "Coastal GasLink Phase 2 advanced through commercial agreements with LNG Canada, including FEED and execution activities subject to FID and approvals.",
  },
  {
    id: "signal-dewa-gre-water-pipeline-award",
    companyId: "dewa",
    projectId: "dewa-gre-water-pipelines",
    sourceId: "source-dewa-gre-water-pipeline-award",
    signalType: "EPC_AWARD",
    signalStrength: 83,
    signalDate: "2025-12-24",
    confidence: 0.9,
    summary:
      "DEWA awarded a major tender for GRE water pipelines in Dubai, including supply, installation, testing, commissioning, and associated works.",
  },
  {
    id: "signal-etihadwe-water-pipeline-tender",
    companyId: "etihadwe",
    projectId: "etihadwe-madam-fujairah-water-pipeline",
    sourceId: "source-etihadwe-water-pipeline-tender",
    signalType: "TENDER_RELEASED",
    signalStrength: 78,
    signalDate: "2026-06-22",
    confidence: 0.82,
    summary:
      "EtihadWE tendered a water storage project that includes DN1000 ductile iron transmission pipeline scope for the Northern Emirates network.",
  },
];

const decisionMakers: DecisionMaker[] = [
  {
    id: "contact-mexico-pacific-nelly-molina",
    companyId: "mexico-pacific",
    name: "Manuela (Nelly) Molina",
    title: "Chief Executive Officer",
    department: "Executive",
    seniority: "C-Level",
    location: "Mexico City, Mexico",
    emailStatus: "Unknown",
    linkedinUrl: "https://www.linkedin.com/in/nellymolina",
    source: "Verified company announcement dated May 12, 2025; person email enrichment pending",
  },
  {
    id: "contact-mexico-pacific-faith-parker",
    companyId: "mexico-pacific",
    name: "Faith Parker, CPA",
    title: "Chief Administrative Officer",
    department: "Executive",
    seniority: "C-Level",
    location: "Houston, Texas, United States",
    emailStatus: "Unknown",
    linkedinUrl: "https://www.linkedin.com/in/faith-parker",
    source: "Public professional profile and company employee listing; email verification pending",
  },
  {
    id: "contact-mexico-pacific-percival-cleetus",
    companyId: "mexico-pacific",
    name: "Percival Cleetus",
    title: "Senior Project Controls Manager",
    department: "Projects",
    seniority: "Manager",
    location: "Houston, Texas, United States",
    emailStatus: "Unknown",
    linkedinUrl: "https://www.linkedin.com/in/percival-cleetus-179181113",
    source: "Public professional profile tied to Mexico Pacific; email verification pending",
  },
  {
    id: "contact-mexico-pacific-procurement-target",
    companyId: "mexico-pacific",
    name: "Procurement owner to identify",
    title: "Procurement / Supply Chain Decision Maker",
    department: "Procurement",
    seniority: "Director",
    location: "Mexico / United States",
    emailStatus: "Unknown",
    linkedinUrl: "https://www.linkedin.com/company/mexico-pacific-limited/",
    source: "Role-level target retained because a named procurement owner was not publicly verified",
  },
  {
    id: "contact-lng-canada-contracting-team",
    companyId: "lng-canada",
    name: "Contracting and procurement team to identify",
    title: "Contracting / Procurement Decision Maker",
    department: "Procurement",
    seniority: "Director",
    location: "Kitimat / Calgary, Canada",
    emailStatus: "Unknown",
    source: "Role-level target from LNG Canada contracting and procurement page; named owner enrichment pending",
  },
  {
    id: "contact-lng-canada-project-controls-target",
    companyId: "lng-canada",
    name: "Project controls owner to identify",
    title: "Project Controls / Operations Contract Manager",
    department: "Projects",
    seniority: "Manager",
    location: "British Columbia, Canada",
    emailStatus: "Unknown",
    source: "Role-level target based on upcoming operations contract scopes and supplier registration process",
  },
  {
    id: "contact-tc-energy-cgl-project-owner",
    companyId: "tc-energy-coastal-gaslink",
    name: "Coastal GasLink Phase 2 project owner to identify",
    title: "Project Director / Execution Manager",
    department: "Projects",
    seniority: "Director",
    location: "British Columbia, Canada",
    emailStatus: "Unknown",
    source: "Role-level target from TC Energy statement on Phase 2 agreements and execution activities",
  },
  {
    id: "contact-dewa-water-procurement-target",
    companyId: "dewa",
    name: "Water infrastructure procurement owner to identify",
    title: "Water Pipeline Procurement Decision Maker",
    department: "Procurement",
    seniority: "Director",
    location: "Dubai, UAE",
    emailStatus: "Unknown",
    source: "Role-level target from DEWA public contract award; named procurement owner enrichment pending",
  },
  {
    id: "contact-dewa-engineering-target",
    companyId: "dewa",
    name: "Water network engineering owner to identify",
    title: "Water Network Engineering Manager",
    department: "Engineering",
    seniority: "Manager",
    location: "Dubai, UAE",
    emailStatus: "Unknown",
    source: "Role-level target from GRE pipeline supply, installation, testing, and commissioning scope",
  },
  {
    id: "contact-etihadwe-tender-owner",
    companyId: "etihadwe",
    name: "Tender package owner to identify",
    title: "Water Transmission Tender / Procurement Owner",
    department: "Procurement",
    seniority: "Director",
    location: "Northern Emirates, UAE",
    emailStatus: "Unknown",
    source: "Role-level target from EtihadWE water tank and DN1000 transmission pipeline tender coverage",
  },
];

const opportunityMessaging: Record<
  string,
  {
    potentialProduct: string;
    recommendedAction: string;
    intentKeywords: string[];
    matchedQuery: string;
  }
> = {
  "mexico-pacific": {
    potentialProduct: "Pipeline EPC materials; exact product specification not detected",
    recommendedAction: "Research project package owners and monitor for pipe/material tender documents before outreach.",
    intentKeywords: ["Sierra Madre Pipeline", "pipeline EPC", "LNG export project", "gas pipeline materials"],
    matchedQuery: "Mexico pipeline EPC award gas pipeline materials",
  },
  "lng-canada": {
    potentialProduct: "Operations procurement, LNG facility services, supplier registration opportunities",
    recommendedAction: "Register supplier profile and monitor quarterly contracting updates for matching material or service scopes.",
    intentKeywords: ["LNG Canada procurement", "supplier registration", "operations contracts", "LNG facility"],
    matchedQuery: "Canada LNG project procurement supplier registration",
  },
  "tc-energy-coastal-gaslink": {
    potentialProduct: "Gas pipeline expansion materials and EPC execution support",
    recommendedAction: "Track Phase 2 FID progress and identify execution/procurement owners before major package release.",
    intentKeywords: ["Coastal GasLink Phase 2", "pipeline expansion", "FEED", "execution activities"],
    matchedQuery: "Canada gas pipeline phase 2 EPC procurement",
  },
  dewa: {
    potentialProduct: "GRE water pipelines, installation, testing, commissioning, diversion and protection works",
    recommendedAction: "Map DEWA water infrastructure procurement owners and monitor follow-on pipeline packages.",
    intentKeywords: ["DEWA GRE water pipeline", "water pipeline contract", "Dubai utilities", "GRE pipe"],
    matchedQuery: "UAE water pipeline GRE contract award procurement",
  },
  etihadwe: {
    potentialProduct: "DN1000 ductile iron water transmission pipeline",
    recommendedAction: "Prioritize prequalified EPC and procurement contacts for water transmission package follow-up.",
    intentKeywords: ["EtihadWE water tender", "DN1000 pipeline", "ductile iron pipe", "Northern Emirates water"],
    matchedQuery: "GCC water transmission pipeline tender DN1000",
  },
};

export function getVerifiedOpportunities(): BuyerOpportunity[] {
  return companies.map((company) => {
    const companySignals = signals.filter((signal) => signal.companyId === company.id);
    const companyRequirements = requirements.filter((requirement) => requirement.companyId === company.id);
    const companyProjects = projects.filter((project) => project.companyId === company.id);
    const companyTenders = tenders.filter((tender) => tender.companyId === company.id);
    const sourceIds = new Set([...companySignals.map((signal) => signal.sourceId), ...companyRequirements.map((requirement) => requirement.sourceId)]);
    const companySources = sources.filter((source) => sourceIds.has(source.id));
    const score = calculateBuyerScore({
      companyId: company.id,
      signals: companySignals,
      requirements: companyRequirements,
      sources: companySources,
      hasTradeVerification: false,
    });
    const messaging = opportunityMessaging[company.id];

    return {
      company,
      score,
      potentialProduct: messaging.potentialProduct,
      latestSignal: companySignals.sort((a, b) => b.signalDate.localeCompare(a.signalDate))[0],
      project: companyProjects[0],
      tender: companyTenders[0],
      requirements: companyRequirements,
      sources: companySources,
      tradeVerification: "Not Connected",
      recommendedAction: messaging.recommendedAction,
      verificationStatus: "Verified Lead",
      intentKeywords: messaging.intentKeywords,
      matchedQuery: messaging.matchedQuery,
      decisionMakers: decisionMakers.filter((contact) => contact.companyId === company.id),
      crmStatus: "New",
    };
  });
}

export function getVerifiedOpportunity(id: string) {
  return getVerifiedOpportunities().find((opportunity) => opportunity.company.id === id);
}
