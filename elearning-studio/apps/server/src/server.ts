import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { createStorage } from "./storage/index.js";

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
const storage = createStorage(cfg);
await migrate(db);
await storage.healthCheck();

const webDist = cfg.WEB_DIST ?? fileURLToPath(new URL("../../web/dist/", import.meta.url));
const { app } = await buildApp({ config: { ...cfg, WEB_DIST: webDist }, db, storage, startWorker: true });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "cerrando servidor");
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: cfg.PORT, host: cfg.HOST });
