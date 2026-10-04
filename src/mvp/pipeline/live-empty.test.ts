// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { startRun, waitForRun, liveSources } from "./index";
import { fixturesSource } from "./sources/fixtures";
import type { RunRow } from "@/mvp/types";
vi.mock("@/mvp/scoring", () => ({ buildSignalsAndScore: vi.fn(async () => ({ created: 0, updated: 0 })) }));
let db: Db;
beforeAll(async () => { db = await createTestDb(); setDbForTests(db); }, 120_000);
afterAll(async () => { setDbForTests(undefined); await db?.close(); });
beforeEach(() => {
  vi.stubEnv("MVP_OFFLINE", "0"); vi.stubEnv("GROQ_API_KEY", "");
  for (const source of liveSources()) vi.spyOn(source, "collect").mockResolvedValue([]);
  vi.spyOn(fixturesSource, "collect").mockRejectedValue(new Error("Sample fallback must never run in live mode"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function run() {
  const id = await startRun({ query: "line pipe", productId: "line-pipe", markets: ["IN"], leadKinds: ["supply_subcontract"] });
  await waitForRun(id);
  return (await db.query<RunRow>("select * from runs where id=$1", [id])).rows[0];
}
describe("real search has no sample substitution", () => {
  it("finishes an empty answered search with zero saved prospects and no fixtures", async () => {
    const r = await run();
    expect(r.status).toBe("done"); expect(r.counters).toMatchObject({ scopedProspects: 0, newLeads: 0, sourcesTotal: 4 });
    expect(fixturesSource.collect).not.toHaveBeenCalled();
    expect((await db.query("select id from source_documents")).rows).toEqual([]);
    const events = (await db.query<{ message: string }>("select message from run_events where run_id=$1 order by id", [r.id])).rows;
    expect(events.some(e => e.message.includes("No sample data was substituted"))).toBe(true);
    expect(events.at(-1)?.message).toContain("0 buyer prospects saved");
  });
  it("fails honestly when every live source fails, rather than inserting samples", async () => {
    for (const source of liveSources()) vi.mocked(source.collect).mockRejectedValue(new Error("upstream unavailable"));
    const r = await run();
    expect(r.status).toBe("failed"); expect(r.error).toContain("All live sources failed");
    expect(fixturesSource.collect).not.toHaveBeenCalled();
    expect((await db.query("select id from source_documents")).rows).toEqual([]);
  });
});
