/**
 * Pipeline de publicación:
 *
 * PROYECTO → SNAPSHOT INMUTABLE → VALIDAR → RECOPILAR ASSETS → COPIAR ASSETS
 * → REESCRIBIR RUTAS → CONSTRUIR RUNTIME → CONSTRUIR WRAPPER SCORM
 * → GENERAR MANIFEST → VALIDAR PUBLICACIÓN → (ZIP en zip.ts)
 *
 * El preview de publicación y el ZIP usan EXACTAMENTE esta salida.
 */
import { createHash } from "node:crypto";
import {
  collectAssetRefs,
  makeReport,
  packagePathForAsset,
  rewriteAssetRefs,
  validateProject,
  type Asset,
  type CourseProject,
  type RuntimeCourse,
  type ValidationIssue,
} from "@studio/schema";
import { buildFontsCss, buildIndexHtml, COURSE_CSS } from "./html.js";
import { buildManifest } from "./manifest.js";
import type { BuildOptions, BuildResult, PackageEntry, PipelineStep, ProjectManifest } from "./types.js";
import { validatePackage } from "./validate-package.js";

const enc = new TextEncoder();
const text = (s: string) => enc.encode(s);

export const LAUNCH_FILE = "index.html";

/** JSON canónico (claves ordenadas) para hashes estables. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** Fuentes usadas por el proyecto (tema + estilos de texto). */
function usedFontFamilies(project: CourseProject): Set<string> {
  const fams = new Set<string>([project.theme.fonts.body, project.theme.fonts.heading]);
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, item] of Object.entries(v)) {
        if (k === "fontFamily" && typeof item === "string") fams.add(item);
        else walk(item);
      }
    }
  };
  walk(project.modules);
  return fams;
}

const WEB_SAFE_FONTS = new Set(["arial", "helvetica", "verdana", "tahoma", "trebuchet ms", "georgia", "times new roman", "courier new", "system-ui", "sans-serif", "serif", "monospace"]);

