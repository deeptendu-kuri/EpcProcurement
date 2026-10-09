import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATION_RECIPIENT, seller, sellerSignature } from "./config";
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
