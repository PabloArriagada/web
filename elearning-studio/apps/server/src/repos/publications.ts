import type { PublicationProfile, ScormStandard, ValidationReport } from "@studio/schema";
import type { PipelineStep } from "@studio/publisher";
import type { Db } from "../db/pool.js";

export type PublicationStatus = "queued" | "building" | "completed" | "failed";

export type PublicationRow = {
  id: string;
  projectId: string;
  versionId: string | null;
  standard: ScormStandard;
  profile: PublicationProfile;
  status: PublicationStatus;
  report: ValidationReport | null;
  steps: PipelineStep[] | null;
  storageKey: string | null;
  size: number | null;
  snapshotHash: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

const toRow = (r: Record<string, any>): PublicationRow => ({
  id: r.id,
  projectId: r.project_id,
  versionId: r.version_id,
  standard: r.standard,
  profile: r.profile,
  status: r.status,
  report: r.report,
  steps: r.steps,
  storageKey: r.storage_key,
  size: r.size === null ? null : Number(r.size),
  snapshotHash: r.snapshot_hash,
  error: r.error,
  createdAt: new Date(r.created_at).toISOString(),
  completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
});

export class PublicationRepo {
  constructor(private readonly db: Db) {}

  async create(p: { id: string; projectId: string; versionId: string; profile: PublicationProfile }): Promise<PublicationRow> {
    const r = await this.db.query(
      `INSERT INTO publications (id, project_id, version_id, standard, profile, status) VALUES ($1,$2,$3,$4,$5,'queued') RETURNING *`,
      [p.id, p.projectId, p.versionId, p.profile.standard, p.profile],
    );
    return toRow(r.rows[0]);
  }
  async get(id: string): Promise<PublicationRow | null> {
    const r = await this.db.query("SELECT * FROM publications WHERE id = $1", [id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }
  async list(projectId: string): Promise<PublicationRow[]> {
    const r = await this.db.query("SELECT * FROM publications WHERE project_id = $1 ORDER BY created_at DESC LIMIT 50", [projectId]);
    return r.rows.map(toRow);
  }
  async markBuilding(id: string): Promise<void> {
    await this.db.query("UPDATE publications SET status = 'building', error = NULL WHERE id = $1", [id]);
  }
  async complete(id: string, d: { report: ValidationReport; steps: PipelineStep[]; storageKey: string; size: number; snapshotHash: string }): Promise<void> {
    await this.db.query(
      `UPDATE publications SET status = 'completed', report = $2, steps = $3, storage_key = $4, size = $5, snapshot_hash = $6, completed_at = now() WHERE id = $1`,
      [id, d.report, JSON.stringify(d.steps), d.storageKey, d.size, d.snapshotHash],
    );
  }
  async fail(id: string, d: { error: string; report?: ValidationReport | null; steps?: PipelineStep[] | null }): Promise<void> {
    await this.db.query(
      `UPDATE publications SET status = 'failed', error = $2, report = $3, steps = $4, completed_at = now() WHERE id = $1`,
      [id, d.error, d.report ?? null, d.steps ? JSON.stringify(d.steps) : null],
    );
  }
}
