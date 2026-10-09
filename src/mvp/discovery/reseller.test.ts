// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buyerEvidence, type DiscoveredBuyer } from "./index";
import type { RunInput } from "@/mvp/types";

const company = "Al Noor Steel Trading LLC";
const quote = `${company} is a stockist and supplier of stainless steel pipes to contractors across the UAE.`;
const buyer: DiscoveredBuyer = { company, country: null, role: "channel_customer", companyQuote: quote, countryQuote: null, productQuote: quote, project: null, projectQuote: null, confidence: 0.5 };
const input = (includeResellers?: boolean): RunInput => ({ query: "Welded Stainless Steel Pipes", productId: "ss-duplex-pipe", markets: ["AE"], leadKinds: ["supply_subcontract"], ...(includeResellers === undefined ? {} : { includeResellers }) });

describe("reseller buyers in verification (docs/mvp/19 Phase 2)", () => {
  it("accepts a stockist that supplies the material when the search includes resellers (the default)", () => {
    expect(buyerEvidence(buyer, quote, input()).buyer?.company).toBe(company);
    expect(buyerEvidence(buyer, quote, input(true)).buyer).not.toBeNull();
  });
  it("needs explicit buying-for-resale evidence when resellers are off", () => {
    expect(buyerEvidence(buyer, quote, input(false)).reason).toMatch(/channel purchasing is not evidenced/i);
  });
  it("still requires the searched material", () => {
    const other = `${company} is a stockist and supplier of electrical cables to contractors.`;
    expect(buyerEvidence({ ...buyer, companyQuote: other, productQuote: other }, other, input()).buyer).toBeNull();
  });
});
