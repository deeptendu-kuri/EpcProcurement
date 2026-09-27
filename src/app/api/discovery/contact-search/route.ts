import { NextResponse } from "next/server";
import { createSearchProvider } from "@/modules/discovery/providers";
import { createContentExtractor } from "@/modules/sources/providers";
import { domainFromUrl, normalizeUrl } from "@/lib/urls";
import type { SearchQueryConfig, SearchResult } from "@/types/providers";

interface ContractorContactSearchRequest {
  leadId?: string;
  ownerCompany?: string;
  parentProjectName?: string;
  sourceUrl?: string;
  contractor?: {
    name?: string;
    country?: string;
    role?: string;
    scope?: string;
    contractValue?: string;
    packageHint?: string;
  };
  targetRoles?: string[];
}

interface ContactCandidate {
  id: string;
  leadId: string;
  companyName: string;
  name: string;
  title: string;
  department: string;
  seniority: string;
  location?: string;
  linkedinUrl?: string;
  email?: string;
  emailStatus: "Email Not Found" | "Verification Pending";
  phone?: string;
  phoneStatus: "Not Found" | "Candidate Found";
  phoneSourceUrl?: string;
  linkedinStatus: "Not Found" | "Profile Found" | "Needs Review";
  dataSourceType: "Company website" | "Professional profile" | "Procurement source";
  confidence: number;
  confidenceBreakdown: {
    base: number;
    professionalProfile: number;
    directContact: number;
    sourcePage: number;
  };
  evidenceSignals: string[];
  evidenceNotes: string;
  emailCandidateType: "unknown" | "source-backed";
  verificationSource?: string;
  sourceUrl?: string;
  status: "Candidate Found";
  createdAt: string;
}

interface SourceDocument {
  url: string;
  title?: string;
  snippet?: string;
  text: string;
  sourceType: "search result" | "source page";
}

const roleKeywords = [
  "procurement",
  "supply chain",
  "contracts",
  "contract",
  "project",
  "package",
  "materials",
  "engineering",
  "mechanical",
  "construction",
  "commissioning",
  "manager",
  "director",
  "head",
  "lead",
];

const blockedFetchDomains = ["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com"];
const commonFalseNames = new Set(["LinkedIn", "Contact Us", "Privacy Policy", "Terms Conditions", "Cookie Policy"]);
const organizationNameParts = new Set(["company", "group", "limited", "ltd", "llc", "inc", "corp", "corporation", "services", "service", "pvt", "private", "india", "saudi", "arabia", "uae", "dubai", "abu", "dhabi", "qatar", "oman", "kuwait", "khobar", "riyadh", "spain", "uk", "usa"]);

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as ContractorContactSearchRequest | null;
  const contractorName = cleanText(payload?.contractor?.name);
  const leadId = cleanText(payload?.leadId);

  if (!contractorName || !leadId) {
    return NextResponse.json({ ok: false, error: "Contractor name and lead ID are required." }, { status: 400 });
  }

  const targetRoles = cleanList(payload?.targetRoles).slice(0, 8);
  const queries = buildContactQueries(payload, contractorName, targetRoles);
  const sources: SourceDocument[] = [];
  const errors: string[] = [];

  try {
    const searchProvider = createSearchProvider();
    const searchResults = await searchProvider.search(contactSearchConfig(contractorName, queries));
    const rankedResults = rankSearchResults(searchResults, contractorName, targetRoles).slice(0, 10);

    for (const result of rankedResults) {
      sources.push({
        url: result.url,
        title: result.title,
        snippet: result.snippet,
        text: [result.title, result.snippet].filter(Boolean).join("\n"),
        sourceType: "search result",
      });
    }

    const extractor = createContentExtractor();
    const pageReads = await Promise.allSettled(
      rankedResults.slice(0, 4).map(async (result) => {
        const url = safeNormalizeUrl(result.url);
        if (!url || isBlockedFetchUrl(url)) return null;

        const content = await extractor.extract(url);
        return {
          url: content.url,
          title: content.title || result.title,
          snippet: result.snippet,
          text: content.markdown,
          sourceType: "source page" as const,
        };
      }),
    );

    pageReads.forEach((read) => {
      if (read.status === "fulfilled" && read.value) {
        sources.push(read.value);
        return;
      }
      if (read.status === "rejected") {
        errors.push(read.reason instanceof Error ? read.reason.message : "Source page could not be read.");
      }
    });

    const contacts = extractContactsFromSources({
      leadId,
      contractorName,
      contractorCountry: cleanText(payload?.contractor?.country),
      targetRoles,
      sources,
    });

    return NextResponse.json({
      ok: true,
      mode: "source-backed",
      queries,
      sourcesRead: sources.length,
      contacts,
      errors: errors.slice(0, 3),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        queries,
        error: error instanceof Error ? sanitizeProviderError(error.message) : "Contact discovery failed.",
      },
      { status: 500 },
    );
  }
}

