import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createProject, loadProject, SchemaVersionError } from "@studio/schema";
import { ZodError } from "zod";
import type { AppContext } from "../app.js";
import { composeProject } from "../repos/projects.js";
import { HttpError } from "../services/errors.js";

const IdParams = z.object({ id: z.string().regex(/^prj_[a-z0-9]{8,32}$/) });

export async function projectRoutes(app: FastifyInstance, ctx: AppContext) {
  const { projects, assets } = ctx;

  const requireProject = async (id: string) => {
    const row = await projects.get(id);
    if (!row) throw new HttpError(404, "not-found", "Proyecto no encontrado");
    return row;
  };

  app.get("/api/projects", async () => ({ projects: await projects.list() }));

  app.post("/api/projects", async (req, reply) => {
    const body = z
      .object({ title: z.string().trim().min(1).max(200), template: z.enum(["blank", "qa"]).default("blank"), locale: z.string().min(2).max(20).default("es") })
      .parse(req.body);
    if (body.template === "qa") {
      const row = await ctx.samples.createQaProject(body.title);
      return reply.code(201).send({ project: composeProject(row, await assets.list(row.id)), revision: row.revision });
    }
    const project = createProject({ title: body.title, locale: body.locale });
    const row = await projects.create(project);
    return reply.code(201).send({ project: composeProject(row, []), revision: row.revision });
  });

  app.get("/api/projects/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const row = await requireProject(id);
    return { project: composeProject(row, await assets.list(id)), revision: row.revision, updatedAt: row.updatedAt };
  });

  app.put("/api/projects/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const body = z.object({ baseRevision: z.number().int().min(1), project: z.unknown() }).parse(req.body);
    let project;
    try {
      project = loadProject(body.project).project;
    } catch (err) {
      if (err instanceof SchemaVersionError) throw new HttpError(422, "schema-version", err.message);
      if (err instanceof ZodError) {
        throw new HttpError(422, "invalid-project", "El proyecto no cumple el esquema", err.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })));
      }
      throw err;
    }
    if (project.id !== id) throw new HttpError(422, "id-mismatch", "El id del documento no corresponde a la URL");
    const r = await projects.update(id, project, body.baseRevision);
    if (!r.ok) {
      if (r.currentRevision === null) throw new HttpError(404, "not-found", "Proyecto no encontrado");
      return reply.code(409).send({
        error: { code: "revision-conflict", message: "El proyecto fue modificado en otra pestaña o sesión. Recarga para ver la última versión.", details: { currentRevision: r.currentRevision } },
      });
    }
    return { revision: r.row.revision, updatedAt: r.row.updatedAt };
  });

  app.delete("/api/projects/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!(await projects.softDelete(id))) throw new HttpError(404, "not-found", "Proyecto no encontrado");
    return reply.code(204).send();
  });

  /** Validación completa = pipeline de publicación sin ZIP. */
  app.post("/api/projects/:id/validate", async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = z.object({ standard: z.enum(["scorm12", "scorm2004"]).default("scorm12") }).parse(req.body ?? {});
    const { project } = await ctx.publish.loadProject(id);
    const result = await ctx.publish.build(project, ctx.publish.profileFor(project, body.standard));
    return { ok: result.ok, report: result.report, steps: result.steps, files: result.entries.length, totalBytes: result.totalBytes };
  });

  app.get("/api/projects/:id/versions", async (req) => {
    const { id } = IdParams.parse(req.params);
    await requireProject(id);
    return { versions: await projects.listVersions(id) };
  });

  app.post("/api/projects/:id/versions", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const body = z.object({ label: z.string().trim().max(200).optional() }).parse(req.body ?? {});
    await requireProject(id);
    const v = await projects.createVersion(id, "manual", body.label || null);
    return reply.code(201).send({ version: v });
  });

  app.post("/api/projects/:id/versions/:versionId/restore", async (req) => {
    const { id, versionId } = IdParams.extend({ versionId: z.string().uuid() }).parse(req.params);
    await requireProject(id);
    const row = await projects.restoreVersion(id, versionId).catch((e: Error) => {
      throw new HttpError(404, "not-found", e.message);
    });
    return { project: composeProject(row, await assets.list(id)), revision: row.revision };
  });
}
