/**
 * scoring_config version 1 (docs/mvp/07). Every threshold and weight the scorer uses lives here as
 * data, so tuning (07 §11) means editing this object and bumping `version`.
 */
import type { SignalType, SourceTier } from "@/mvp/types";

export const SCORING_CONFIG = {
  version: 1,

  gates: {
    /** G1: minimum buyer match certainty (07 §4). */
    minMatchCertainty: 0.85,
    /** G4 (bid): closing date must be at least this many days away. */
    bidMinDaysToClose: 3,
    /** G4 (bid): with no closing date, the latest signal must be younger than this. */
    bidMaxSignalAgeDaysWithoutClose: 60,
    /** G4 (supply): the award must be younger than this. */
    supplyMaxAwardAgeMonths: 18,
  },

  confidence: {
    tierWeight: { A: 0.85, B: 0.7, C: 0.5 } as Record<SourceTier, number>,
    verified: 1.0,
    unverified: 0.3,
    /** [maxAgeDays, weight] in order; anything older gets `freshnessOlder`. */
    freshness: [
      [90, 1.0],
      [365, 0.8],
    ] as [number, number][],
    freshnessOlder: 0.5,
    agreementWeight: { both: 1.0, rule: 1.0, single: 0.75 },
    bandHigh: 0.8,
    bandMedium: 0.5,
  },

  classes: {
    genuineMinScore: 70,
    researchMinScore: 55,
  },

  rubric: {
    /** 2.1 supply: award age windows in months. */
    supplyAwardFreshMonths: 9,
    supplyAwardMaxMonths: 18,
    /** 2.2 deadline windows in days. */
    deadlineBest: [14, 90] as [number, number],
    deadlineOkLow: [3, 13] as [number, number],
    deadlineOkHigh: [91, 180] as [number, number],
    /** 2.3 recency half-life in days. */
    recencyHalfLifeDays: 60,
    recencyMax: 4,
    /** 2.4 momentum window in days. */
    momentumWindowDays: 90,
    /** 3.3 track-record window in years. */
    trackRecordYears: 5,
    /** 3.4: a filing/verification younger than this counts as "recent". */
    recentFilingMonths: 18,
  },

  graph: {
    regularSupplierMinPublishers: 2,
    regularSupplierWindowMonths: 36,
    typicalPackageMinProjects: 2,
    typicalPackageWindowYears: 5,
    awardsWindowYears: 5,
  },
} as const;

export type ScoringConfig = typeof SCORING_CONFIG;

/** Signals that trigger a bid lead (07 §1). */
export const BID_SIGNALS: readonly SignalType[] = [
  "prequalification_opened",
  "tender_released",
  "tender_closing_soon",
  "vendor_registration_opened",
  "capex_plan",
  "feed_awarded",
];

/** Signals that trigger a supply / subcontract lead (07 §1). */
export const SUPPLY_SIGNALS: readonly SignalType[] = [
  "contract_awarded",
  "subcontract_awarded",
  "supply_order_announced",
  "approved_vendor_listed",
  "hiring_project_roles",
  "import_shipment",
];

/** Signals that mean a buying route is open right now (4.3, 2.1 bid). */
export const OPEN_ROUTE_SIGNALS: readonly SignalType[] = [
  "prequalification_opened",
  "tender_released",
  "tender_closing_soon",
  "vendor_registration_opened",
];

/** Signals that carry an award (G4 supply age, 2.1 supply). */
export const AWARD_SIGNALS: readonly SignalType[] = ["contract_awarded", "subcontract_awarded", "supply_order_announced"];

/**
 * Country of well-known ports and regions, used by 5.3 "same country as a served region".
 * Keys are lower-case. Extend when the client profile adds new places.
 */
export const PLACE_COUNTRY: Record<string, string> = {
  kandla: "IN", mundra: "IN", "jawaharlal nehru": "IN", "nhava sheva": "IN", mumbai: "IN", chennai: "IN",
  vizag: "IN", visakhapatnam: "IN", paradip: "IN", gujarat: "IN", maharashtra: "IN", "tamil nadu": "IN",
  odisha: "IN", "andhra pradesh": "IN", rajasthan: "IN",
  "jebel ali": "AE", "khalifa port": "AE", ruwais: "AE", fujairah: "AE", "abu dhabi": "AE", dubai: "AE",
  sharjah: "AE",
  dammam: "SA", jubail: "SA", "ras tanura": "SA", jeddah: "SA", yanbu: "SA", "eastern province": "SA",
  riyadh: "SA",
  "port klang": "MY", "tanjung pelepas": "MY", pasir: "MY", johor: "MY", sarawak: "MY", sabah: "MY",
  terengganu: "MY",
  stavanger: "NO", bergen: "NO", mongstad: "NO", "kristiansund": "NO", rogaland: "NO", vestland: "NO",
  hammerfest: "NO",
  "hamad port": "QA", "ras laffan": "QA", mesaieed: "QA",
  sohar: "OM", duqm: "OM", salalah: "OM",
  shuwaikh: "KW", "shuaiba": "KW",
  "khalifa bin salman": "BH", sitra: "BH",
};
