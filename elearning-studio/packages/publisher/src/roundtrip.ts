/**
 * Lectura de un paquete NATIVO (generado por esta plataforma) para
 * recuperar el proyecto editable y sus assets. Base del round-trip; la
 * importación general de SCORM externos es Fase 6.
 */
import { loadProject, type Asset, type CourseProject } from "@studio/schema";
import { createHash } from "node:crypto";
import type { ProjectManifest } from "./types.js";

export type NativePackageContents = {
  project: CourseProject;
  manifest: ProjectManifest;
  assets: Array<{ asset: Asset; data: Uint8Array }>;
};

export function readNativePackage(files: Record<string, Uint8Array>): NativePackageContents {
  const raw = files["course-data/project-manifest.json"];
  if (!raw) throw new Error("El paquete no contiene course-data/project-manifest.json: no es un paquete nativo");
  const manifest = JSON.parse(new TextDecoder().decode(raw)) as ProjectManifest;
  if (manifest.format !== "studio-native-package" || manifest.formatVersion !== 1) {
    throw new Error("Formato de project-manifest no soportado");
  }
  const { project } = loadProject(manifest.project);
  const assets: NativePackageContents["assets"] = [];
  for (const meta of manifest.assets) {
    const data = files[meta.packagePath];
    if (!data) throw new Error(`Falta el asset ${meta.packagePath} en el paquete`);
    const hash = createHash("sha256").update(data).digest("hex");
    if (hash !== meta.hash) throw new Error(`El asset ${meta.packagePath} está corrupto (hash distinto)`);
    const asset = project.assets.find((a) => a.id === meta.id);
    if (!asset) throw new Error(`El proyecto no declara el asset ${meta.id}`);
    assets.push({ asset, data });
  }
  return { project, manifest, assets };
}
