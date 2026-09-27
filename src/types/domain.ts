export type ConfidenceLabel = "Low" | "Medium" | "High";

export type SignalType =
  | "NEW_PROJECT"
  | "EPC_AWARD"
  | "TENDER_RELEASED"
  | "PROCUREMENT_REQUIREMENT"
  | "PRODUCT_SPECIFICATION"
  | "CAPEX_ANNOUNCEMENT"
  | "EXPANSION"
  | "HIRING"
  | "COMPANY_NEWS"
  | "FIRST_PARTY_ACTIVITY"
  | "TRADE_HISTORY"
  | "INTENT_SIGNAL";

export type TradeVerificationStatus = "Not Connected" | "Pending" | "Verified" | "No Match";
export type LeadVerificationStatus = "Verified Lead" | "Needs Review" | "Insufficient Evidence";
export type EmailVerificationStatus = "Verified" | "Risky" | "Unknown" | "Not Found";
export type CrmStatus = "New" | "Reviewed" | "Qualified" | "Contacted" | "Replied" | "Not Fit";
export type SeniorityLevel = "Owner" | "C-Level" | "VP" | "Director" | "Manager" | "Individual Contributor";
export type Department = "Procurement" | "Projects" | "Engineering" | "Supply Chain" | "Operations" | "Executive";

export interface Company {
  id: string;
  canonicalName: string;
  domain?: string;
  industry: string;
  subIndustry?: string;
  country: string;
  region?: string;
  city?: string;
  employeeCount?: number;
  employeeRange?: string;
  description: string;
  lastUpdatedAt: string;
  lastSignalAt: string;
}

export interface SourceEvidence {
  id: string;
  url: string;
  domain: string;
  sourceType: string;
  reliability: "Very High" | "High" | "Medium" | "Low" | "Unknown";
  title: string;
  publishedAt?: string;
}

export interface Project {
  id: string;
  companyId: string;
  name: string;
  projectType: string;
  country: string;
  location: string;
  estimatedValue?: number;
  stage: string;
  announcementDate?: string;
  description: string;
  confidence: number;
}

export interface Tender {
  id: string;
  companyId: string;
  projectId?: string;
  title: string;
  referenceNumber?: string;
  country: string;
  issueDate?: string;
  closingDate?: string;
  status: string;
  description: string;
  sourceId: string;
}

export interface ProductRequirement {
  id: string;
  companyId: string;
  projectId?: string;
  tenderId?: string;
  sourceId: string;
  productCategory: string;
  productType?: string;
  standard?: string;
  grade?: string;
  diameter?: string;
  wallThickness?: string;
  coating?: string;
  quantity?: number;
  unit?: string;
  material?: string;
  specification?: string;
  confidence: number;
}

export interface Signal {
  id: string;
  companyId: string;
  projectId?: string;
  tenderId?: string;
  sourceId: string;
  signalType: SignalType;
  signalStrength: number;
  signalDate: string;
  confidence: number;
  summary: string;
}

export interface ScoreReason {
  label: string;
  points: number;
  evidenceIds: string[];
}

export interface BuyerScore {
  companyId: string;
  score: number;
  confidence: ConfidenceLabel;
  productFitScore: number;
  projectScore: number;
  tenderScore: number;
  timingScore: number;
  tradeScore: number;
  intentScore: number;
  relationshipScore: number;
  calculatedAt: string;
  reasons: ScoreReason[];
}

export interface DecisionMaker {
  id: string;
  companyId: string;
  name: string;
  title: string;
  department: Department;
  seniority: SeniorityLevel;
  location?: string;
  email?: string;
  emailStatus: EmailVerificationStatus;
  linkedinUrl?: string;
  source: string;
  lastVerifiedAt?: string;
}

export interface BuyerOpportunity {
  company: Company;
  score: BuyerScore;
  potentialProduct: string;
  latestSignal: Signal;
  project?: Project;
  tender?: Tender;
  requirements: ProductRequirement[];
  sources: SourceEvidence[];
  tradeVerification: TradeVerificationStatus;
  recommendedAction: string;
  verificationStatus?: LeadVerificationStatus;
  intentKeywords?: string[];
  matchedQuery?: string;
  decisionMakers?: DecisionMaker[];
  crmStatus?: CrmStatus;
}
