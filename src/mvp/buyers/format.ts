/** Small display helpers for buyers: country names, money, dates. Pure. */

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", SA: "Saudi Arabia", AE: "UAE", QA: "Qatar", OM: "Oman", KW: "Kuwait", BH: "Bahrain", NO: "Norway", MY: "Malaysia",
  DE: "Germany", GB: "United Kingdom", UK: "United Kingdom", US: "United States", SG: "Singapore", EG: "Egypt", IQ: "Iraq", CN: "China",
  FR: "France", IT: "Italy", ES: "Spain", NL: "Netherlands", SE: "Sweden", DK: "Denmark", FI: "Finland", PL: "Poland", TR: "Turkey",
  ID: "Indonesia", TH: "Thailand", VN: "Vietnam", KR: "South Korea", JP: "Japan", AU: "Australia", ZA: "South Africa", NG: "Nigeria",
  PK: "Pakistan", BD: "Bangladesh", LK: "Sri Lanka", JO: "Jordan", LB: "Lebanon", LY: "Libya", DZ: "Algeria", MA: "Morocco",
};

/** "Saudi Arabia" for "SA"; the code itself when unknown; null for no code. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  return COUNTRY_NAMES[upper] ?? (upper.length === 2 ? upper : code.trim());
}

/** Match a location filter value ("SA", "Saudi Arabia", "saudi") against a country code / place. */
export function locationMatches(value: string, country: string | null, place: string | null = null): boolean {
  const needle = value.trim().toLowerCase();
  if (!needle) return false;
  if (country) {
    if (country.toLowerCase() === needle) return true;
    const name = countryName(country)?.toLowerCase() ?? "";
    if (name === needle || (needle.length >= 3 && name.includes(needle))) return true;
  }
  return Boolean(place && needle.length >= 3 && place.toLowerCase().includes(needle));
}

/** "SAR 771M", "USD 1.2B". */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) return null;
  const cur = (currency ?? "USD").toUpperCase();
  const units: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, suffix] of units) {
    if (amount >= size) {
      const value = amount / size;
      return `${cur} ${Number(value.toFixed(value >= 100 ? 0 : 1))}${suffix}`;
    }
  }
  return `${cur} ${Math.round(amount)}`;
}

/** "SAR 771M (≈ USD 205M)"; just "USD 205M" for USD; null when unknown. */
export function formatMoneyWithUsd(amount: number | null | undefined, currency: string | null | undefined, usd: number | null | undefined): string | null {
  const local = formatMoney(amount, currency);
  const inUsd = formatMoney(usd ?? null, "USD");
  if (!local) return inUsd;
  if (!currency || currency.toUpperCase() === "USD" || !inUsd) return local;
  return `${local} (≈ ${inUsd})`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 2026" */
export function monthYearOf(iso: string | null | undefined): string | null {
  const m = iso?.match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** "22 Sep 2026" */
export function dayOf(iso: string | null | undefined): string | null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** Company name without legal suffix or bracket alias: "East Pipes Integrated Company for Industry (EPIC)" → "EPIC" handled by shortCompanyName. */
export function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
}