function contactSearchConfig(contractorName: string, queries: string[]): SearchQueryConfig {
  return {
    id: `contractor-contact-${slugify(contractorName)}`,
    name: "Contractor contact search",
    keywordGroup: "contractor contacts",
    sourceType: "public web",
    language: "en",
    priority: 1,
    enabled: true,
    queries,
  };
}

export function buildContactQueries(payload: ContractorContactSearchRequest | null, contractorName: string, targetRoles: string[]) {
  const project = cleanText(payload?.parentProjectName);
  const owner = cleanText(payload?.ownerCompany);
  const packageHint = cleanText(payload?.contractor?.packageHint);
  const scope = cleanText(payload?.contractor?.scope);
  const primaryRoles = targetRoles.length > 0 ? targetRoles.slice(0, 6) : ["Procurement Manager", "Supply Chain Manager", "Contracts Manager", "Project Manager", "CEO", "Managing Director"];
  const roleQuery = primaryRoles.map((role) => `"${role}"`).join(" OR ");
  const context = [project, owner, packageHint, scope].filter(Boolean).slice(0, 3).join(" ");

  return Array.from(new Set([
    `"${contractorName}" (${roleQuery})`,
    `"${contractorName}" contact email phone procurement`,
    `"${contractorName}" CEO "Managing Director" leadership`,
    `"${contractorName}" management team procurement contacts`,
    `site:linkedin.com/in "${contractorName}" procurement OR contracts OR project`,
    context ? `"${contractorName}" "${context}" contact procurement` : "",
  ].filter(Boolean))).slice(0, 5);
}

