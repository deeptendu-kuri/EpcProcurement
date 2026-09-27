/**
 * Compliance rules as typed data (docs/mvp/08 §2.1 bid/supply rules, §3 outreach rules), checked on
 * 26 Sep 2026. Each bid rule knows when it applies and how to compare itself with the client profile.
 *
 * Not legal advice: the client confirms outreach practice with local counsel (08, top note).
 */
import type { CheckStatus, ClientProfile, LeadKind, OutreachPermission } from "@/mvp/types";

// ═════════════════════════ bid / supply (08 §2.1) ═════════════════════════

/** What a bid rule needs to know about the lead. Built by compliance/index.ts (or the scorer). */
export interface ChecklistInput {
  kind: LeadKind;
  /** Lead market: project country, or buyer country when the project country is unknown. */
  market: string | null;
  buyerName: string;
  buyerTypes: string[];
  projectOwnerName: string | null;
  projectSector: string | null;
  /** Package value, else project value (USD). */
  valueUsd: number | null;
  /** Tender flagged as government, or buyer typed government_buyer. */
  isGovernment: boolean;
  /** Standards named in the requirements, e.g. ["API 5L"]. */
  namedStandards: string[];
  profile: ClientProfile;
  now: Date;
}

export interface RuleOutcome {
  status: CheckStatus;
  hard: boolean;
  note: string;
}

export interface BidRule {
  key: string;
  /** Market codes, or "ALL". */
  markets: string[];
  title: string;
  requirement: string;
  /** "Hard" column of 08 §2.1, as written. */
  hardWhen: string;
  sourceUrl: string;
  evaluate(input: ChecklistInput): RuleOutcome;
  /** Counted in sub-criterion 4.1. ALL_SANCTIONS is not (gate G7 covers it). */
  countsForEligibility: boolean;
}

const NA = (note: string): RuleOutcome => ({ status: "not_applicable", hard: false, note });

const isAramco = (i: ChecklistInput) => /aramco/i.test(i.buyerName) || /aramco/i.test(i.projectOwnerName ?? "");
const isAdnoc = (i: ChecklistInput) => /adnoc/i.test(i.buyerName) || /adnoc/i.test(i.projectOwnerName ?? "");
/** Government registration rules apply to bid leads with a government buyer. */
const isGovBid = (i: ChecklistInput) => i.kind === "bid" && i.isGovernment;

/** Compare a registration flag in the profile: true → met, false → missing, absent → unknown. */
function registration(i: ChecklistInput, key: string, label: string, hard = true): RuleOutcome {
  const value = i.profile.registrations[key];
  if (value === true) return { status: "met", hard, note: `${label}: registered (client profile).` };
  if (value === false) return { status: "missing", hard, note: `${label}: not registered. Register before the tender closes.` };
  return { status: "unknown", hard, note: `${label}: add your registration status in Settings.` };
}

function localContent(i: ChecklistInput, market: string, key: string): unknown {
  return i.profile.local_content[market]?.[key];
}

function hasCert(profile: ClientProfile, name: string): boolean {
  const n = name.toLowerCase();
  return profile.certifications.some((c) => c.toLowerCase().includes(n));
}

/** Certification the client needs for a named standard (API 5L → "API 5L" monogram, etc.). */
const STANDARD_CERT: Record<string, string> = {
  "API 5L": "API 5L",
  "API 6D": "API 6D",
  "API 6A": "API 6A",
  "API 600": "API 600",
  "API Q1": "API Q1",
};

