// @vitest-environment node
import { describe, expect, it } from "vitest";
import { placeOf } from "./search";
import { available } from "@/components/mvp/search/filter-panel";
import type { BuyerRecord } from "./view";

const record = (hqCountry: string | null, siteCountry: string | null, site: string | null = null) => ({ hqCountry, siteCountry, site }) as BuyerRecord;

describe("SuperSearch filters within a search (docs/mvp/18 task 2)", () => {
  it("filters by HQ, falling back to where the company works when its HQ is not known", () => {
    expect(placeOf(record("AE", "SA"), "hq").country).toBe("AE");
    expect(placeOf(record(null, "IN", "Pune"), "hq")).toEqual({ country: "IN", site: "Pune" });
    expect(placeOf(record("AE", "SA", "Jubail"), "site")).toEqual({ country: "SA", site: "Jubail" });
    expect(placeOf(record("AE", null), "site").country).toBe("AE");
    expect(placeOf(record(null, null), "hq").country).toBeNull();
  });
  it("offers only options some company in scope has, keeping what is already chosen", () => {
    const options = [{ value: "oil_gas", count: 3 }, { value: "water", count: 0 }, { value: "power" }];
    expect(available(options, [], true).map((o) => o.value)).toEqual(["oil_gas"]);
    expect(available(options, ["power"], true).map((o) => o.value)).toEqual(["oil_gas", "power"]);
    expect(available(options, [], false)).toHaveLength(3);
  });
});
