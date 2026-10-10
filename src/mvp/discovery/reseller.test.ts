// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buyerEvidence, type DiscoveredBuyer } from "./index";
import type { RunInput } from "@/mvp/types";

const company = "Al Noor Steel Trading LLC";
const quote = `${company} is a stockist and supplier of stainless steel pipes to contractors across the UAE.`;
const buyer: DiscoveredBuyer = { company, country: null, role: "channel_customer", companyQuote: quote, countryQuote: null, productQuote: quote, project: null, projectQuote: null, confidence: 0.5 };
const input = (includeResellers?: boolean): RunInput => ({ query: "Welded Stainless Steel Pipes", productId: "ss-duplex-pipe", markets: ["AE"], leadKinds: ["supply_subcontract"], ...(includeResellers === undefined ? {} : { includeResellers }) });

describe("stockists are secondary, never leads (10 Oct)", () => {
  it("never saves a stockist as a lead, whatever the stockist setting", () => {
    for (const setting of [undefined, true, false]) {
      const result = buyerEvidence(buyer, quote, input(setting));
      expect(result.buyer).toBeNull();
      expect(result.reason).toMatch(/Stockist or trader: shown as secondary, not saved as a lead/);
    }
  });
});

describe("owners and operators as buyers (docs/mvp/19 §6)", () => {
  const owner = "Gulf Gas Transmission Company operates and maintains 1,200 km of gas transmission pipelines in the UAE and procures line pipe for its expansion.";
  const b: DiscoveredBuyer = { company: "Gulf Gas Transmission Company", country: null, role: "owner", companyQuote: owner, countryQuote: null, productQuote: owner, project: null, projectQuote: null, confidence: 0.5 };
  const lineInput: RunInput = { query: "line pipe", productId: "line-pipe", markets: ["AE"], leadKinds: ["supply_subcontract"] };
  it("accepts an operator that runs and buys for pipelines", () => {
    expect(buyerEvidence(b, owner, lineInput).buyer?.role).toBe("owner");
  });
  it("rejects a contractor labelled as an owner", () => {
    const epc = "Atlas Works is an EPC contractor operating gas transmission pipeline construction in the UAE.";
    expect(buyerEvidence({ ...b, company: "Atlas Works", companyQuote: epc, productQuote: epc }, epc, lineInput).reason).toMatch(/owner must operate/i);
  });
});
