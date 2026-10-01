import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import pg from "pg";

export function loadProjectEnv() {
  const require = createRequire(import.meta.url);
  const { loadEnvConfig } = createRequire(require.resolve("next/package.json"))("@next/env");
  loadEnvConfig(process.cwd());
}

/** Session advisory locks require a direct connection, not Neon's transaction pooler. */
export function migrationConnectionString(databaseUrl, override) {
  const connectionString = override?.trim() || databaseUrl?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required. Use your new cloud demo database; local PGlite files are not migrated by this command.");
  let url;
  try { url = new URL(connectionString); }
  catch { throw new Error("The migration database URL is invalid."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("The migration database URL must use PostgreSQL.");
  if (url.hostname.endsWith(".neon.tech") && /^ep-[a-z0-9-]+-pooler\./i.test(url.hostname)) {
    url.hostname = url.hostname.replace(/-pooler\./i, ".");
    return url.toString();
  }
  return connectionString;
}

/** Same migration directory and registry as the active MVP database; no legacy Supabase SQL. */
export async function applyMigrations(client, dir = path.join(process.cwd(), "src/mvp/db/migrations")) {
  const files = readdirSync(dir).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
  await client.query("select pg_advisory_lock(78240322)");
  const applied = [];
  try {
    await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    const done = new Set((await client.query("select name from schema_migrations")).rows.map(row => row.name));
    for (const name of files) {
      if (done.has(name)) continue;
      await client.query("begin");
      try {
        await client.query(readFileSync(path.join(dir, name), "utf8"));
        await client.query("insert into schema_migrations (name) values ($1)", [name]);
        await client.query("commit");
        applied.push(name);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }
    return applied;
  } finally { await client.query("select pg_advisory_unlock(78240322)").catch(() => undefined); }
}

export async function migrateCloud() {
  loadProjectEnv();
  const connectionString = migrationConnectionString(process.env.DATABASE_URL, process.env.MIGRATION_DATABASE_URL);
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    await client.query("set timezone to 'UTC'");
    const applied = await applyMigrations(client);
    console.log(applied.length ? `Applied ${applied.length} migrations: ${applied.join(", ")}` : "Database is up to date. No migrations needed.");
  } finally { await client.end().catch(() => undefined); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrateCloud().catch(error => {
    // Connection errors can contain credentials. Redact known secrets before logging.
    let message = error instanceof Error ? error.message : "Migration failed.";
    for (const name of ["DATABASE_URL", "MIGRATION_DATABASE_URL", "RESEND_API_KEY", "GROQ_API_KEY", "SESSION_SECRET", "DEMO_PASSWORD"])
      if (process.env[name]) message = message.split(process.env[name]).join("[redacted]");
    message = message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted database URL]");
    console.error(`Migration failed: ${message}`);
    process.exitCode = 1;
  });
}
