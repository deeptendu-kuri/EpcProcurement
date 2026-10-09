// @vitest-environment node
/**
 * Golden-set checks (docs/mvp/19 Phase 0). Always: the set is well formed and the scorer is right.
 * Opt-in:
 *   EVAL_FILES="plates-9oct=tmp/a.json,steelpipe-9oct=tmp/b.json" → score saved /companies exports;
 *   EVAL_LIVE=1 → rate the golden inputs with the live AI rater (costs about 25k tokens) and score them.
 * Scores are written to tmp/eval-<label>.json and printed.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import golden from "./golden.json";
import { LIKELY, goldKey, isBuyer, scoreShortlist, type GoldRow, type Prediction } from "./score";

const rows = golden as GoldRow[];
const LABELS = ["end_user", "contractor", "subcontractor", "owner", "reseller", "competitor", "not_buyer"];

describe("golden set", () => {
  it("is labelled, unique and covers every search", () => {
    expect(rows.length).toBeGreaterThanOrEqual(180);
    expect(rows.every((r) => LABELS.includes(r.label) && r.name && r.product)).toBe(true);
    expect(new Set(rows.map(goldKey)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.set))).toEqual(new Set(["plates-9oct", "steelpipe-9oct", "weldedss-9oct"]));
    expect(rows.filter((r) => isBuyer(r.label) && !r.unsure).length).toBeGreaterThanOrEqual(45);
  });
  it("scores precision, junk, recall and competitor slips", () => {
    const sample: GoldRow[] = [
      { set: "s", product: "plates", name: "Fab", said: "", page: "", label: "end_user" },
      { set: "s", product: "plates", name: "EPC", said: "", page: "", label: "contractor" },
      { set: "s", product: "plates", name: "Mill", said: "", page: "", label: "competitor" },
      { set: "s", product: "plates", name: "Agency", said: "", page: "", label: "not_buyer" },
      { set: "s", product: "plates", name: "Maybe", said: "", page: "", label: "end_user", unsure: true },
    ];
    const p = new Map<string, Prediction>([["s|Fab", { rating: 90, buyerType: "end_user" }], ["s|EPC", { rating: 30, buyerType: "subcontractor" }],
      ["s|Mill", { rating: 70, buyerType: "end_user" }], ["s|Agency", { rating: 5 }], ["s|Maybe", { rating: 99 }]]);
    const { overall } = scoreShortlist(sample, p);
    expect(overall).toMatchObject({ scored: 4, buyers: 2, likely: 2, junkInLikely: 0.5, recall: 0.5, competitorsLikely: 1, precisionTop20: 0.5, typeAccuracy: 0.667 });
    expect(LIKELY).toBe(45);
  });
});

function report(label: string, predictions: Map<string, Prediction>) {
  const result = scoreShortlist(rows, predictions);
  fs.mkdirSync("tmp", { recursive: true });
  fs.writeFileSync(`tmp/eval-${label}.json`, JSON.stringify(result, null, 1));
  console.log(`[eval ${label}]`, JSON.stringify(result.overall), result.sets.map((s) => `${s.set}: p@20 ${s.precisionTop20} likely ${s.likely} junk ${s.junkInLikely} recall ${s.recall} competitors ${s.competitorsLikely} type ${s.typeAccuracy}`).join(" | "));
  return result;
}

describe.skipIf(!process.env.EVAL_FILES)("score saved search exports", () => {
  it("scores", () => {
    const predictions = new Map<string, Prediction>();
    for (const pair of process.env.EVAL_FILES!.split(",")) {
      const [set, file] = pair.split("=");
      for (const c of JSON.parse(fs.readFileSync(file, "utf8")).companies as { name: string; rating: number | null; relevant: boolean; buyerType?: string | null }[])
        predictions.set(goldKey({ set, name: c.name.replace(/\s+/g, " ").trim() }), { rating: c.rating ?? (c.relevant ? 30 : 0), buyerType: c.buyerType ?? null });
    }
    report(process.env.EVAL_LABEL ?? "files", predictions);
  });
});

describe.skipIf(!process.env.EVAL_LIVE)("live AI rating of the golden inputs", () => {
  it("rates and scores", async () => {
    const { getLLM } = await import("@/mvp/llm");
    const { rateRows } = await import("../shortlist");
    const predictions = new Map<string, Prediction>();
    const provider = getLLM("triage");
    for (const set of [...new Set(rows.map((r) => r.set))]) {
      const list = rows.filter((r) => r.set === set);
      const rated = await rateRows(list.map((r, i) => ({ id: String(i), company: r.name, identity_quote: r.said || null, title: r.page || null })), { productId: list[0].product }, () => provider);
      for (const r of rated) predictions.set(goldKey(list[Number(r.id)]), { rating: r.rating, buyerType: r.buyerType ?? null });
    }
    report(process.env.EVAL_LABEL ?? "live", predictions);
  }, 600_000);
});
