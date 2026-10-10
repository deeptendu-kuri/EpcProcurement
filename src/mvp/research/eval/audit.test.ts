// @vitest-environment node
/**
 * Lead quality against the independent web audit of 10 Oct 2026 (97 companies from three searches, graded
 * A–D by a supplier's view; see the PDF "Lead quality audit"). Replays, with the current rules and the
 * stored AI ratings (no AI call), which companies would be saved as leads, and scores what gets saved.
 * A = the client would love it, B = real buyer but indirect, C = weak, D = not a buyer / not a company.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { getCatalogueItem } from "@/mvp/config/buyers-config";
import audit from "./audit-10oct.json";
import { leadDecision, type AuditRow } from "./audit-score";

const rows = audit as AuditRow[];

export function auditScore(list: AuditRow[] = rows) {
  const saved = list.filter((r) => leadDecision(r, getCatalogueItem(r.productId)?.shortName ?? r.productId).lead);
  const by = (g: string) => saved.filter((r) => r.grade === g).length;
  const n = saved.length || 1;
  const missedGood = list.filter((r) => (r.grade === "A") && !saved.includes(r)).map((r) => r.name);
  return { audited: list.length, saved: saved.length, A: by("A"), B: by("B"), C: by("C"), D: by("D"),
    realBuyers: Math.round((100 * (by("A") + by("B"))) / n), notBuyers: Math.round((100 * by("D")) / n), missedA: missedGood,
    savedD: saved.filter((r) => r.grade === "D").map((r) => r.name) };
}

describe("lead quality against the 10 Oct web audit", () => {
  it("is a complete audit set", () => {
    expect(rows.length).toBe(97);
    expect(new Set(rows.map((r) => r.grade))).toEqual(new Set(["A", "B", "C", "D"]));
  });
  it("reports what the current rules would save", () => {
    const score = auditScore();
    fs.mkdirSync("tmp", { recursive: true });
    fs.writeFileSync("tmp/audit-score.json", JSON.stringify(score, null, 1));
    console.log("[audit]", JSON.stringify(score));
    // Target from the audit report: real buyers (A+B) >= 70% of saved leads, non-buyers (D) <= 10%.
    expect(score.realBuyers).toBeGreaterThanOrEqual(70);
    expect(score.notBuyers).toBeLessThanOrEqual(10);
  }, 30_000);
});

/**
 * Opt-in (AUDIT_LIVE=1, about 15k AI tokens): re-rate the audited companies with the current AI instructions
 * and score what would be saved. Usage is recorded in a throwaway database, never the app's.
 */
describe.skipIf(!process.env.AUDIT_LIVE)("live AI re-rating of the audited companies", () => {
  it("rates and scores", async () => {
    // The AI keys from .env.local (never printed); variables already set win.
    for (const line of (fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && /^(?:GROQ_|CLOUDFLARE_|LLM_)/.test(m[1]) && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
    const { getLLM } = await import("@/mvp/llm");
    const { rateRows } = await import("../shortlist");
    const { createTestDb } = await import("@/mvp/db");
    const usageDb = await createTestDb();
    const provider = getLLM("triage", usageDb);
    const rerated: AuditRow[] = [];
    for (const set of [...new Set(rows.map((r) => r.set))]) {
      const list = rows.filter((r) => r.set === set);
      const first = list[0];
      const rated = await rateRows(list.map((r, i) => ({ id: String(i), company: r.name, identity_quote: r.quote, title: r.title })),
        { productId: first.productId, query: first.query, resellers: first.includeResellers, markets: first.markets }, () => provider);
      for (const r of rated) {
        const base = list[Number(r.id)];
        rerated.push({ ...base, rating: r.raw ?? r.rating, role: r.role, reason: r.reason, type: r.buyerType ?? null, source: r.source === "ai" ? "ai" : "rules" });
      }
      console.log(`[audit live ${set}] AI calls ${rated.aiCalls ?? 0}${rated.warning ? `; ${rated.warning}` : ""}`);
    }
    const score = auditScore(rerated);
    fs.mkdirSync("tmp", { recursive: true });
    fs.writeFileSync("tmp/audit-live.json", JSON.stringify({ score, rows: rerated.map((r) => ({ name: r.name, grade: r.grade, rating: r.rating, type: r.type, role: r.role, reason: r.reason })) }, null, 1));
    console.log("[audit live]", JSON.stringify(score));
    await usageDb.close();
  }, 1_800_000);
});
