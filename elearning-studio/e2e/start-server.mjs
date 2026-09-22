// Servidor para E2E: base de datos y almacenamiento aislados y limpios.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://studio:studio@localhost:5432/studio_e2e";
const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
await client.end();

const child = spawn(process.execPath, ["apps/server/dist/server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL,
    STORAGE_DRIVER: "fs",
    STORAGE_FS_ROOT: mkdtempSync(join(tmpdir(), "studio-e2e-")),
    LOG_LEVEL: "warn",
    HOST: "127.0.0.1",
  },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
