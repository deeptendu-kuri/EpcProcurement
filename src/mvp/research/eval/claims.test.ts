// @vitest-environment node
/**
 * Claims quality (docs/mvp/22 §3.16): every saved buyer must be a true claim. Always: replay the hand-labelled real
 * claims through the current rules; no false claim may become a lead, and only listed known misses may be missed.
 * Opt-in: EVAL_LIVE=1 asks the live AI about each source again (about 4k tokens a claim) and scores its answers.
 * Scores are written to tmp/eval-claims.json and printed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import golden from "./claims-golden.json";
import { replayClaim, scoreClaims, type ClaimResult, type ClaimsGolden } from "./claims";
import { registerSearchItemTerms } from "@/mvp/discovery/item";
import { itemTerms } from "../engine";

const set = golden as unknown as ClaimsGolden;
const write = (label: string, results: ClaimResult[]) => {
  const score = scoreClaims(results);
  fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "tmp", `eval-claims-${label}.json`), JSON.stringify({ score, results }, null, 2));
  console.log(`claims (${label}): ${score.leads} leads, precision ${score.precision}, recall ${score.recall}`
    + score.falseLeads.map((r) => `\n  FALSE LEAD ${r.company} (${r.id})`).join("")
    + score.missed.map((r) => `\n  missed ${r.company} (${r.id}): ${r.reason}${r.knownMiss ? ` [known: ${r.knownMiss}]` : ""}`).join(""));
  return score;
};
// Each search registers its item's names (the engine does this when a run starts).
for (const brief of Object.values(set.briefs)) if (brief.productId) registerSearchItemTerms(brief.productId, itemTerms(brief));

describe("claims golden set", () => {
  it("is real, labelled and balanced", () => {
    expect(set.rows.length).toBeGreaterThanOrEqual(50);
    expect(new Set(set.rows.map((r) => r.id)).size).toBe(set.rows.length);
    expect(set.rows.every((r) => set.briefs[r.brief] && r.source.url && r.source.text.length > 50 && r.quote)).toBe(true);
    expect(set.rows.filter((r) => r.truth === "buyer").length).toBeGreaterThanOrEqual(10);
    expect(set.rows.filter((r) => r.truth === "not_buyer").length).toBeGreaterThanOrEqual(25);
  });

  it("never saves a false claim, and misses only the known recall gaps", () => {
    const score = write("rules", set.rows.map((r) => replayClaim(set, r)));
    expect(score.falseLeads.map((r) => r.company)).toEqual([]);
    expect(score.missed.filter((r) => !r.knownMiss).map((r) => `${r.company}: ${r.reason}`)).toEqual([]);
    expect(score.precision).toBe(1);
  }, 60_000);

  it.runIf(process.env.EVAL_LIVE === "1")("scores the live AI's answers on the same sources", async () => {
    const { getLLM } = await import("@/mvp/llm");
    const { needPrompt } = await import("../need");
    const { getDb } = await import("@/mvp/db");
    const provider = getLLM("extract_a", getDb(), "openai/gpt-oss-120b");
    const results: ClaimResult[] = [];
    for (const r of set.rows) {
      const brief = set.briefs[r.brief];
      const doc = { text: `${r.source.title ?? ""}\n${r.source.text}`, url: r.source.url, title: r.source.title, publishedAt: r.source.publishedAt };
      const res = await provider.complete({ ...needPrompt(doc, brief), json: true, maxTokens: 3000, temperature: 0, purpose: "need_check" });
      results.push(replayClaim(set, r, res.text));
    }
    write("live", results);
  }, 1_800_000);
});
