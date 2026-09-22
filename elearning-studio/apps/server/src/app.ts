import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db/pool.js";
import { JobWorker } from "./jobs/worker.js";
import { AssetRepo } from "./repos/assets.js";
import { JobRepo } from "./repos/jobs.js";
import { ProjectRepo } from "./repos/projects.js";
import { PublicationRepo } from "./repos/publications.js";
import { assetRoutes } from "./routes/assets.js";
import { previewRoutes } from "./routes/preview.js";
import { projectRoutes } from "./routes/projects.js";
import { publicationRoutes } from "./routes/publications.js";
import { AssetService } from "./services/asset-service.js";
import { HttpError } from "./services/errors.js";
import { PublishService } from "./services/publish-service.js";
import { SampleService } from "./services/samples.js";
import type { ObjectStorage } from "./storage/types.js";

export type AppContext = {
  db: Db;
  storage: ObjectStorage;
  projects: ProjectRepo;
  assets: AssetRepo;
  publications: PublicationRepo;
  jobs: JobRepo;
  assetService: AssetService;
  publish: PublishService;
  samples: SampleService;
  worker: JobWorker;
};

export type AppOptions = {
  config: Pick<Config, "LOG_LEVEL" | "MAX_UPLOAD_BYTES" | "PREVIEW_TTL_MINUTES" | "WEB_DIST">;
  db: Db;
  storage: ObjectStorage;
  /** Iniciar el worker de la cola (desactivado en pruebas para controlarlo). */
  startWorker?: boolean;
  videoFixture?: URL | null;
};

export async function buildApp(opts: AppOptions): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const app = Fastify({
    logger: opts.config.LOG_LEVEL === "silent" ? false : { level: opts.config.LOG_LEVEL },
    bodyLimit: 20 * 1024 * 1024, // documentos JSON del proyecto (sin binarios)
    genReqId: () => crypto.randomUUID(),
  });

  const projects = new ProjectRepo(opts.db);
  const assets = new AssetRepo(opts.db);
  const publications = new PublicationRepo(opts.db);
  const jobs = new JobRepo(opts.db);
  const assetService = new AssetService(assets, opts.storage, opts.config.MAX_UPLOAD_BYTES);
  const publish = new PublishService({ projects, assets, publications, jobs, storage: opts.storage, log: app.log, previewTtlMs: opts.config.PREVIEW_TTL_MINUTES * 60_000 });
  const samples = new SampleService({
    projects,
    assetService,
    videoFixture: opts.videoFixture === undefined ? new URL("../../../fixtures/sample-video.webm", import.meta.url) : opts.videoFixture,
  });
  const worker = new JobWorker({ jobs, publications, publish, log: app.log });
  const ctx: AppContext = { db: opts.db, storage: opts.storage, projects, assets, publications, jobs, assetService, publish, samples, worker };

  await app.register(multipart, { limits: { fileSize: opts.config.MAX_UPLOAD_BYTES, files: 20, fields: 10 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.code(422).send({ error: { code: "invalid-input", message: "Datos de entrada inválidos", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 413 || e.code === "FST_REQ_FILE_TOO_LARGE" || e.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(413).send({ error: { code: "too-large", message: "El archivo o la solicitud supera el tamaño máximo permitido" } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: e.code ?? "bad-request", message: e.message ?? "Solicitud inválida" } });
    }
    req.log.error({ err }, "error no controlado");
    return reply.code(500).send({ error: { code: "internal", message: "Error interno del servidor" } });
  });

  app.get("/api/health", async () => {
    await opts.db.query("SELECT 1");
    await opts.storage.healthCheck();
    return { ok: true, storage: opts.storage.driver };
  });

  await projectRoutes(app, ctx);
  await assetRoutes(app, ctx);
  await previewRoutes(app, ctx);
  await publicationRoutes(app, ctx);

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: { code: "not-found", message: "Ruta no encontrada" } });
    }
    // SPA: cualquier otra ruta devuelve index.html si la web está compilada.
    if (webDist) return reply.sendFile("index.html");
    return reply.code(404).send({ error: { code: "not-found", message: "La app web no está compilada (npm run build)" } });
  });

  const webDist = opts.config.WEB_DIST ? resolve(opts.config.WEB_DIST) : null;
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/", wildcard: false, index: ["index.html"] });
  }

  if (opts.startWorker) {
    app.addHook("onReady", async () => worker.start());
    app.addHook("onClose", async () => worker.stop());
  }
  return { app, ctx };
}
