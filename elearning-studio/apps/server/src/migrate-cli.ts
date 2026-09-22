import { loadConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { createPool } from "./db/pool.js";

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `Migraciones aplicadas: ${applied.join(", ")}` : "La base de datos ya está al día.");
} finally {
  await db.end();
}
