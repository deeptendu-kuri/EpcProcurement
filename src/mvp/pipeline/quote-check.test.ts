// @vitest-environment node
import { describe, expect, it } from "vitest";
import { agreementFor, valuesAgree } from "./agreement";
import { numericEquivalent, verifyQuote } from "./quote-check";
import { normalizeCompanyName, parseDate, parseMoney, tokenSetRatio } from "./text";

const DOC =
  "Example Infra Projects Ltd has received an EPC order from Example Gas Transmission Ltd.\n" +
  "The order is valued at Rs 1,450 crore. It covers   120 km of 24-inch API 5L X65 line pipe, per the “filing”.";

describe("quote check (06 §5)", () => {
  it("accepts a verbatim quote that contains the value and returns original offsets", () => {
    const r = verifyQuote("Example Gas Transmission Ltd", "an EPC order from Example Gas Transmission Ltd", DOC);
    expect(r.ok).toBe(true);
    expect(DOC.slice(r.start!, r.end!)).toBe("an EPC order from Example Gas Transmission Ltd");
  });

  it("tolerates case, whitespace and quote-style differences only", () => {
    expect(verifyQuote("120 km", "covers 120 KM of 24-inch", DOC).ok).toBe(true);
    expect(verifyQuote("filing", 'per the "filing"', DOC).ok).toBe(true);
  });

  it("rejects a quote that is not in the document", () => {
    expect(verifyQuote("Example Pipes", "awarded to Example Pipes", DOC)).toMatchObject({ ok: false, reason: "quote_not_found" });
  });

  it("rejects a value that is not inside its quote", () => {
    expect(verifyQuote("X70", "API 5L X65 line pipe", DOC)).toMatchObject({ ok: false, reason: "value_not_in_quote" });
  });

  it("accepts numerically equivalent values", () => {
    expect(numericEquivalent("14500000000", "Rs 1,450 crore")).toBe(true);
    expect(verifyQuote("14,500,000,000", "valued at Rs 1,450 crore", DOC).ok).toBe(true);
    expect(numericEquivalent("24", "24-inch")).toBe(true);
    expect(numericEquivalent("25", "24-inch")).toBe(false);
  });

  it("normalises Arabic alef variants, tatweel and diacritics", () => {
    const arabic = "أعلنت الشركة ترسية عقد خط الأنابيب على شركة المثال";
    expect(verifyQuote("ترسية عقد", "اعلنت الشركة ترسيـة عَقد", arabic).ok).toBe(true);
  });

  it("rejects empty facts", () => {
    expect(verifyQuote("", "x", DOC).ok).toBe(false);
    expect(verifyQuote("x", null, DOC).ok).toBe(false);
  });
});

describe("agreement (06 §4)", () => {
  it("labels facts by mode and comparison", () => {
    expect(agreementFor("rule", "name", "A", [], true)).toBe("rule");
    expect(agreementFor("single", "name", "A", ["B"], true)).toBe("single");
    expect(agreementFor("compare", "name", "Example Pipelines Ltd", ["Example Pipelines Limited"], true)).toBe("both");
    expect(agreementFor("compare", "enum", "awarded", ["epc_tender"], true)).toBe("disputed");
    expect(agreementFor("compare", "enum", "awarded", ["epc_tender"], false)).toBe("single");
    expect(agreementFor("compare", "number", "USD 450 million", [], true)).toBe("single");
  });

  it("compares numbers within 1% and dates by day or month", () => {
    expect(valuesAgree("number", "USD 450 million", "450,000,000")).toBe(true);
    expect(valuesAgree("number", "USD 450 million", "USD 480 million")).toBe(false);
    expect(valuesAgree("date", "12 August 2026", "August 12, 2026")).toBe(true);
    expect(valuesAgree("date", "August 2026", "2026-08-01")).toBe(true);
  });
});

describe("text helpers", () => {
  it("normalises company names and fuzzy-matches them", () => {
    expect(normalizeCompanyName("Example Emirates Gas Company PJSC")).toBe("example emirates gas");
    expect(normalizeCompanyName("Example Borneo Engineering Sdn Bhd")).toBe("example borneo engineering");
    expect(tokenSetRatio("example pipelines", "example pipelines india")).toBeGreaterThanOrEqual(92);
    expect(tokenSetRatio("example pipelines", "example valves")).toBeLessThan(92);
  });

  it("parses money and dates", () => {
    expect(parseMoney("Rs 1,450 crore")).toMatchObject({ amount: 14_500_000_000, currency: "INR" });
    expect(parseMoney("NOK 2.1 billion")).toMatchObject({ amount: 2_100_000_000, currency: "NOK" });
    expect(parseMoney("35000000 NOK")).toMatchObject({ amount: 35_000_000, currency: "NOK" });
    expect(parseDate("signed on 3 September 2026")).toBe("2026-09-03");
    expect(parseDate("March 2017")).toBe("2017-03-01");
  });
});
