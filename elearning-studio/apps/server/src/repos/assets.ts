import type { Asset } from "@studio/schema";
import type { Db } from "../db/pool.js";

const toAsset = (r: Record<string, any>): Asset => ({
  id: r.id,
  projectId: r.project_id,
  type: r.type,
  filename: r.filename,
  mimeType: r.mime_type,
  size: Number(r.size),
  hash: r.hash,
  storageKey: r.storage_key,
  metadata: r.metadata ?? {},
});

export class AssetRepo {
  constructor(private readonly db: Db) {}

  async list(projectId: string): Promise<Asset[]> {
    const r = await this.db.query("SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at, id", [projectId]);
    return r.rows.map(toAsset);
  }
  async get(projectId: string, id: string): Promise<Asset | null> {
    const r = await this.db.query("SELECT * FROM assets WHERE project_id = $1 AND id = $2", [projectId, id]);
    return r.rows[0] ? toAsset(r.rows[0]) : null;
  }
  async findByHash(projectId: string, hash: string): Promise<Asset | null> {
    const r = await this.db.query("SELECT * FROM assets WHERE project_id = $1 AND hash = $2", [projectId, hash]);
    return r.rows[0] ? toAsset(r.rows[0]) : null;
  }
  /** Inserta; si otro proceso subió el mismo contenido a la vez devuelve null. */
  async insert(a: Asset): Promise<Asset | null> {
    const r = await this.db.query(
      `INSERT INTO assets (id, project_id, type, filename, mime_type, size, hash, storage_key, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (project_id, hash) DO NOTHING RETURNING *`,
      [a.id, a.projectId, a.type, a.filename, a.mimeType, a.size, a.hash, a.storageKey, a.metadata],
    );
    return r.rows[0] ? toAsset(r.rows[0]) : null;
  }
  async delete(projectId: string, id: string): Promise<void> {
    await this.db.query("DELETE FROM assets WHERE project_id = $1 AND id = $2", [projectId, id]);
  }
}
