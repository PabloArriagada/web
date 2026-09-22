import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.js";

export type JobRow = {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  error: string | null;
};

const toRow = (r: Record<string, any>): JobRow => ({
  id: r.id,
  type: r.type,
  status: r.status,
  payload: r.payload,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  error: r.error,
});

export class JobRepo {
  constructor(private readonly db: Db) {}

  async enqueue(type: string, payload: Record<string, unknown>, maxAttempts = 3): Promise<JobRow> {
    const r = await this.db.query(
      "INSERT INTO jobs (id, type, status, payload, max_attempts) VALUES ($1, $2, 'queued', $3, $4) RETURNING *",
      [randomUUID(), type, payload, maxAttempts],
    );
    return toRow(r.rows[0]);
  }

  /** Toma el siguiente trabajo disponible (seguro con varios workers). */
  async claim(): Promise<JobRow | null> {
    const r = await this.db.query(
      `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
       WHERE id = (
         SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now()
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
       ) RETURNING *`,
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async complete(id: string): Promise<void> {
    await this.db.query("UPDATE jobs SET status = 'completed', progress = 100, updated_at = now() WHERE id = $1", [id]);
  }

  /** Reintenta con backoff exponencial o marca como fallido definitivo. */
  async fail(job: JobRow, error: string, retryable: boolean): Promise<"retry" | "failed"> {
    if (retryable && job.attempts < job.maxAttempts) {
      const delay = 2 ** job.attempts * 5;
      await this.db.query(
        `UPDATE jobs SET status = 'queued', error = $2, locked_at = NULL, run_after = now() + ($3 || ' seconds')::interval, updated_at = now() WHERE id = $1`,
        [job.id, error, String(delay)],
      );
      return "retry";
    }
    await this.db.query("UPDATE jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1", [job.id, error]);
    return "failed";
  }

  /** Recupera trabajos que quedaron "running" tras una caída del proceso. */
  async requeueStale(minutes = 15): Promise<number> {
    const r = await this.db.query(
      `UPDATE jobs SET status = 'queued', locked_at = NULL, updated_at = now()
       WHERE status = 'running' AND locked_at < now() - ($1 || ' minutes')::interval`,
      [String(minutes)],
    );
    return r.rowCount ?? 0;
  }
}
