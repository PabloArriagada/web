import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { safeFilename } from "@studio/schema";
import type { AppContext } from "../app.js";
import type { PublicationRow } from "../repos/publications.js";
import { HttpError } from "../services/errors.js";

const toDto = ({ storageKey, ...p }: PublicationRow) => ({
  ...p,
  downloadUrl: p.status === "completed" && storageKey ? `/api/publications/${p.id}/download` : null,
});

export async function publicationRoutes(app: FastifyInstance, ctx: AppContext) {
  const ProjectParams = z.object({ id: z.string().regex(/^prj_[a-z0-9]{8,32}$/) });

  app.post("/api/projects/:id/publications", async (req, reply) => {
    const { id } = ProjectParams.parse(req.params);
    const body = z.object({ profileId: z.string().min(1) }).parse(req.body);
    const pub = await ctx.publish.requestPublication(id, body.profileId);
    return reply.code(202).send({ publication: toDto(pub) });
  });

  app.get("/api/projects/:id/publications", async (req) => {
    const { id } = ProjectParams.parse(req.params);
    return { publications: (await ctx.publications.list(id)).map(toDto) };
  });

  app.get("/api/publications/:pubId", async (req) => {
    const { pubId } = z.object({ pubId: z.string().uuid() }).parse(req.params);
    const pub = await ctx.publications.get(pubId);
    if (!pub) throw new HttpError(404, "not-found", "Publicación no encontrada");
    return { publication: toDto(pub) };
  });

  app.get("/api/publications/:pubId/download", async (req, reply) => {
    const { pubId } = z.object({ pubId: z.string().uuid() }).parse(req.params);
    const pub = await ctx.publications.get(pubId);
    if (!pub || pub.status !== "completed" || !pub.storageKey || pub.size === null) {
      throw new HttpError(404, "not-ready", "La publicación no está disponible para descarga");
    }
    const project = await ctx.projects.get(pub.projectId);
    const name = `${safeFilename(project?.title ?? "curso")}-${pub.standard}.zip`;
    reply
      .type("application/zip")
      .header("Content-Length", pub.size)
      .header("Content-Disposition", `attachment; filename="${name}"`)
      .header("Cache-Control", "no-store");
    return reply.send(await ctx.storage.read(pub.storageKey));
  });
}
