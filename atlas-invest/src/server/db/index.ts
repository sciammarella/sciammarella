import fs from "node:fs";
import path from "node:path";

// Database access layer. Two drivers behind one interface:
//   * DATABASE_URL set → node-postgres pool (PostgreSQL / Supabase)
//   * otherwise        → PGlite (embedded PostgreSQL in WASM) persisted to PGLITE_DIR
// Both run the same SQL migrations and enforce the same row-level security.

export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface Driver {
  kind: "pglite" | "postgres";
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const tsToIso = (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString();

async function createPglite(dir?: string): Promise<Driver> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const db = new PGlite(dir, {
    parsers: { [types.DATE]: (v: string) => v, [types.TIMESTAMPTZ]: tsToIso },
  });
  await db.waitReady;
  return {
    kind: "pglite",
    async transaction(fn) {
      return db.transaction(async (t) => fn({ query: async (sql, params) => (await t.query(sql, params as unknown[])).rows as never }));
    },
    async exec(sql) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
}

async function createPostgres(url: string): Promise<Driver> {
  const pg = await import("pg");
  const Pool = pg.default?.Pool ?? pg.Pool;
  const typesMod = pg.default?.types ?? pg.types;
  typesMod.setTypeParser(1082, (v: string) => v);
  typesMod.setTypeParser(1184, (v: string) => tsToIso(v));
  const pool = new Pool({ connectionString: url, max: 10 });
  return {
    kind: "postgres",
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn({ query: async (sql, params) => (await client.query(sql, params as unknown[])).rows as never });
        await client.query("commit");
        return result;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

async function migrate(driver: Driver): Promise<void> {
  await driver.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (await driver.transaction((tx) => tx.query<{ name: string }>("select name from schema_migrations"))).map((r) => r.name),
  );
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await driver.exec(`begin; ${sql}; insert into schema_migrations(name) values ('${f}'); commit;`);
  }
}

const g = globalThis as unknown as { __atlasDb?: Promise<Driver> };

/** Options are only used by tests (in-memory PGlite). */
export function getDriver(opts?: { memory?: boolean }): Promise<Driver> {
  if (!g.__atlasDb) {
    g.__atlasDb = (async () => {
      const url = process.env.DATABASE_URL;
      let driver: Driver;
      if (url && !opts?.memory) {
        driver = await createPostgres(url);
      } else {
        const dir = opts?.memory ? undefined : path.resolve(process.env.PGLITE_DIR || "./.data/pglite");
        if (dir) fs.mkdirSync(dir, { recursive: true });
        driver = await createPglite(dir);
      }
      await migrate(driver);
      return driver;
    })().catch((e) => {
      g.__atlasDb = undefined;
      throw e;
    });
  }
  return g.__atlasDb;
}

export async function resetDriverForTests(): Promise<void> {
  if (g.__atlasDb) {
    const d = await g.__atlasDb;
    await d.close();
    g.__atlasDb = undefined;
  }
}

/** Run as the owner. Only for system jobs and auth; never for user-facing reads. */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const d = await getDriver();
  return d.transaction(fn);
}

/** Run with row-level security as the given user. All user-scoped data access goes through here. */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("invalid user id");
  const d = await getDriver();
  return d.transaction(async (tx) => {
    await tx.query("set local role atlas_app");
    await tx.query("select set_config('app.user_id', $1, true)", [userId]);
    return fn(tx);
  });
}

export async function driverKind(): Promise<"pglite" | "postgres"> {
  return (await getDriver()).kind;
}

export function uuid(): string {
  return crypto.randomUUID();
}
