// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations, migrationConnectionString } from "./db-migrate.mjs";

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    if (path.dirname(dir) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith("buyer-migration-test-")) throw new Error("Unsafe test cleanup target");
    rmSync(dir, { recursive: true, force: true });
  }
});
function clientOf(db) {
  return { query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1) };
}
describe("cloud migration command", () => {
  it("uses the direct Neon endpoint for session locks while retaining credentials and SSL parameters", () => {
    const pooled = "postgresql://user:fake_password@ep-demo-123-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    expect(migrationConnectionString(pooled)).toBe(pooled.replace("-pooler.", "."));
    expect(migrationConnectionString("postgresql://user:fake_password@other-pooler.example.com/app")).toContain("other-pooler.example.com");
  });
  it("supports an explicit migration URL and rejects missing or non-Postgres URLs", () => {
    expect(migrationConnectionString("postgresql://user:fake@runtime.example.com/app", "postgresql://user:fake@direct.example.com/app")).toContain("direct.example.com");
    expect(() => migrationConnectionString("")).toThrow(/DATABASE_URL is required/);
    expect(() => migrationConnectionString("https://example.com")).toThrow(/PostgreSQL/);
  });
  it("applies all MVP migrations and skips every one on a second run", async () => {
    const db = await PGlite.create();
    try {
      const applied = await applyMigrations(clientOf(db));
      expect(applied).toHaveLength(16);
      expect(applied.at(-1)).toBe("016_buyer_discovery_and_demo_delivery.sql");
      expect(await applyMigrations(clientOf(db))).toEqual([]);
      expect((await db.query("select demo_only, delivery_state from outreach_drafts")).rows).toEqual([]);
      expect((await db.query("select keyword, product_name from search_opportunities")).rows).toEqual([]);
      expect((await db.query("select action, status from enrichment_requests")).rows).toEqual([]);
      expect((await db.query("select enabled from funnel_control")).rows).toEqual([{enabled:false}]);
      expect((await db.query("select state from funnel_threads")).rows).toEqual([]);
    } finally { await db.close(); }
  }, 120_000);
  it("rolls back a failing migration without recording it or losing earlier migrations", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "buyer-migration-test-")); tempDirs.push(dir);
    writeFileSync(path.join(dir, "001_ok.sql"), "create table retained (id int);");
    writeFileSync(path.join(dir, "002_bad.sql"), "create table must_rollback (id int); select * from missing_table;");
    const db = await PGlite.create();
    try {
      await expect(applyMigrations(clientOf(db), dir)).rejects.toThrow();
      expect((await db.query("select name from schema_migrations")).rows).toEqual([{ name: "001_ok.sql" }]);
      expect((await db.query("select to_regclass('must_rollback') as name")).rows[0].name).toBeNull();
      expect((await db.query("select * from retained")).rows).toEqual([]);
    } finally { await db.close(); }
  }, 120_000);
});
