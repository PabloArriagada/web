import type { FastifyBaseLogger } from "fastify";
import type { JobRepo } from "../repos/jobs.js";
import type { PublicationRepo } from "../repos/publications.js";
import type { PublishService } from "../services/publish-service.js";

/**
 * Worker en proceso: consulta la cola en PostgreSQL (FOR UPDATE SKIP
 * LOCKED), por lo que se pueden ejecutar varios servidores sin duplicar
 * trabajos. Para cargas mayores puede moverse a un proceso separado sin
 * cambiar la cola.
 */
export class JobWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private active: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: { jobs: JobRepo; publications: PublicationRepo; publish: PublishService; log: FastifyBaseLogger; intervalMs?: number },
  ) {}

  async start(): Promise<void> {
    const n = await this.deps.jobs.requeueStale();
    if (n) this.deps.log.warn({ count: n }, "trabajos recuperados tras reinicio");
    this.schedule(0);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.active = this.tick().finally(() => this.schedule(this.deps.intervalMs ?? 1000));
    }, ms);
  }

  /** Procesa trabajos hasta vaciar la cola. Expuesto para pruebas. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        if (this.stopped) break;
        const job = await this.deps.jobs.claim();
        if (!job) break;
        const log = this.deps.log.child({ jobId: job.id, type: job.type, attempt: job.attempts });
        try {
          if (job.type === "publish") {
            await this.deps.publish.runPublication(String(job.payload["publicationId"]));
          } else {
            throw new Error(`Tipo de trabajo desconocido: ${job.type}`);
          }
          await this.deps.jobs.complete(job.id);
          log.info("trabajo completado");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const outcome = await this.deps.jobs.fail(job, msg, true);
          log.error({ err: msg, outcome }, "trabajo fallido");
          if (outcome === "failed" && job.type === "publish") {
            await this.deps.publications.fail(String(job.payload["publicationId"]), { error: msg });
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }
}
