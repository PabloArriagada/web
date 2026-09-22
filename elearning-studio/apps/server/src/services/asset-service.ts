import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import {
  collectAssetRefs,
  createId,
  mimeFromFilename,
  mimeInfo,
  safeFilename,
  type Asset,
  type CourseProject,
} from "@studio/schema";
import type { AssetRepo } from "../repos/assets.js";
import type { ObjectStorage } from "../storage/types.js";
import { HttpError } from "./errors.js";
import { imageSize, sniffMatches, unsafeSvgReason } from "./sniff.js";

const HEAD_BYTES = 64 * 1024;
const MAX_SVG_BYTES = 5 * 1024 * 1024;

export type AssetUsage = { slideId: string; slideTitle: string; elementId: string | null; elementName: string };

/** Dónde se usa un asset dentro del proyecto (pantallas y elementos). */
export function findAssetUsage(project: CourseProject, assetId: string): AssetUsage[] {
  const out: AssetUsage[] = [];
  for (const m of project.modules) {
    for (const s of m.slides) {
      if (collectAssetRefs(s.background).has(assetId)) out.push({ slideId: s.id, slideTitle: s.title, elementId: null, elementName: "Fondo" });
      for (const el of s.elements) {
        if (collectAssetRefs(el).has(assetId)) out.push({ slideId: s.id, slideTitle: s.title, elementId: el.id, elementName: el.name });
      }
    }
  }
  if (collectAssetRefs(project.theme).has(assetId)) out.push({ slideId: "", slideTitle: "Tema", elementId: null, elementName: "Tema" });
  return out;
}

export class AssetService {
  constructor(
    private readonly repo: AssetRepo,
    private readonly storage: ObjectStorage,
    private readonly maxBytes: number,
  ) {}

  /**
   * Sube un archivo en streaming al almacenamiento, calculando SHA-256 y
   * tamaño sin cargarlo completo en memoria (salvo SVG, que se inspecciona).
   * Si el contenido ya existe en el proyecto devuelve el asset existente.
   */
  async upload(projectId: string, filename: string, body: Readable, isTruncated: () => boolean): Promise<{ asset: Asset; duplicate: boolean }> {
    const mime = mimeFromFilename(filename);
    const info = mime ? mimeInfo(mime) : null;
    if (!mime || !info) {
      throw new HttpError(415, "unsupported-type", `Tipo de archivo no soportado: ${filename}. Formatos admitidos: PNG, JPG, GIF, WebP, AVIF, SVG, MP4, WebM, MP3, M4A, OGG, WAV, WOFF/WOFF2/TTF/OTF, PDF, VTT, TXT.`);
    }
    const id = createId("ast");
    const storageKey = `projects/${projectId}/assets/${id}/${safeFilename(filename)}`;

    const hash = createHash("sha256");
    let size = 0;
    const headChunks: Buffer[] = [];
    let headLen = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        hash.update(chunk);
        if (headLen < HEAD_BYTES) {
          headChunks.push(chunk.subarray(0, HEAD_BYTES - headLen));
          headLen += Math.min(chunk.length, HEAD_BYTES - headLen);
        }
        cb(null, chunk);
      },
    });

    let source: Readable = body;
    if (mime === "image/svg+xml") {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const c of body) {
        total += (c as Buffer).length;
        if (total > MAX_SVG_BYTES) throw new HttpError(413, "too-large", "El SVG supera 5 MB");
        chunks.push(c as Buffer);
      }
      const buf = Buffer.concat(chunks);
      const reason = unsafeSvgReason(buf.toString("utf8"));
      if (reason) throw new HttpError(422, "unsafe-svg", `El SVG fue rechazado por seguridad: ${reason}`);
      source = Readable.from([buf]);
    }

    source.once("error", (e) => meter.destroy(e));
    await this.storage.put(storageKey, source.pipe(meter), { contentType: mime });
    const cleanup = () => this.storage.delete(storageKey).catch(() => undefined);

    if (isTruncated() || size > this.maxBytes) {
      await cleanup();
      throw new HttpError(413, "too-large", `El archivo supera el máximo permitido (${Math.round(this.maxBytes / 1048576)} MB)`);
    }
    if (size === 0) {
      await cleanup();
      throw new HttpError(422, "empty-file", "El archivo está vacío");
    }
    const head = Buffer.concat(headChunks);
    if (!sniffMatches(mime, head)) {
      await cleanup();
      throw new HttpError(415, "content-mismatch", `El contenido de "${filename}" no corresponde a un archivo ${info.ext.toUpperCase()} válido`);
    }
    const digest = hash.digest("hex");
    const existing = await this.repo.findByHash(projectId, digest);
    if (existing) {
      await cleanup();
      return { asset: existing, duplicate: true };
    }
    const metadata: Record<string, unknown> = {};
    const dims = info.type === "image" || info.type === "svg" ? imageSize(mime, head) : null;
    if (dims) Object.assign(metadata, dims);
    const asset: Asset = {
      id,
      projectId,
      type: info.type,
      filename: filename.slice(0, 255),
      mimeType: mime,
      size,
      hash: digest,
      storageKey,
      metadata,
    };
    const inserted = await this.repo.insert(asset);
    if (!inserted) {
      await cleanup();
      const dup = await this.repo.findByHash(projectId, digest);
      if (!dup) throw new HttpError(500, "asset-race", "No se pudo registrar el asset");
      return { asset: dup, duplicate: true };
    }
    return { asset: inserted, duplicate: false };
  }

  /** Elimina solo si no está en uso. */
  async remove(project: CourseProject, assetId: string): Promise<void> {
    const asset = await this.repo.get(project.id, assetId);
    if (!asset) throw new HttpError(404, "not-found", "Asset no encontrado");
    const usage = findAssetUsage(project, assetId);
    if (usage.length) {
      throw new HttpError(409, "asset-in-use", `El recurso está en uso en ${usage.length} lugar(es)`, usage);
    }
    await this.repo.delete(project.id, assetId);
    await this.storage.delete(asset.storageKey);
  }
}
