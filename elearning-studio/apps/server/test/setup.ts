import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { FsStorage } from "../src/storage/fs.js";

export const TEST_DB = process.env["TEST_DATABASE_URL"] ?? "postgres://studio:studio@localhost:5432/studio_test";

export async function dbAvailable(): Promise<boolean> {
  const c = new pg.Client({ connectionString: TEST_DB, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

export async function resetDb(): Promise<Db> {
  const db = createPool(TEST_DB);
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(db);
  return db;
}

export async function makeTestApp(db: Db, opts: { maxUpload?: number; storageRoot?: string } = {}) {
  const root = opts.storageRoot ?? (await mkdtemp(join(tmpdir(), "studio-test-")));
  const storage = new FsStorage(root);
  const { app, ctx } = await buildApp({
    config: { LOG_LEVEL: "silent", MAX_UPLOAD_BYTES: opts.maxUpload ?? 50 * 1024 * 1024, PREVIEW_TTL_MINUTES: 5, WEB_DIST: undefined },
    db,
    storage,
    startWorker: false,
    videoFixture: new URL("../../../fixtures/sample-video.webm", import.meta.url),
  });
  await app.ready();
  return { app, ctx, storage, root, cleanup: async () => { await app.close(); } , removeStorage: () => rm(root, { recursive: true, force: true }) };
}

/** Cuerpo multipart/form-data para app.inject. */
export function multipart(files: Array<{ name: string; data: Buffer; type?: string }>) {
  const boundary = `----studio${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: ${f.type ?? "application/octet-stream"}\r\n\r\n`),
      f.data,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
