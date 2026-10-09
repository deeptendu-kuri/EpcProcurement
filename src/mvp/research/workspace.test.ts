// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readableEvents } from "./workspace";

describe("search workspace activity (docs/mvp/18 §4)", () => {
  it("uses plain words and merges repeats", () => {
    const e = (id: number, message: string) => ({ id, ts: "2026-10-09T18:33:00Z", message });
    expect(readableEvents([
      e(9, "registry: 1 original-page candidates. Discovery is saved; contact validation is separate."),
      e(8, "registry: 1 original-page candidates. Discovery is saved; contact validation is separate."),
      e(7, "Bing coverage limit reached; remaining sources and saved pages continue."),
      e(6, "Bing coverage limit reached; remaining sources and saved pages continue."),
      e(5, "Bing coverage limit reached; remaining sources and saved pages continue."),
      e(4, "Shortlist: rated 20 companies; 6 look like buyers."),
      e(3, ""),
    ]).map((x) => x.message)).toEqual([
      "Found 1 company page in a directory. ×2",
      "Web search allowance for this search used up; carrying on with the pages already found. ×3",
      "Shortlist: rated 20 companies; 6 look like buyers.",
    ]);
  });
});