function rankSearchResults(results: SearchResult[], contractorName: string, targetRoles: string[]) {
  const seen = new Set<string>();
  return results
    .filter((result) => {
      const url = safeNormalizeUrl(result.url);
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .map((result) => ({ ...result, rankScore: scoreSearchResult(result, contractorName, targetRoles) }))
    .filter((result) => result.rankScore > 0)
    .sort((a, b) => b.rankScore - a.rankScore);
}

function scoreSearchResult(result: SearchResult, contractorName: string, targetRoles: string[]) {
  const haystack = [result.title, result.snippet, result.url].join(" ").toLowerCase();
  const contractorTokens = contractorName.toLowerCase().split(/\s+/).filter((part) => part.length > 2);
  let score = contractorTokens.filter((token) => haystack.includes(token)).length * 2;
  score += roleKeywords.filter((keyword) => haystack.includes(keyword)).length;
  score += targetRoles.filter((role) => haystack.includes(role.toLowerCase())).length * 2;
  if (haystack.includes("linkedin.com/in")) score += 4;
  if (haystack.includes("contact") || haystack.includes("leadership") || haystack.includes("team")) score += 2;
  if (haystack.includes("jobs") || haystack.includes("careers") || haystack.includes("tender")) score -= 1;
  return score;
}

function extractContactsFromSources(input: {
  leadId: string;
  contractorName: string;
  contractorCountry?: string;
  targetRoles: string[];
  sources: SourceDocument[];
}) {
  const contacts = new Map<string, ContactCandidate>();

  for (const source of input.sources) {
    const emails = extractEmails(source.text);
    const phones = extractPhones(source.text);
    const linkedinUrls = extractLinkedinUrls(source.text);
    const lineCandidates = candidateLines(source.text);

    for (const line of lineCandidates) {
      const title = extractTitle(line, input.targetRoles);
      if (!title) continue;

      const name = extractPersonName(line, title, input.contractorName);
      if (!name) continue;

      const key = `${name.toLowerCase()}|${title.toLowerCase()}|${input.contractorName.toLowerCase()}`;
      const linkedinUrl = nearestLinkedin(line, linkedinUrls);
      const email = nearestEmail(line, emails);
      const phone = nearestPhone(line, phones);
      const candidate = contactCandidate({
        leadId: input.leadId,
        companyName: input.contractorName,
        contractorCountry: input.contractorCountry,
        name,
        title,
        linkedinUrl,
        email,
        phone,
        source,
      });

      const existing = contacts.get(key);
      contacts.set(key, mergeContactCandidate(existing, candidate));
    }
  }

  return Array.from(contacts.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12);
}

export function contactCandidate(input: {
  leadId: string;
  companyName: string;
  contractorCountry?: string;
  name: string;
  title: string;
  linkedinUrl?: string;
  email?: string;
  phone?: string;
  source: SourceDocument;
}): ContactCandidate {
  const linkedinUrl = input.linkedinUrl || (isLinkedinProfileUrl(input.source.url) ? input.source.url : undefined);
  const hasProfile = Boolean(linkedinUrl);
  const hasDirectContact = Boolean(input.email || input.phone);
  const dataSourceType = hasProfile ? "Professional profile" : input.source.sourceType === "source page" ? "Company website" : "Procurement source";
  const confidenceBreakdown = {
    base: 55,
    professionalProfile: hasProfile ? 20 : 0,
    directContact: hasDirectContact ? 15 : 0,
    sourcePage: input.source.sourceType === "source page" ? 10 : 0,
  };
  const confidence = Math.min(95, confidenceBreakdown.base + confidenceBreakdown.professionalProfile + confidenceBreakdown.directContact + confidenceBreakdown.sourcePage);
  const evidenceSignals = [
    hasProfile ? "LinkedIn/profile evidence" : "",
    input.email ? "Email candidate found" : "",
    input.phone ? "Phone candidate found" : "",
    input.source.sourceType === "source page" ? "Source page read" : "Search result evidence",
  ].filter(Boolean);

  return {
    id: `auto-contact-${input.leadId}-${slugify(input.companyName)}-${slugify(input.name)}-${slugify(input.title)}`.slice(0, 180),
    leadId: input.leadId,
    companyName: input.companyName,
    name: input.name,
    title: input.title,
    department: departmentForTitle(input.title),
    seniority: seniorityForTitle(input.title),
    location: input.contractorCountry,
    linkedinUrl,
    email: input.email,
    emailStatus: input.email ? "Verification Pending" : "Email Not Found",
    phone: input.phone,
    phoneStatus: input.phone ? "Candidate Found" : "Not Found",
    phoneSourceUrl: input.phone ? input.source.url : undefined,
    linkedinStatus: linkedinUrl ? "Profile Found" : "Needs Review",
    dataSourceType,
    confidence,
    confidenceBreakdown,
    evidenceSignals,
    evidenceNotes: `Auto-extracted from ${input.source.title || domainFromUrl(input.source.url)}. Verify before outreach.`,
    emailCandidateType: input.email ? "source-backed" : "unknown",
    verificationSource: input.email ? input.source.url : undefined,
    sourceUrl: input.source.url,
    status: "Candidate Found",
    createdAt: new Date().toISOString(),
  };
}

function mergeContactCandidate(existing: ContactCandidate | undefined, candidate: ContactCandidate) {
  if (!existing) return candidate;

  return {
    ...existing,
    linkedinUrl: existing.linkedinUrl || candidate.linkedinUrl,
    email: existing.email || candidate.email,
    emailStatus: existing.email || candidate.email ? "Verification Pending" as const : "Email Not Found" as const,
    phone: existing.phone || candidate.phone,
    phoneStatus: existing.phone || candidate.phone ? "Candidate Found" as const : "Not Found" as const,
    phoneSourceUrl: existing.phoneSourceUrl || candidate.phoneSourceUrl,
    linkedinStatus: existing.linkedinUrl || candidate.linkedinUrl ? "Profile Found" as const : existing.linkedinStatus,
    confidence: Math.max(existing.confidence, candidate.confidence),
    confidenceBreakdown: existing.confidence >= candidate.confidence ? existing.confidenceBreakdown : candidate.confidenceBreakdown,
    evidenceSignals: Array.from(new Set([...(existing.evidenceSignals ?? []), ...(candidate.evidenceSignals ?? [])])).slice(0, 6),
    evidenceNotes: existing.evidenceNotes.includes(candidate.sourceUrl ?? "") ? existing.evidenceNotes : `${existing.evidenceNotes} Additional source: ${candidate.sourceUrl}`,
    sourceUrl: existing.sourceUrl || candidate.sourceUrl,
  };
}

function candidateLines(text: string) {
  const profileLikeTitles = Array.from(text.matchAll(/[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}\s+-\s+[^|\n.]{6,100}(?:\||\s+at\s+|\s+en\s+|$)/g))
    .map((match) => match[0]);
  const compact = text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2")
    .replace(/\s+/g, " ");
  const sentenceLike = compact.split(/(?<=[.!?])\s+|\n| {2,}/g);

  return [...profileLikeTitles, ...sentenceLike]
    .map((line) => line.trim())
    .filter((line) => line.length >= 18 && line.length <= 320)
    .filter((line) => roleKeywords.some((keyword) => line.toLowerCase().includes(keyword)));
}

export function extractTitle(line: string, targetRoles: string[]) {
  const allRoles = [...targetRoles, "Procurement Manager", "Supply Chain Manager", "Contracts Manager", "Project Manager", "Project Director", "Engineering Manager", "Package Manager", "Materials Manager", "CEO", "Chief Executive Officer", "Managing Director", "General Manager", "Commercial Director"];
  const exact = allRoles.find((role) => line.toLowerCase().includes(role.toLowerCase()));
  if (exact) return exact;

  const titleMatch = line.match(/\b((?:Senior|Lead|Chief|Head of|Director of|Vice President|VP|CEO|Managing Director|General Manager|Manager|Director|Officer|Engineer|Specialist|Coordinator|Buyer|Controller)[A-Za-z\s/&-]{0,55}(?:Procurement|Supply Chain|Contracts?|Projects?|Materials?|Construction|Commissioning|Package|Operations|Commercial|Executive|Management)|(?:Procurement|Supply Chain|Contracts?|Projects?|Materials?|Construction|Commissioning|Package|Commercial|Executive)[A-Za-z\s/&-]{0,45}(?:Manager|Director|Head|Lead|Engineer|Specialist|Buyer|Officer))\b/i);
  const title = titleMatch ? cleanTitle(titleMatch[1]) : undefined;
  if (!title || /bachelor|master|degree|university|college|\bbe\b|b\.e\.|mba|email\s*&\s*phone/i.test(title)) return undefined;
  return title;
}

function extractPersonName(line: string, title: string, contractorName: string) {
  const withoutUrls = line.replace(/https?:\/\/\S+/g, " ");
  const beforeTitle = withoutUrls.split(new RegExp(escapeRegExp(title), "i"))[0] ?? "";
  const candidates = beforeTitle.match(/\b[A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s+)?[A-Z][a-z]+){1,3}\b/g) ?? withoutUrls.match(/\b[A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s+)?[A-Z][a-z]+){1,3}\b/g) ?? [];

  for (const candidate of candidates.reverse()) {
    const cleaned = candidate.trim();
    if (!isProbablyPersonName(cleaned, contractorName)) continue;
    return cleaned;
  }

  return undefined;
}

