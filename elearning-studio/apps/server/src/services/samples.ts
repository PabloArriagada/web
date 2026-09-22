import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { createQaProject, type Asset, type QaAssets } from "@studio/schema";
import type { ProjectRepo, ProjectRow } from "../repos/projects.js";
import type { AssetService } from "./asset-service.js";
import { generatePng, generateSvg, generateVtt, generateWav } from "./sample-media.js";

/** Crea el curso QA con assets reales subidos por el mismo Asset Manager. */
export class SampleService {
  constructor(
    private readonly deps: { projects: ProjectRepo; assetService: AssetService; videoFixture: URL | null },
  ) {}

  async createQaProject(title: string): Promise<ProjectRow> {
    // 1) Crear el proyecto (vacío de assets) para obtener su id.
    const draft = createQaProject({}, title);
    const row = await this.deps.projects.create(draft);
    const up = async (filename: string, data: Buffer): Promise<Asset> =>
      (await this.deps.assetService.upload(row.id, filename, Readable.from([data]), () => false)).asset;

    const assets: QaAssets = {
      image: await up("imagen-prueba.png", generatePng()),
      svg: await up("ilustracion.svg", generateSvg()),
      audio: await up("narracion.wav", generateWav()),
    };
    if (this.deps.videoFixture) {
      try {
        assets.video = await up("video-prueba.webm", await readFile(this.deps.videoFixture));
        // Los subtítulos solo tienen sentido (y solo se publican) con video.
        assets.caption = await up("subtitulos-es.vtt", generateVtt());
      } catch {
        /* sin fixture de video: el curso QA usa solo audio */
      }
    }
    // 2) Regenerar el contenido referenciando los assets y conservar el id.
    const full = createQaProject(assets, title);
    const project = { ...full, id: row.id, assets: [] };
    const r = await this.deps.projects.update(row.id, project, row.revision);
    if (!r.ok) throw new Error("No se pudo completar el curso QA");
    return r.row;
  }
}