export async function buildPackage(input: CourseProject, opts: BuildOptions): Promise<BuildResult> {
  const steps: PipelineStep[] = [];
  const issues: ValidationIssue[] = [];
  const step = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const t0 = performance.now();
    try {
      const r = await fn();
      steps.push({ name, ok: true, ms: Math.round(performance.now() - t0) });
      return r;
    } catch (err) {
      steps.push({ name, ok: false, ms: Math.round(performance.now() - t0), detail: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };
  const now = opts.now ?? new Date();
  const generator = opts.generator ?? { name: "Studio E-learning", version: "0.1.0" };

  // 1. Snapshot inmutable: la publicación no ve cambios posteriores del editor.
  const { project, snapshotHash } = await step("snapshot", () => {
    const project = deepFreeze(structuredClone(input));
    const snapshotHash = createHash("sha256").update(canonicalJson(project)).digest("hex");
    return { project, snapshotHash };
  });

  // 2. Validar proyecto.
  const projectReport = await step("validar-proyecto", () => validateProject(project));
  issues.push(...projectReport.issues);

  const emptyCourse = (): RuntimeCourse => ({
    schemaVersion: project.schemaVersion,
    id: project.id,
    title: project.title,
    locale: project.locale,
    stage: project.stage,
    theme: project.theme,
    player: project.player,
    modules: [],
    tracking: { standard: opts.standard, completion: opts.profile.completion, passing: opts.profile.passing, lms: opts.profile.lms },
  });
  if (!projectReport.ok) {
    return { ok: false, entries: [], report: makeReport(issues), steps, snapshotHash, course: emptyCourse(), launch: LAUNCH_FILE, totalBytes: 0 };
  }

  // 3. Recopilar assets referenciados (los no usados no se publican).
  const used = await step("recopilar-assets", () => {
    const refs = collectAssetRefs({ modules: project.modules, theme: project.theme });
    const byId = new Map(project.assets.map((a) => [a.id, a]));
    const list: Asset[] = [];
    for (const id of refs) {
      const a = byId.get(id);
      if (a) list.push(a);
    }
    return list.sort((a, b) => a.id.localeCompare(b.id));
  });

  // 4. Copiar assets: verificar que existen en el almacenamiento con el tamaño esperado.
  const assetEntries = await step("copiar-assets", async () => {
    const out: PackageEntry[] = [];
    for (const a of used) {
      const size = await opts.reader.stat(a.storageKey);
      if (size === null) {
        issues.push({ severity: "error", code: "asset-missing-storage", message: `El archivo de "${a.filename}" no existe en el almacenamiento` });
        continue;
      }
      if (size !== a.size) {
        issues.push({ severity: "error", code: "asset-size-mismatch", message: `"${a.filename}" mide ${size} bytes en almacenamiento y ${a.size} en el proyecto` });
        continue;
      }
      const isText = a.mimeType.startsWith("text/") || a.mimeType === "image/svg+xml";
      out.push({ path: packagePathForAsset(a), mime: a.mimeType, source: { kind: "asset", storageKey: a.storageKey, size, hash: a.hash }, compress: isText });
    }
    return out;
  });
  const pathById = new Map(used.map((a) => [a.id, packagePathForAsset(a)]));

  // 5. Reescribir rutas asset:// → rutas relativas del paquete.
  const course: RuntimeCourse = await step("reescribir-rutas", () =>
    rewriteAssetRefs(
      {
        schemaVersion: project.schemaVersion,
        id: project.id,
        title: project.title,
        locale: project.locale,
        stage: project.stage,
        theme: project.theme,
        player: project.player,
        modules: project.modules,
        tracking: { standard: opts.standard, completion: opts.profile.completion, passing: opts.profile.passing, lms: opts.profile.lms },
      },
      (id) => pathById.get(id) ?? `asset-no-encontrado/${id}`,
    ),
  );

  // 6. Runtime + fuentes.
  const runtimeEntries = await step("construir-runtime", () => {
    const families = usedFontFamilies(project);
    const fonts = opts.fonts.filter((f) => families.has(f.family));
    for (const fam of families) {
      if (!opts.fonts.some((f) => f.family === fam) && !WEB_SAFE_FONTS.has(fam.toLowerCase())) {
        issues.push({ severity: "warning", code: "font-not-packaged", message: `La fuente "${fam}" no se incluye en el paquete; se usará una alternativa del sistema` });
      }
    }
    const entries: PackageEntry[] = [
      { path: "runtime/runtime.js", mime: "text/javascript", source: { kind: "inline", data: opts.runtime.js }, compress: true },
      { path: "styles/runtime.css", mime: "text/css", source: { kind: "inline", data: opts.runtime.css }, compress: true },
      { path: "styles/course.css", mime: "text/css", source: { kind: "inline", data: text(COURSE_CSS) }, compress: true },
    ];
    if (fonts.length) {
      entries.push({ path: "styles/fonts.css", mime: "text/css", source: { kind: "inline", data: text(buildFontsCss(fonts)) }, compress: true });
      for (const f of fonts) entries.push({ path: `assets/fonts/${f.filename}`, mime: "font/woff2", source: { kind: "inline", data: f.data }, compress: false });
    }
    return { entries, hasFonts: fonts.length > 0 };
  });

  // 7. Wrapper SCORM (launch) + datos del curso + project manifest.
  const wrapperEntries = await step("construir-wrapper", () => {
    const courseJson = JSON.stringify(course);
    const projectManifest: ProjectManifest = {
      format: "studio-native-package",
      formatVersion: 1,
      generator,
      runtimeVersion: opts.runtime.version,
      schemaVersion: project.schemaVersion,
      projectId: project.id,
      ...(opts.versionId ? { versionId: opts.versionId } : {}),
      title: project.title,
      standard: opts.standard,
      profile: opts.profile,
      snapshotHash,
      builtAt: now.toISOString(),
      assets: used.map(({ storageKey: _k, ...a }) => ({ ...a, packagePath: pathById.get(a.id)! })),
      project: {
        ...project,
        // Las claves de almacenamiento son internas del servidor: no se publican.
        assets: project.assets.filter((a) => pathById.has(a.id)).map((a) => ({ ...a, storageKey: `package:${pathById.get(a.id)}` })),
      },
    };
    const entries: PackageEntry[] = [
      {
        path: LAUNCH_FILE,
        mime: "text/html",
        source: { kind: "inline", data: text(buildIndexHtml({ title: project.title, locale: project.locale, standard: opts.standard, hasFonts: runtimeEntries.hasFonts })) },
        compress: true,
      },
      { path: "course-data/course.json", mime: "application/json", source: { kind: "inline", data: text(courseJson) }, compress: true },
      { path: "course-data/course.js", mime: "text/javascript", source: { kind: "inline", data: text(`window.__STUDIO_COURSE__ = ${courseJson};\n`) }, compress: true },
      { path: "course-data/project-manifest.json", mime: "application/json", source: { kind: "inline", data: text(JSON.stringify(projectManifest, null, 2)) }, compress: true },
    ];
    return entries;
  });

  // 8. Manifest.
  const contentEntries = [...wrapperEntries, ...runtimeEntries.entries, ...assetEntries];
  const manifestEntry = await step("generar-manifest", (): PackageEntry => {
    const xml = buildManifest({
      standard: opts.standard,
      profile: opts.profile,
      projectId: project.id,
      title: project.title,
      ...(project.description ? { description: project.description } : {}),
      launch: LAUNCH_FILE,
      files: contentEntries.map((e) => e.path).sort(),
      hasScoring: project.assessments.length > 0,
    });
    return { path: "imsmanifest.xml", mime: "application/xml", source: { kind: "inline", data: text(xml) }, compress: true };
  });
  const entries = [manifestEntry, ...contentEntries];

  // 9. Validar publicación (estructura final del paquete).
  await step("validar-publicacion", () => {
    issues.push(...validatePackage(entries, { launch: LAUNCH_FILE, runtimeSha256: opts.runtime.jsSha256, standard: opts.standard }));
  });

  const report = makeReport(issues);
  const totalBytes = entries.reduce((n, e) => n + (e.source.kind === "inline" ? e.source.data.length : e.source.size), 0);
  return { ok: report.ok, entries, report, steps, snapshotHash, course, launch: LAUNCH_FILE, totalBytes };
}