function isProbablyPersonName(name: string, contractorName: string) {
  const lower = name.toLowerCase();
  if (commonFalseNames.has(name)) return false;
  if (lower.includes("linkedin")) return false;
  const contractorTokens = contractorName.toLowerCase().split(/\s+/).filter((part) => part.length > 2);
  if (contractorTokens.some((token) => lower.includes(token))) return false;
  const parts = name.split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return false;
  if (parts.some((part) => roleKeywords.includes(part.toLowerCase()))) return false;
  if (parts.some((part) => organizationNameParts.has(part.toLowerCase().replace(/[^a-z]/g, "")))) return false;
  if (!parts.every((part) => /^[A-Z][A-Za-z.'-]+$/.test(part) || /^[A-Z]\.?$/.test(part))) return false;
  return true;
}

function extractEmails(text: string) {
  return Array.from(new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []))
    .filter((email) => !/\.(png|jpg|jpeg|gif|webp)$/i.test(email))
    .slice(0, 20);
}

function extractPhones(text: string) {
  return Array.from(new Set(text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,5}\d{3,4}/g) ?? []))
    .map((phone) => phone.trim())
    .filter((phone) => phone.replace(/\D/g, "").length >= 8)
    .slice(0, 20);
}

function extractLinkedinUrls(text: string) {
  return Array.from(new Set(text.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s)\]]+/gi) ?? []))
    .map((url) => url.replace(/[.,;]+$/, ""))
    .slice(0, 20);
}

