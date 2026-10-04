/**
 * Database access for the showcase slice (docs/mvp/12 §2, §4).
 *
 * - Default: PGlite (Postgres in WebAssembly) with data in `.data/pglite`.
 * - If `DATABASE_URL` is set: the same SQL runs on Postgres/Supabase through `pg`.
 * - Migrations in `src/mvp/db/migrations/NNN_*.sql` are applied once, in order, and recorded
 *   in `schema_migrations`.
 *
 * Server-only. Use `$1, $2…` placeholders in both backends.
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface QueryResult<T> {
  rows: T[];
}

/** Query surface shared by the database and by a transaction handle. */
export interface Queryable {
  /** Run one parameterised statement. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Run one or more statements without parameters (DDL, scripts). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Run `fn` inside a transaction; commits on resolve, rolls back on throw. */
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Which backend is in use. */
  readonly kind: "pglite" | "pg";
  /** Close the underlying connection(s). Mainly for tests. */
  close(): Promise<void>;
}

export const MIGRATIONS_DIR = path.join(process.cwd(), "src", "mvp", "db", "migrations");

// ───────────────────────── migrations ─────────────────────────

/** Migration files sorted by name (`NNN_name.sql`). */
export function listMigrations(dir = MIGRATIONS_DIR): { name: string; sql: string }[] {
  return readdirSync(dir)
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(dir, name), "utf8") }));
}

/** Apply every migration not yet recorded in `schema_migrations`. Returns the names applied. */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set(
    (await db.query<{ name: string }>("select name from schema_migrations")).rows.map((row) => row.name),
  );
  const applied: string[] = [];
  for (const migration of listMigrations(dir)) {
    if (done.has(migration.name)) continue;
    await db.tx(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query("insert into schema_migrations (name) values ($1)", [migration.name]);
    });
    applied.push(migration.name);
  }
  return applied;
}

// ───────────────────────── type parsing ─────────────────────────
// Both backends return the same JS shapes:
//   timestamptz/timestamp -> ISO string ("2026-09-27T10:00:00.000Z"), date -> "YYYY-MM-DD",
//   numeric/int8 -> number, json/jsonb -> parsed value, text[]/uuid[] -> string[].

const OID = { int8: 20, numeric: 1700, date: 1082, timestamp: 1114, timestamptz: 1184 } as const;

/** Convert Postgres ISO-style timestamp text into an ISO-8601 UTC string. */
export function pgTimestampToIso(value: string): string {
  let normalised = value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  if (!/(Z|[+-]\d\d:\d\d)$/i.test(normalised)) normalised += "Z";
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

const PARSERS: Record<number, (value: string) => unknown> = {
  [OID.int8]: (value) => Number(value),
  [OID.numeric]: (value) => Number(value),
  [OID.date]: (value) => value,
  [OID.timestamp]: pgTimestampToIso,
  [OID.timestamptz]: pgTimestampToIso,
};

// ───────────────────────── PGlite backend ─────────────────────────

async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const options = { parsers: PARSERS };
  const pg = dataDir ? await PGlite.create(dataDir, options) : await PGlite.create(options);
  await pg.exec("set timezone to 'UTC'");

  const wrap = (target: {
    query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
    exec(sql: string): Promise<unknown>;
  }): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      const result = await target.query<T>(sql, params as unknown[] | undefined);
      return { rows: result.rows };
    },
    async exec(sql: string) {
      await target.exec(sql);
    },
  });

  const base = wrap(pg);
  // PGlite is single-connection: serialise transactions so concurrent callers don't interleave.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    kind: "pglite",
    query: base.query,
    exec: base.exec,
    tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const run = chain.then(() => pg.transaction((tx) => fn(wrap(tx))));
      chain = run.catch(() => undefined);
      return run;
    },
    close: () => pg.close(),
  };
}

// ───────────────────────── pg backend ─────────────────────────

async function createPgDb(connectionString: string): Promise<Db> {
  const { Pool, types } = await import("pg");
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 15_000,
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        PARSERS[oid] ?? types.getTypeParser(oid, format ?? "text")) as typeof types.getTypeParser,
    },
  });
  pool.on("connect", (client) => {
    void client.query("set timezone to 'UTC'");
  });
  return {
    kind: "pg",
    async query<T>(sql: string, params?: unknown[]) {
      const result = await pool.query(sql, params as unknown[] | undefined);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const value = await fn({
          async query<R>(sql: string, params?: unknown[]) {
            const result = await client.query(sql, params as unknown[] | undefined);
            return { rows: result.rows as R[] };
          },
          async exec(sql: string) {
            await client.query(sql);
          },
        });
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// ───────────────────────── singleton ─────────────────────────

const globalForDb = globalThis as unknown as { __mvpDb?: Promise<Db> };

function initDb(): Promise<Db> {
  if (!globalForDb.__mvpDb) {
    const pending = (async () => {
      const url = process.env.DATABASE_URL?.trim();
      if ((process.env.RENDER === "true" || process.env.VERCEL === "1") && !url) throw new Error("DATABASE_URL is required on cloud hosts; a local database is not persistent.");
      const db = url ? await createPgDb(url) : await createPgliteDb(process.env.MVP_DATA_DIR || path.join(process.cwd(), ".data", "pglite"));
      await migrate(db);
      return db;
    })();
    globalForDb.__mvpDb = pending;
    // Let a failed init be retried on the next call instead of caching the rejection forever.
    pending.catch(() => {
      if (globalForDb.__mvpDb === pending) globalForDb.__mvpDb = undefined;
    });
  }
  return globalForDb.__mvpDb;
}

/**
 * The process-wide database. Connects and migrates lazily on the first call of any method,
 * and survives Next.js hot reloads (singleton on globalThis).
 *
 * @example
 * const { rows } = await getDb().query<LeadRow>("select * from leads where id = $1", [id]);
 */
export function getDb(): Db {
  return {
    get kind() {
      return process.env.DATABASE_URL?.trim() ? ("pg" as const) : ("pglite" as const);
    },
    query: async <T>(sql: string, params?: unknown[]) => (await initDb()).query<T>(sql, params),
    exec: async (sql: string) => (await initDb()).exec(sql),
    tx: async <T>(fn: (tx: Queryable) => Promise<T>) => (await initDb()).tx(fn),
    close: async () => {
      const pending = globalForDb.__mvpDb;
      globalForDb.__mvpDb = undefined;
      if (pending) await (await pending).close();
    },
  };
}

/** A fresh in-memory PGlite database with all migrations applied. For tests. */
export async function createTestDb(): Promise<Db> {
  const db = await createPgliteDb();
  await migrate(db);
  return db;
}

/**
 * Point `getDb()` at a given database (e.g. one from `createTestDb()`), or reset it with `undefined`.
 * For tests only.
 *
 * @example
 * const db = await createTestDb(); setDbForTests(db); // ... getDb() now uses db
 */
export function setDbForTests(db: Db | undefined): void {
  globalForDb.__mvpDb = db ? Promise.resolve(db) : undefined;
}
