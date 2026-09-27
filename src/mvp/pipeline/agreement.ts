/**
 * Two-model agreement (06 §4, 12 §3).
 *
 * | result   | meaning                                   | allowed use                  |
 * |----------|-------------------------------------------|------------------------------|
 * | both     | two distinct providers found and agree    | anything, including gates    |
 * | single   | only model A found it (quote verified)    | display and scoring, not gates |
 * | disputed | the models disagree on the same slot      | never stored                 |
 * | rule     | rules extractor / structured source / mock | anything                    |
 *
 * In demo mode both "models" are the rules-based mock, so its facts are labelled `rule`.
 */
import { normalizeCompanyName, normaliseForMatch, parseDate, tokenSetRatio } from "./text";
import { numbersIn } from "./quote-check";

export type AgreementLabel = "both" | "single" | "disputed" | "rule";
export type ValueKind = "name" | "enum" | "number" | "date" | "text";

/** Do two values of the given kind agree? (06 §4 table.) */
export function valuesAgree(kind: ValueKind, a: string, b: string): boolean {
  switch (kind) {
    case "name": {
      const na = normalizeCompanyName(a);
      const nb = normalizeCompanyName(b);
      return na === nb || tokenSetRatio(na, nb) >= 92;
    }
    case "enum":
      return a.trim().toLowerCase() === b.trim().toLowerCase();
    case "number": {
      const xa = numbersIn(a);
      const xb = numbersIn(b);
      const scaledA = xa.length ? Math.max(...xa) : NaN;
      const scaledB = xb.length ? Math.max(...xb) : NaN;
      if (!Number.isFinite(scaledA) || !Number.isFinite(scaledB)) return false;
      return scaledA === scaledB || Math.abs(scaledA - scaledB) / Math.max(Math.abs(scaledA), 1e-9) <= 0.01;
    }
    case "date": {
      const da = parseDate(a);
      const db = parseDate(b);
      if (!da || !db) return normaliseForMatch(a) === normaliseForMatch(b);
      const monthOnly = !/\b\d{1,2}(?:st|nd|rd|th)?\b\s+[a-z]|[a-z]+\s+\d{1,2},|\d{4}-\d\d-\d\d/i.test(a + " " + b);
      return monthOnly ? da.slice(0, 7) === db.slice(0, 7) : da === db;
    }
    case "text": {
      // Slice stand-in for embedding similarity ≥ 0.85: token-set ratio ≥ 85.
      return tokenSetRatio(normaliseForMatch(a), normaliseForMatch(b)) >= 85;
    }
  }
}

/**
 * Agreement for one fact of model A.
 * @param mode   "rule" when the fact came from rules/mock/structured data; "single" when there is no
 *               distinct model B; "compare" when model B ran.
 * @param bValues values model B gave for the same slot (scalar) or the same list (list fields).
 * @param scalar true when B's value is for the same slot, so a mismatch is a dispute; false for list
 *               members, where "not found in B's list" only means `single`.
 */
export function agreementFor(
  mode: "rule" | "single" | "compare",
  kind: ValueKind,
  aValue: string,
  bValues: (string | null | undefined)[],
  scalar: boolean,
): AgreementLabel {
  if (mode === "rule") return "rule";
  if (mode === "single") return "single";
  const present = bValues.filter((v): v is string => Boolean(v && v.trim()));
  if (!present.length) return "single";
  if (present.some((b) => valuesAgree(kind, aValue, b))) return "both";
  return scalar ? "disputed" : "single";
}
