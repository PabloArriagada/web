import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPackage,
  loadDefaultFonts,
  loadRuntimeBundle,
  readZipDirectory,
  writeZip,
  type AssetReader,
  type BuildResult,
  type FontFile,
  type PackageEntry,
  type RuntimeBundle,
} from "@studio/publisher";
import { safeFilename, type CourseProject, type PublicationProfile, type ScormStandard } from "@studio/schema";
import type { FastifyBaseLogger } from "fastify";
import type { AssetRepo } from "../repos/assets.js";
import type { JobRepo } from "../repos/jobs.js";
import { composeProject, type ProjectRepo } from "../repos/projects.js";
import type { PublicationRepo } from "../repos/publications.js";
import type { ObjectStorage } from "../storage/types.js";
import { HttpError } from "./errors.js";

export type PreviewBuild = {
  id: string;
  projectId: string;
  revision: number;
  standard: ScormStandard;
  createdAt: number;
  entries: Map<string, PackageEntry>;
  result: Omit<BuildResult, "entries" | "course">;
};

export function storageReader(storage: ObjectStorage): AssetReader {
  return {
    stat: (k) => storage.stat(k),
    async *read(k) {
      const s = await storage.read(k);
      for await (const c of s) yield c as Uint8Array;
    },
  };
}

export class PublishService {
  private runtime: RuntimeBundle | null = null;
  private fonts: FontFile[] | null = null;
  private readonly previews = new Map<string, PreviewBuild>();

  constructor(
    private readonly deps: {
      projects: ProjectRepo;
      assets: AssetRepo;
      publications: PublicationRepo;
      jobs: JobRepo;
      storage: ObjectStorage;
      log: FastifyBaseLogger;
      previewTtlMs: number;
    },
  ) {}

  private async resources() {
    this.runtime ??= await loadRuntimeBundle();
    this.fonts ??= await loadDefaultFonts();
    return { runtime: this.runtime, fonts: this.fonts };
  }

  async loadProject(projectId: string): Promise<{ project: CourseProject; revision: number }> {
    const row = await this.deps.projects.get(projectId);
    if (!row) throw new HttpError(404, "not-found", "Proyecto no encontrado");
    return { project: composeProject(row, await this.deps.assets.list(projectId)), revision: row.revision };
  }

  profileFor(project: CourseProject, standard: ScormStandard, profileId?: string): PublicationProfile {
    const byId = profileId ? project.publicationProfiles.find((p) => p.id === profileId) : undefined;
    if (profileId && !byId) throw new HttpError(404, "profile-not-found", "Perfil de publicación no encontrado");
    return byId ?? project.publicationProfiles.find((p) => p.standard === standard) ?? { ...project.publicationProfiles[0]!, standard };
  }

  async build(project: CourseProject, profile: PublicationProfile, versionId?: string): Promise<BuildResult> {
    const { runtime, fonts } = await this.resources();
    return buildPackage(project, {
      standard: profile.standard,
      profile,
      runtime,
      fonts,
      reader: storageReader(this.deps.storage),
      ...(versionId ? { versionId } : {}),
    });
  }

  /** Compila el paquete y lo deja accesible (sin ZIP) para el preview. */
  async createPreview(projectId: string, standard: ScormStandard): Promise<PreviewBuild> {
    this.gcPreviews();
    const { project, revision } = await this.loadProject(projectId);
    const profile = this.profileFor(project, standard);
    const result = await this.build(project, profile);
    const { entries, course: _c, ...rest } = result;
    const preview: PreviewBuild = {
      id: randomUUID(),
      projectId,
      revision,
      standard,
      createdAt: Date.now(),
      entries: new Map(entries.map((e) => [e.path, e])),
      result: rest,
    };
    this.previews.set(preview.id, preview);
    return preview;
  }

  getPreview(id: string): PreviewBuild | null {
    const p = this.previews.get(id);
    if (!p) return null;
    if (Date.now() - p.createdAt > this.deps.previewTtlMs) {
      this.previews.delete(id);
      return null;
    }
    return p;
  }