export const BID_RULES: BidRule[] = [
  {
    key: "SA_ETIMAD_REG",
    markets: ["SA"],
    title: "Etimad registration",
    requirement: "Registered on Etimad to take part in government tenders",
    hardWhen: "Yes (government)",
    sourceUrl: "https://portal.etimad.sa",
    countsForEligibility: true,
    evaluate: (i) => (isGovBid(i) ? registration(i, "etimad", "Etimad") : NA("Not a government tender.")),
  },
  {
    key: "SA_IKTVA",
    markets: ["SA"],
    title: "IKTVA score (Aramco)",
    requirement: "Aramco suppliers are scored on IKTVA (localised spend, Saudi salaries and training, supplier development, R&D)",
    hardWhen: "Yes (Aramco buyer)",
    sourceUrl: "https://www.iktva.sa",
    countsForEligibility: true,
    evaluate: (i) => {
      if (!isAramco(i)) return NA("Buyer and owner are not Aramco.");
      const score = localContent(i, "SA", "iktva_score");
      if (typeof score === "number") return { status: "met", hard: true, note: `IKTVA score ${score} on file.` };
      return { status: "unknown", hard: true, note: "Add your IKTVA score in Settings." };
    },
  },
  {
    key: "SA_LCGPA_MANDATORY",
    markets: ["SA"],
    title: "LCGPA local content",
    requirement:
      "Local-content authority (LCGPA): 10% price preference for national products; mandatory list; minimum local content for 233 products from 1 Aug 2026",
    hardWhen: "Depends on product",
    sourceUrl: "https://lcgpa.gov.sa",
    countsForEligibility: true,
    evaluate: (i) => {
      const status = localContent(i, "SA", "lcgpa_compliant");
      if (status === true) return { status: "met", hard: false, note: "Local-content requirement met (client profile)." };
      if (status === false) return { status: "missing", hard: false, note: "Products may fall under the LCGPA mandatory list." };
      return { status: "unknown", hard: false, note: "Check whether your products are on the LCGPA mandatory list." };
    },
  },
  {
    key: "SA_NITAQAT",
    markets: ["SA"],
    title: "Nitaqat band",
    requirement: "Nitaqat: Red-band firms are barred from tenders",
    hardWhen: "Yes (if operating in KSA)",
    sourceUrl: "https://hrsd.gov.sa",
    countsForEligibility: true,
    evaluate: (i) => {
      const band = localContent(i, "SA", "nitaqat_band");
      if (typeof band !== "string") return NA("Only applies if you operate an entity in KSA (no Nitaqat band on file).");
      if (band.toLowerCase() === "red") return { status: "missing", hard: true, note: "Red Nitaqat band bars you from tenders." };
      return { status: "met", hard: true, note: `Nitaqat band ${band}.` };
    },
  },
  {
    key: "SA_ARAMCO_ARIBA",
    markets: ["SA"],
    title: "Aramco supplier registration (Ariba)",
    requirement: "Aramco supplier registration via SAP Ariba",
    hardWhen: "Yes (Aramco buyer)",
    sourceUrl: "https://www.aramco.com/en/what-we-do/suppliers",
    countsForEligibility: true,
    evaluate: (i) => (isAramco(i) ? registration(i, "aramco_ariba", "Aramco Ariba") : NA("Buyer and owner are not Aramco.")),
  },
  {
    key: "AE_ICV",
    markets: ["AE"],
    title: "National ICV certificate",
    requirement: "National ICV certificate (MoIAT), valid 14 months; weighted about 10–50% in evaluation",
    hardWhen: "Usually",
    sourceUrl: "https://moiat.gov.ae/en/programs/icv",
    countsForEligibility: true,
    evaluate: (i) => {
      const until = localContent(i, "AE", "icv_cert_valid_until");
      if (typeof until !== "string") return { status: "unknown", hard: true, note: "Add your ICV certificate expiry in Settings." };
      const expiry = new Date(`${until.slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(expiry.getTime())) return { status: "unknown", hard: true, note: "ICV certificate date unreadable." };
      return expiry >= i.now
        ? { status: "met", hard: true, note: `ICV certificate valid until ${until.slice(0, 10)}.` }
        : { status: "missing", hard: true, note: `ICV certificate expired ${until.slice(0, 10)}. Renew it.` };
    },
  },
  {
    key: "AE_ADNOC_HUB",
    markets: ["AE"],
    title: "ADNOC Supplier Hub",
    requirement: "ADNOC Supplier Hub registration and prequalification",
    hardWhen: "Yes (ADNOC buyer)",
    sourceUrl: "https://supplierhub.adnoc.ae",
    countsForEligibility: true,
    evaluate: (i) => (isAdnoc(i) ? registration(i, "adnoc_supplier_hub", "ADNOC Supplier Hub") : NA("Buyer and owner are not ADNOC.")),
  },
  {
    key: "AE_PORTAL_REG",
    markets: ["AE"],
    title: "ADGPG / Dubai eSupply registration",
    requirement: "ADGPG / Dubai eSupply supplier registration",
    hardWhen: "Yes (government)",
    sourceUrl: "https://supplier.adgpg.gov.ae",
    countsForEligibility: true,
    evaluate: (i) => (isGovBid(i) ? registration(i, "adgpg_esupply", "ADGPG / eSupply") : NA("Not a government tender.")),
  },
  {
    key: "QA_TAWTEEN_ICV",
    markets: ["QA"],
    title: "TAWTEEN ICV certification",
    requirement: "TAWTEEN in-country value certification (QatarEnergy)",
    hardWhen: "Usually",
    sourceUrl: "https://icv.tawteen.com.qa",
    countsForEligibility: true,
    evaluate: (i) => registration(i, "tawteen_icv", "TAWTEEN ICV"),
  },
  {
    key: "OM_ICV",
    markets: ["OM"],
    title: "Oman ICV",
    requirement: "ICV embedded in Tender Board tenders; required by PDO and OQ",
    hardWhen: "Usually",
    sourceUrl: "https://tenderboard.gov.om",
    countsForEligibility: true,
    evaluate: (i) => registration(i, "om_icv", "Oman ICV plan"),
  },
  {
    key: "OM_ESNAD_REG",
    markets: ["OM"],
    title: "Esnad registration",
    requirement: "Registration on Esnad",
    hardWhen: "Yes (government)",
    sourceUrl: "https://etendering.tenderboard.gov.om",
    countsForEligibility: true,
    evaluate: (i) => (isGovBid(i) ? registration(i, "esnad", "Esnad") : NA("Not a government tender.")),
  },
  {
    key: "KW_CAPT_REG",
    markets: ["KW"],
    title: "CAPT registration",
    requirement: "Tender board registration (Kuwait CAPT)",
    hardWhen: "Yes (government)",
    sourceUrl: "https://capt.gov.kw",
    countsForEligibility: true,
    evaluate: (i) => (isGovBid(i) ? registration(i, "kw_capt", "CAPT") : NA("Not a government tender.")),
  },
  {
    key: "BH_TB_REG",
    markets: ["BH"],
    title: "Bahrain Tender Board registration",
    requirement: "Tender board registration (Bahrain)",
    hardWhen: "Yes (government)",
    sourceUrl: "https://www.tenderboard.gov.bh",
    countsForEligibility: true,
    evaluate: (i) => (isGovBid(i) ? registration(i, "bh_tender_board", "Bahrain Tender Board") : NA("Not a government tender.")),
  },
  {
    key: "IN_PPP_MII",
    markets: ["IN"],
    title: "Make in India (PPP-MII) class",
    requirement:
      "Make in India order: Class-I local supplier ≥ 50% local content, Class-II > 20%; 20% purchase-preference margin; global tender enquiries restricted below ₹200 crore",
    hardWhen: "Depends on tender",
    sourceUrl: "https://dpiit.gov.in",
    countsForEligibility: true,
    evaluate: (i) => {
      const cls = localContent(i, "IN", "ppp_mii_class");
      if (cls === "I" || cls === "II") return { status: "met", hard: false, note: `Class-${cls} local supplier.` };
      if (cls === "non_local") return { status: "missing", hard: false, note: "Non-local supplier: no purchase preference." };
      return { status: "unknown", hard: false, note: "Add your PPP-MII class in Settings." };
    },
  },
  {
    key: "IN_GEM_CPPP_REG",
    markets: ["IN"],
    title: "GeM / CPPP registration",
    requirement: "GeM seller / CPPP bidder registration",
    hardWhen: "Yes (government)",
    sourceUrl: "https://gem.gov.in",
    countsForEligibility: true,
    evaluate: (i) => (isGovBid(i) ? registration(i, "gem_cppp", "GeM / CPPP") : NA("Not a government tender.")),
  },
  {
    key: "EU_ESPD",
    markets: ["NO"],
    title: "ESPD self-declaration",
    requirement:
      "ESPD self-declaration (Directive 2014/24 Art. 59); thresholds from 1 Jan 2026: works €5.538m, utilities supplies/services €432k",
    hardWhen: "Yes (above threshold)",
    sourceUrl: "https://ec.europa.eu/tools/espd",
    countsForEligibility: true,
    evaluate: (i) => {
      if (i.kind !== "bid") return NA("Only for public tenders (bid leads).");
      // €432k ≈ $470k: the lowest threshold that can apply to a supplies tender.
      if (i.valueUsd !== null && i.valueUsd < 470_000) return NA("Below the EU threshold.");
      return registration(i, "espd_ready", "ESPD");
    },
  },
  {
    key: "NO_MAGNET_JQS",
    markets: ["NO"],
    title: "Magnet JQS prequalification",
    requirement: "Upstream oil and gas suppliers prequalified through Magnet JQS",
    hardWhen: "Usually (operators)",
    sourceUrl: "https://www.magnetjqs.com",
    countsForEligibility: true,
    evaluate: (i) =>
      i.projectSector === "oil_gas" || i.projectSector === null
        ? registration(i, "magnet_jqs", "Magnet JQS")
        : NA("Not an oil and gas project."),
  },
  {
    key: "MY_EPEROLEHAN",
    markets: ["MY"],
    title: "MOF registration / ePerolehan",
    requirement: "MOF registration / ePerolehan for government tenders",
    hardWhen: "Yes (government)",
    sourceUrl: "https://www.eperolehan.gov.my",
    countsForEligibility: true,
    evaluate: (i) => (isGovBid(i) ? registration(i, "eperolehan", "ePerolehan") : NA("Not a government tender.")),
  },
  {
    key: "ALL_CERTS",
    markets: ["ALL"],
    title: "Certifications",
    requirement: "Certifications named in the tender or typical for the package (ISO 9001, API Q1, API 5L monogram, etc.)",
    hardWhen: "If named",
    sourceUrl: "",
    countsForEligibility: true,
    evaluate: (i) => {
      const needed = i.namedStandards.map((s) => STANDARD_CERT[s]).filter((c): c is string => Boolean(c));
      if (!needed.length) {
        return hasCert(i.profile, "ISO 9001")
          ? { status: "met", hard: false, note: "No certification named; ISO 9001 held." }
          : { status: "unknown", hard: false, note: "No certification named in the documents." };
      }
      const missing = needed.filter((c) => !hasCert(i.profile, c));
      return missing.length
        ? { status: "missing", hard: true, note: `Named but not held: ${missing.join(", ")}.` }
        : { status: "met", hard: true, note: `Held: ${needed.join(", ")}.` };
    },
  },
  {
    key: "ALL_SANCTIONS",
    markets: ["ALL"],
    title: "Sanctions screening",
    requirement: "Buyer and parent not sanctioned (08 §4)",
    hardWhen: "Yes",
    sourceUrl: "https://sanctionslist.ofac.treas.gov",
    countsForEligibility: false,
    evaluate: () => ({ status: "unknown", hard: true, note: "Sanctions screening not run in demo (gate G7 stub)." }),
  },
];

// ═════════════════════════ outreach (08 §3) ═════════════════════════

export interface OutreachRuleData {
  country: string;
  email: OutreachPermission;
  phone: OutreachPermission;
  steps: string[];
  sourceUrl: string;
}

const GCC_OPT_OUT = (country: string): OutreachRuleData => ({
  country,
  email: "opt_out_only",
  phone: "opt_out_only",
  steps: ["Include a working opt-out in every message.", "Stop on any objection.", "Rule to be confirmed by counsel (conservative default)."],
  sourceUrl: "",
});

export const OUTREACH_RULES: Record<string, OutreachRuleData> = {
  IN: {
    country: "IN",
    email: "opt_out_only",
    phone: "blocked",
    steps: [
      "Email: business context only, include an opt-out, log where the address came from (DPDP Act duties apply from 13–14 May 2027; data a person made public themselves is exempt).",
      "Phone/SMS: call only from a registered 140-series number after a DND (NCPR) scrub — never from a 10-digit number (fines ₹2 lakh → ₹10 lakh per breach).",
    ],
    sourceUrl: "https://www.trai.gov.in",
  },
  SA: {
    country: "SA",
    email: "consent_needed",
    phone: "consent_needed",
    steps: [
      "Direct marketing needs consent where there has been no prior interaction (PDPL Implementing Regulations; SDAIA enforces).",
      "Get consent first (e.g. reply to a tender enquiry), or use the official procurement channel published by the buyer.",
    ],
    sourceUrl: "https://sdaia.gov.sa",
  },
  AE: {
    country: "AE",
    email: "opt_out_only",
    phone: "opt_out_only",
    steps: ["Include an opt-out; stop on objection (PDPL right to object to direct marketing)."],
    sourceUrl: "https://u.ae",
  },
  QA: GCC_OPT_OUT("QA"),
  OM: GCC_OPT_OUT("OM"),
  KW: GCC_OPT_OUT("KW"),
  BH: GCC_OPT_OUT("BH"),
  NO: {
    country: "NO",
    email: "consent_needed",
    phone: "opt_out_only",
    steps: [
      "Named individuals: electronic marketing needs consent (Marketing Act §15).",
      "Generic company addresses (post@, sales@) are allowed with an opt-out — prefer them.",
      "Phone: businesses allowed with care; check individuals against the reservation register.",
    ],
    sourceUrl: "https://lovdata.no",
  },
  MY: {
    country: "MY",
    email: "consent_needed",
    phone: "consent_needed",
    steps: ["Collect consent first and honour direct-marketing opt-outs (PDPA s.43; 2024 amendments in force since 1 Jun 2025)."],
    sourceUrl: "https://www.pdp.gov.my",
  },
  DE: {
    country: "DE",
    email: "consent_needed",
    phone: "consent_needed",
    steps: ["Cold email needs consent, including B2B (UWG §7). Phone only with presumed consent (concrete signs of interest)."],
    sourceUrl: "",
  },
  SG: {
    country: "SG",
    email: "opt_out_only",
    phone: "allowed",
    steps: ["Include an opt-out; PDPA applies. Pure B2B marketing is excluded from the DNC rules."],
    sourceUrl: "https://www.pdpc.gov.sg",
  },
};

/** Countries not in the table: allowed with a working opt-out (task default), confirm with counsel. */
export const DEFAULT_OUTREACH_RULE: Omit<OutreachRuleData, "country"> = {
  email: "opt_out_only",
  phone: "opt_out_only",
  steps: ["No country rule on file: include an opt-out and confirm local practice with counsel before sending at volume."],
  sourceUrl: "",
};
