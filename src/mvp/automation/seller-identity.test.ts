import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATION_RECIPIENT, demoCustomer, requireFunnelConfig, seller, sellerSignature } from "./config";
import { TRIGGER_KIND_LABELS, triggerKindLabel } from "@/mvp/buyers/types";
import { buildBingQueries } from "@/mvp/pipeline/sources/bing-news";

afterEach(() => vi.unstubAllEnvs());

describe("seller identity in demo emails", () => {
  it("signs as the configured seller and never with the demo inbox, which plays the buyer", () => {
    vi.stubEnv("SALES_PERSON_NAME", "Example Seller");
    vi.stubEnv("SALES_COMPANY_NAME", "Example Supplies LLC");
    vi.stubEnv("SALES_PERSON_EMAIL", "");
    const s = seller();
    expect(s.name).toBe("Example Seller");
    expect(s.email).toBeNull();
    const signature = sellerSignature();
    expect(signature).toContain("Example Seller");
    expect(signature).toContain("Example Supplies LLC");
    expect(signature).not.toContain(AUTOMATION_RECIPIENT);
  });

  it("ignores a seller email that equals the demo recipient", () => {
    vi.stubEnv("SALES_PERSON_EMAIL", AUTOMATION_RECIPIENT.toUpperCase());
    expect(seller().email).toBeNull();
    expect(sellerSignature()).not.toContain(AUTOMATION_RECIPIENT);
  });

  it("shows the seller's own email when one is configured", () => {
    vi.stubEnv("SALES_PERSON_EMAIL", "sales@example.com");
    expect(seller().email).toBe("sales@example.com");
    expect(sellerSignature()).toContain("sales@example.com");
  });

  it("never presents the demo customer's configured name as the salesperson", () => {
    vi.stubEnv("DEMO_CUSTOMER_NAME", "Hritik Debnath");
    vi.stubEnv("SALES_PERSON_NAME", "Hritik Debnath");
    expect(demoCustomer()).toEqual({name:"Hritik Debnath",email:AUTOMATION_RECIPIENT});
    expect(seller().name).toBe("Procurement Sales Team");
    expect(sellerSignature()).not.toContain("Hritik Debnath");
  });

  it("uses the same seller display name for delivery without changing the authorised address", () => {
    for(const [key,value] of Object.entries({DEMO_EMAIL_ENABLED:'1',DEMO_RECIPIENT_EMAIL:AUTOMATION_RECIPIENT,RESEND_API_KEY:'Example-test-only',
      RESEND_RECEIVING_DOMAIN:'example.resend.app',GROQ_API_KEY:'Example-test-only',EMAILABLE_API_KEY:'live_Example_test_only',
      DEMO_EMAIL_FROM:'Hritik <onboarding@resend.dev>',SALES_PERSON_NAME:'Example Seller',SALES_COMPANY_NAME:'Example Supplies',
      VERCEL:'',RENDER:'',AWS_LAMBDA_FUNCTION_NAME:''}))vi.stubEnv(key,value);
    expect(requireFunnelConfig().from).toBe('Example Seller · Example Supplies <onboarding@resend.dev>');
    expect(requireFunnelConfig().recipient).toBe(AUTOMATION_RECIPIENT);
  });
});

describe("plain trigger labels", () => {
  it("describes an award as a won contract, not a prize", () => {
    expect(TRIGGER_KIND_LABELS.award).toBe("Contract won");
    expect(triggerKindLabel("capability")).toMatch(/no contract yet/);
    expect(triggerKindLabel(null)).toBe("Not established");
  });
});

describe("any-country news queries", () => {
  it("uses the full country name for countries outside the default markets", () => {
    const queries = buildBingQueries(["line pipe"], "KE");
    expect(queries.some((q) => q.includes("Kenya"))).toBe(true);
    expect(queries.every((q) => !/\bKE\b/.test(q))).toBe(true);
  });
});
