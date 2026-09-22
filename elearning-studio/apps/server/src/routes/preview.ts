import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { HttpError } from "../services/errors.js";
import { sendStored } from "./http-util.js";

export async function previewRoutes(app: FastifyInstance, ctx: AppContext) {
  /**
   * Compila el proyecto guardado con el MISMO pipeline de publicación y lo
   * expone archivo por archivo. Lo que se ve aquí es lo que entra al ZIP.
   */
  app.post("/api/projects/:id/preview", async (req) => {
    const { id } = z.object({ id: z.string().regex(/^prj_[a-z0-9]{8,32}$/) }).parse(req.params);
    const body = z.object({ standard: z.enum(["scorm12", "scorm2004"]).default("scorm12") }).parse(req.body ?? {});
    const p = await ctx.publish.createPreview(id, body.standard);
    return {
      buildId: p.id,
      revision: p.revision,
      standard: p.standard,
      ok: p.result.ok,
      launchUrl: p.result.ok ? `/api/preview/${p.id}/${p.result.launch}` : null,
      report: p.result.report,
      steps: p.result.steps,
      files: [...p.entries.values()].map((e) => ({ path: e.path, mime: e.mime, size: e.source.kind === "inline" ? e.source.data.length : e.source.size })),
    };
  });

  app.get("/api/preview/:buildId/*", async (req, reply) => {
    const params = z.object({ buildId: z.string().uuid(), "*": z.string().min(1) }).parse(req.params);
    const build = ctx.publish.getPreview(params.buildId);
    if (!build) throw new HttpError(404, "preview-expired", "El preview expiró. Vuelve a generarlo.");
    const entry = build.entries.get(params["*"]);
    if (!entry) throw new HttpError(404, "not-found", `El paquete no contiene ${params["*"]}`);
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
    const mime = entry.mime.startsWith("text/") || entry.mime === "application/json" || entry.mime === "application/xml" ? `${entry.mime}; charset=utf-8` : entry.mime;
    if (entry.source.kind === "inline") {
      return reply.type(mime).send(Buffer.from(entry.source.data));
    }
    return sendStored(reply, ctx.storage, entry.source.storageKey, entry.source.size, mime, req.headers.range);
  });
}
