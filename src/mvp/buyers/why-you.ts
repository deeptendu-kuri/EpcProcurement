/**
 * "Why you" (docs/mvp/14 §7): the client's strengths (14 §4) whose condition matches verified facts
 * about the buyer. At most 3, each with a short reason. A strength whose condition is not met is
 * never shown. Pure.
 */
import { getStrengths, type Strength, type StrengthsConfig } from "@/mvp/config/buyers-config";
import { countryName } from "./format";
import type { WhyYou } from "./types";

/** Verified facts the strength conditions look at. Unknown = null / empty (never assumed). */
export interface WhyYouFacts {
  /** Buyer HQ country (ISO-2). */
  buyerCountry: string | null;
  /** Project / site country (ISO-2). */
  siteCountry: string | null;
  /** Named site or delivery place ("Ras Tanura"), when a source states it. */
  site: string | null;
  deliveryPort: string | null;
  /** Months from order / award to required delivery, when a source states it. */
  deliveryMonths: number | null;
  /** A source says the order is urgent / fast-track. */
  urgent: boolean;
  /** Standards / specs named by the sources (API 5L, ASTM A106 …). */
  standards: string[];
  /** Project owner name (for owner-type conditions). */
  ownerName: string | null;
  /** Number of catalogue categories the buyer needs (good + possible items, competitors excluded). */
  categories: number;
  /** Open public tender (owner is a public body). */
  publicTender: boolean;
}

/** Lower-case keys an owner name matches ("Saudi Arabian Oil Co. (Saudi Aramco)" → "aramco"…). */
function ownerMatches(ownerName: string | null, keys: readonly string[]): string | null {
  if (!ownerName) return null;
  const name = ownerName.toLowerCase();
  const aliases: Record<string, RegExp> = {
    aramco: /aramco|saudi arabian oil/,
    adnoc: /adnoc|abu dhabi national oil/,
    qatarenergy: /qatar ?energy|qatar petroleum/,
    pdo: /\bpdo\b|petroleum development oman/,
    kpc: /\bkpc\b|kuwait petroleum/,
    koc: /\bkoc\b|kuwait oil company/,
    petronas: /petronas|petroliam nasional/,
    ongc: /\bongc\b|oil and natural gas/,
    iocl: /\biocl?\b|indian oil/,
    gail: /\bgail\b/,
    equinor: /equinor|statoil/,
    totalenergies: /total ?energies|\btotal\b/,
    exxonmobil: /exxon/,
  };
  for (const key of keys) {
    const re = aliases[key] ?? new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(name)) return key;
  }
  return null;
}

const OWNER_LABEL: Record<string, string> = { aramco: "Aramco", adnoc: "ADNOC", qatarenergy: "QatarEnergy", pdo: "PDO" };

/** The reason a strength applies, or null when its condition is not met by the facts. */
export function strengthReason(strength: Strength, facts: WhyYouFacts, config: Pick<StrengthsConfig, "homeCountries">): string | null {
  const c = strength.condition;
  switch (c.type) {
    case "near_hub": {
      const places: [string | null, string][] = [
        [facts.buyerCountry, "the buyer is in"],
        [facts.siteCountry, "the site is in"],
      ];
      for (const [country, words] of places) {
        if (!country) continue;
        const direct = c.hubs.find((h) => h.country === country);
        if (direct) return `Stock in ${direct.place} — ${words} ${countryName(country)}`;
      }
      for (const [country, words] of places) {
        if (!country) continue;
        const near = c.hubs.find((h) => h.near.includes(country));
        if (near) return `Stock in ${near.place} (${countryName(near.country)}) — ${words} ${countryName(country)}, next door`;
      }
      return null;
    }
    case "short_delivery":
      if (facts.urgent) return "The order is urgent — ex-stock delivery in 1–2 weeks";
      if (facts.deliveryMonths !== null && facts.deliveryMonths <= c.maxMonths)
        return `Delivery is due within ${Math.max(1, Math.round(facts.deliveryMonths))} months — ex-stock and fast mill orders help`;
      return null;
    case "min_categories":
      return facts.categories >= c.min ? `They need ${facts.categories} kinds of material from your catalogue — one order, one vendor` : null;
    case "specs_or_major": {
      if (facts.standards.length) return `The sources name ${facts.standards.slice(0, 2).join(", ")} — you supply certified material`;
      const major = ownerMatches(facts.ownerName, c.majors);
      return major ? `The client is ${facts.ownerName?.replace(/\s*\(.*\)$/, "")} — an oil & gas major that asks for full certification` : null;
    }
    case "owner_in": {
      const owner = ownerMatches(facts.ownerName, c.owners);
      return owner ? `The client (${OWNER_LABEL[owner] ?? owner}) buys from its approved vendor list` : null;
    }
    case "local_content": {
      const owner = ownerMatches(facts.ownerName, c.owners);
      if (owner) return `${OWNER_LABEL[owner] ?? owner} scores local content in its tenders`;
      const country = facts.siteCountry ?? facts.buyerCountry;
      if (facts.publicTender && country && c.publicTenderCountries.includes(country)) return `${countryName(country)} public tenders score local content`;
      return null;
    }
    case "site_or_export": {
      if (facts.deliveryPort) return `Delivery port is known (${facts.deliveryPort}) — delivered with export documents`;
      if (facts.site) return `The site is known (${facts.site}) — delivered to site`;
      if (facts.buyerCountry && config.homeCountries.length && !config.homeCountries.includes(facts.buyerCountry))
        return `The buyer is in ${countryName(facts.buyerCountry)} — you deliver with export documents`;
      return null;
    }
  }
}

/** Strengths that are a benefit to this buyer, with reasons, at most `max` (14 §7). */
export function whyYouFor(facts: WhyYouFacts, config: StrengthsConfig = getStrengths(), max = 3): WhyYou[] {
  const out: WhyYou[] = [];
  for (const strength of config.strengths) {
    const reason = strengthReason(strength, facts, config);
    if (!reason) continue;
    out.push({ strengthId: strength.id, text: strength.text, reason, isExample: config.isExample });
    if (out.length >= max) break;
  }
  return out;
}