  private gcPreviews(): void {
    const now = Date.now();
    for (const [id, p] of this.previews) if (now - p.createdAt > this.deps.previewTtlMs) this.previews.delete(id);
    // Máximo 30 previews en memoria (solo guardan bytes de texto; los assets se leen del almacenamiento).
    const extra = this.previews.size - 30;
    if (extra > 0) [...this.previews.keys()].slice(0, extra).forEach((k) => this.previews.delete(k));
  }

  /** Crea versión inmutable + publicación + trabajo asíncrono. */
  async requestPublication(projectId: string, profileId: string) {
    const { project } = await this.loadProject(projectId);
    const profile = this.profileFor(project, "scorm12", profileId);
    const version = await this.deps.projects.createVersion(projectId, "publication", `Publicación ${profile.name}`);
    const pub = await this.deps.publications.create({ id: randomUUID(), projectId, versionId: version.id, profile });
    await this.deps.jobs.enqueue("publish", { publicationId: pub.id });
    return pub;
  }

  /** Ejecuta el pipeline completo y sube el ZIP verificado. Lo llama el worker. */
  async runPublication(publicationId: string): Promise<void> {
    const { publications, projects, assets, storage, log } = this.deps;
    const pub = await publications.get(publicationId);
    if (!pub) throw new Error(`Publicación ${publicationId} no existe`);
    await publications.markBuilding(pub.id);
    const doc = pub.versionId ? await projects.getVersionDocument(pub.projectId, pub.versionId) : null;
    if (!doc) {
      await publications.fail(pub.id, { error: "La versión del proyecto no existe" });
      return;
    }
    const project = { ...doc, assets: await assets.list(pub.projectId) };
    const result = await this.build(project, pub.profile, pub.versionId ?? undefined);
    if (!result.ok) {
      await publications.fail(pub.id, { error: "La validación encontró errores; no se generó el ZIP", report: result.report, steps: result.steps });
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), "studio-pub-"));
    const zipPath = join(dir, "package.zip");
    try {
      const t0 = performance.now();
      const out = createWriteStream(zipPath);
      await writeZip(result.entries, storageReader(storage), (chunk) =>
        new Promise<void>((resolve, reject) => {
          out.write(chunk, (err) => (err ? reject(err) : resolve()));
        }),
      );
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      result.steps.push({ name: "generar-zip", ok: true, ms: Math.round(performance.now() - t0) });

      // Verificación del ZIP generado: directorio central vs. lista de archivos.
      const t1 = performance.now();
      const { size } = await stat(zipPath);
      const fh = await open(zipPath, "r");
      let names: string[];
      try {
        const dirEntries = await readZipDirectory(async (offset, length) => {
          const buf = Buffer.alloc(length);
          await fh.read(buf, 0, length, offset);
          return new Uint8Array(buf);
        }, size);
        names = dirEntries.map((e) => e.name);
      } finally {
        await fh.close();
      }
      const expected = new Set(result.entries.map((e) => e.path));
      const missing = [...expected].filter((p) => !names.includes(p));
      if (names[0] !== "imsmanifest.xml" || missing.length || names.length !== expected.size) {
        throw new Error(`El ZIP generado no coincide con el paquete validado (faltan: ${missing.join(", ") || "ninguno"})`);
      }
      result.steps.push({ name: "verificar-zip", ok: true, ms: Math.round(performance.now() - t1) });

      const key = `projects/${pub.projectId}/publications/${pub.id}/${safeFilename(project.title)}-${pub.standard}.zip`;
      await storage.putFile(key, zipPath, { contentType: "application/zip" });
      await publications.complete(pub.id, { report: result.report, steps: result.steps, storageKey: key, size, snapshotHash: result.snapshotHash });
      log.info({ publicationId: pub.id, size, standard: pub.standard }, "publicación completada");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