function nearestLinkedin(line: string, urls: string[]) {
  return urls.find((url) => line.includes(url)) ?? urls[0];
}

function isLinkedinProfileUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    return host.endsWith("linkedin.com") && parsed.pathname.startsWith("/in/");
  } catch {
    return false;
  }
}

function nearestEmail(line: string, emails: string[]) {
  return emails.find((email) => line.includes(email)) ?? (emails.length === 1 ? emails[0] : undefined);
}

function nearestPhone(line: string, phones: string[]) {
  return phones.find((phone) => line.includes(phone)) ?? (phones.length === 1 ? phones[0] : undefined);
}

function departmentForTitle(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("chief") || lower === "ceo" || lower.includes("managing director") || lower.includes("general manager")) return "Executive";
  if (lower.includes("supply")) return "Supply Chain";
  if (lower.includes("engineering") || lower.includes("mechanical") || lower.includes("commissioning")) return "Engineering";
  if (lower.includes("project") || lower.includes("construction")) return "Projects";
  if (lower.includes("commercial") || lower.includes("contract")) return "Contracts";
  return "Procurement";
}

function seniorityForTitle(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("chief") || lower === "ceo" || lower.includes("managing director")) return "C-Level";
  if (lower.includes("director") || lower.includes("head") || lower.includes("chief") || lower.includes("vp")) return "Director";
  if (lower.includes("lead") || lower.includes("manager")) return "Manager";
  return "Individual Contributor";
}

function cleanTitle(title: string) {
  return title.replace(/\s+/g, " ").replace(/[|,.;:-]+$/g, "").trim();
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(value: unknown) {
  return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
}

function safeNormalizeUrl(url: string) {
  try {
    return normalizeUrl(url);
  } catch {
    return "";
  }
}

function isBlockedFetchUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return blockedFetchDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return true;
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeProviderError(message: string) {
  return message
    .replaceAll("SerpApi", "Search provider")
    .replaceAll("serpapi", "search provider")
    .replaceAll("Firecrawl", "Content provider")
    .replaceAll("firecrawl", "content provider");
}
