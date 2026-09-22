import { randomUUID } from "node:crypto";
import type { Asset, CourseProject } from "@studio/schema";
import { tx, type Db } from "../db/pool.js";

export type ProjectRow = {
  id: string;
  title: string;
  schemaVersion: string;
  document: CourseProject;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = { id: string; title: string; revision: number; updatedAt: string; createdAt: string; slideCount: number };

export type VersionRow = {
  id: string;
  projectId: string;
  versionNumber: number;
  revision: number;
  kind: "manual" | "publication" | "restore-backup";
  label: string | null;
  createdAt: string;
};

/** Los assets no se guardan dentro del documento: la tabla assets es la fuente de verdad. */
function stripAssets(p: CourseProject): CourseProject {
  return { ...p, assets: [] };
}

const toRow = (r: Record<string, any>): ProjectRow => ({
  id: r.id,
  title: r.title,
  schemaVersion: r.schema_version,
  document: r.document,
  revision: r.revision,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});

const toVersion = (r: Record<string, any>): VersionRow => ({
  id: r.id,
  projectId: r.project_id,
  versionNumber: r.version_number,
  revision: r.revision,
  kind: r.kind,
  label: r.label,
  createdAt: new Date(r.created_at).toISOString(),
});

export class ProjectRepo {
  constructor(private readonly db: Db) {}

  async list(): Promise<ProjectSummary[]> {
    const r = await this.db.query(
      `SELECT id, title, revision, created_at, updated_at,
         (SELECT COALESCE(SUM(jsonb_array_length(m->'slides')), 0)
            FROM jsonb_array_elements(document->'modules') m)::int AS slide_count
       FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500`,
    );
    return r.rows.map((x) => ({
      id: x.id,
      title: x.title,
      revision: x.revision,
      createdAt: new Date(x.created_at).toISOString(),
      updatedAt: new Date(x.updated_at).toISOString(),
      slideCount: x.slide_count,
    }));
  }

  async get(id: string): Promise<ProjectRow | null> {
    const r = await this.db.query("SELECT * FROM projects WHERE id = $1 AND deleted_at IS NULL", [id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async create(project: CourseProject): Promise<ProjectRow> {
    const r = await this.db.query(
      `INSERT INTO projects (id, title, schema_version, document) VALUES ($1, $2, $3, $4) RETURNING *`,
      [project.id, project.title, project.schemaVersion, stripAssets(project)],
    );
    return toRow(r.rows[0]);
  }

  /** Guardado con concurrencia optimista. */
  async update(id: string, project: CourseProject, baseRevision: number): Promise<{ ok: true; row: ProjectRow } | { ok: false; currentRevision: number | null }> {
    const r = await this.db.query(
      `UPDATE projects SET document = $3, title = $4, schema_version = $5, revision = revision + 1, updated_at = now()
       WHERE id = $1 AND revision = $2 AND deleted_at IS NULL RETURNING *`,
      [id, baseRevision, stripAssets(project), project.title, project.schemaVersion],
    );
    if (r.rows[0]) return { ok: true, row: toRow(r.rows[0]) };
    const cur = await this.db.query("SELECT revision FROM projects WHERE id = $1 AND deleted_at IS NULL", [id]);
    return { ok: false, currentRevision: cur.rows[0]?.revision ?? null };
  }

  async softDelete(id: string): Promise<boolean> {
    const r = await this.db.query("UPDATE projects SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async createVersion(projectId: string, kind: VersionRow["kind"], label: string | null): Promise<VersionRow> {
    return tx(this.db, async (c) => {
      const p = await c.query("SELECT document, revision FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [projectId]);
      if (!p.rows[0]) throw new Error("Proyecto no encontrado");
      const n = await c.query("SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM project_versions WHERE project_id = $1", [projectId]);
      const r = await c.query(
        `INSERT INTO project_versions (id, project_id, version_number, revision, kind, label, document)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [randomUUID(), projectId, n.rows[0].n, p.rows[0].revision, kind, label, p.rows[0].document],
      );
      return toVersion(r.rows[0]);
    });
  }

  async listVersions(projectId: string): Promise<VersionRow[]> {
    const r = await this.db.query(
      "SELECT id, project_id, version_number, revision, kind, label, created_at FROM project_versions WHERE project_id = $1 ORDER BY version_number DESC",
      [projectId],
    );
    return r.rows.map(toVersion);
  }

  async getVersionDocument(projectId: string, versionId: string): Promise<CourseProject | null> {
    const r = await this.db.query("SELECT document FROM project_versions WHERE project_id = $1 AND id = $2", [projectId, versionId]);
    return r.rows[0]?.document ?? null;
  }

  /** Restaura una versión guardando antes una copia de respaldo del estado actual. */
  async restoreVersion(projectId: string, versionId: string): Promise<ProjectRow> {
    return tx(this.db, async (c) => {
      const v = await c.query("SELECT document FROM project_versions WHERE project_id = $1 AND id = $2", [projectId, versionId]);
      if (!v.rows[0]) throw new Error("Versión no encontrada");
      const p = await c.query("SELECT document, revision FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [projectId]);
      if (!p.rows[0]) throw new Error("Proyecto no encontrado");
      const n = await c.query("SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM project_versions WHERE project_id = $1", [projectId]);
      await c.query(
        `INSERT INTO project_versions (id, project_id, version_number, revision, kind, label, document)
         VALUES ($1, $2, $3, $4, 'restore-backup', 'Respaldo automático antes de restaurar', $5)`,
        [randomUUID(), projectId, n.rows[0].n, p.rows[0].revision, p.rows[0].document],
      );
      const doc = v.rows[0].document as CourseProject;
      const r = await c.query(
        `UPDATE projects SET document = $2, title = $3, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`,
        [projectId, doc, doc.title],
      );
      return toRow(r.rows[0]);
    });
  }
}

export function composeProject(row: ProjectRow, assets: Asset[]): CourseProject {
  return { ...row.document, assets };
}
