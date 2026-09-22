import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
  STORAGE_FS_ROOT: z.string().default("./.data/storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("studio-assets"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).default(500 * 1024 * 1024),
  PREVIEW_TTL_MINUTES: z.coerce.number().int().min(1).default(60),
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida:\n${msg}`);
  }
  const cfg = parsed.data;
  if (cfg.STORAGE_DRIVER === "s3" && (!cfg.S3_ACCESS_KEY_ID || !cfg.S3_SECRET_ACCESS_KEY)) {
    throw new Error("STORAGE_DRIVER=s3 requiere S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY");
  }
  return cfg;
}
