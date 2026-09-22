import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { composeProject } from "../repos/projects.js";
import { findAssetUsage } from "../services/asset-service.js";
import { HttpError } from "../services/errors.js";
import { sendStored } from "./http-util.js";

const Params = z.object({ id: z.string().regex(/^prj_[a-z0-9]{8,32}$/) });
const AssetParams = Params.extend({ assetId: z.string().regex(/^ast_[a-z0-9]{8,32}$/) });

export async function assetRoutes(app: FastifyInstance, ctx: AppContext) {
  const loadComposed = async (id: string) => {
    const row = await ctx.projects.get(id);
    if (!row) throw new HttpError(404, "not-found", "Proyecto no encontrado");
    return composeProject(row, await ctx.assets.list(id));
  };

  app.get("/api/projects/:id/assets", async (req) => {
    const { id } = Params.parse(req.params);
    const project = await loadComposed(id);
    return {
      assets: project.assets.map(({ storageKey: _k, ...a }) => ({ ...a, usage: findAssetUsage(project, a.id) })),
    };
  });

  /** Subida multipart en streaming (nunca Base64 ni JSON). */
  app.post("/api/projects/:id/assets", async (req, reply) => {
    const { id } = Params.parse(req.params);
    if (!(await ctx.projects.get(id))) throw new HttpError(404, "not-found", "Proyecto no encontrado");
    if (!req.isMultipart()) throw new HttpError(415, "multipart-required", "La subida debe ser multipart/form-data");
    const results: Array<{ asset: Record<string, unknown>; duplicate: boolean; filename: string }> = [];
    for await (const part of req.files()) {
      const { asset, duplicate } = await ctx.assetService.upload(id, part.filename, part.file, () => part.file.truncated);
      const { storageKey: _k, ...pub } = asset;
      results.push({ asset: pub, duplicate, filename: part.filename });
    }
    if (!results.length) throw new HttpError(422, "no-files", "No se recibió ningún archivo");
    return reply.code(201).send({ results });
  });

  app.get("/api/projects/:id/assets/:assetId/content", async (req, reply) => {
    const { id, assetId } = AssetParams.parse(req.params);
    const asset = await ctx.assets.get(id, assetId);
    if (!asset) throw new HttpError(404, "not-found", "Asset no encontrado");
    // El contenido de un id nunca cambia: cache inmutable. El sandbox CSP
    // neutraliza cualquier script si el archivo se abre directamente.
    reply
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox")
      .header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
    return sendStored(reply, ctx.storage, asset.storageKey, asset.size, asset.mimeType, req.headers.range);
  });

  app.delete("/api/projects/:id/assets/:assetId", async (req, reply) => {
    const { id, assetId } = AssetParams.parse(req.params);
    await ctx.assetService.remove(await loadComposed(id), assetId);
    return reply.code(204).send();
  });
}
