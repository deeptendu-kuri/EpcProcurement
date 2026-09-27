// @vitest-environment node
/**
 * Acceptance check (docs/mvp/12 §6.2): fixtures → pipeline → REAL scoring, offline with the mock AI.
 * Guards "at least 3 leads across at least 2 classes, at least 1 genuine" and the proof invariants.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import type { LeadRow, RunRow } from "@/mvp/types";
import { startRun, waitForRun } from "./index";

let db: Db;
const KEYS = ["MVP_OFFLINE", "GROQ_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
  process.env.MVP_OFFLINE = "1";
  for (const key of KEYS.slice(1)) delete process.env[key];
}, 120_000);

afterAll(async () => {
  setDbForTests(undefined);
  await db?.close();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("offline showcase run (fixtures → pipeline → scoring)", () => {
  it("produces ≥ 3 leads in ≥ 2 classes with ≥ 1 genuine, consistent scores and quoted evidence", async () => {
    const runId = await startRun({ query: "line pipe", markets: ["IN", "SA", "AE", "NO", "MY"], leadKinds: ["bid", "supply_subcontract"] });
    await waitForRun(runId);
    const run = (await db.query<RunRow>("select * from runs where id = $1", [runId])).rows[0];
    expect(run.status).toBe("done");
    expect(run.error).toBeNull();

    const leads = (await db.query<LeadRow>("select * from leads")).rows;
    expect(leads.length).toBeGreaterThanOrEqual(3);
    const classes = new Set(leads.map((lead) => lead.class));
    expect(classes.size).toBeGreaterThanOrEqual(2);
    expect(leads.filter((lead) => lead.class === "genuine").length).toBeGreaterThanOrEqual(1);

    for (const lead of leads) {
      expect(lead.gate_results).toHaveLength(8);
      if (lead.score === null) continue;
      const total = (lead.score_breakdown?.criteria ?? []).reduce((sum, criterion) => sum + criterion.total, 0);
      expect(total, `lead ${lead.id} breakdown total`).toBe(lead.score);
    }

    const evidence = (await db.query<{ quote: string | null }>("select quote from evidence")).rows;
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((row) => typeof row.quote === "string" && row.quote.trim().length > 0)).toBe(true);
  }, 120_000);
});
