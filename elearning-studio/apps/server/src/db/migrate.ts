import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Db } from "./pool.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

/**
 * Aplica en orden las migraciones SQL pendientes, cada una en su propia
 * transacción. Un advisory lock evita que dos procesos migren a la vez.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(424242)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await client.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map((r) => r.id));
    const files = (await readdir(dir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(new URL(f, `file://${dir.endsWith("/") ? dir : dir + "/"}`), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [f]);
        await client.query("COMMIT");
        applied.push(f);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Falló la migración ${f}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(424242)").catch(() => undefined);
    client.release();
  }
  return applied;
}
