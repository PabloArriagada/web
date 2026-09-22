import { collectAssetRefs, findForbiddenUrls, mimeInfo } from "./assets.js";
import { CourseProjectSchema, type CourseProject } from "./model.js";

export type Severity = "error" | "warning" | "info";

export type ValidationIssue = {
  severity: Severity;
  code: string;
  message: string;
  /** Ruta legible (p. ej. "Módulo 1 › Portada › Título"). */
  location?: string;
  slideId?: string;
  elementId?: string;
};

export type ValidationReport = {
  ok: boolean;
  issues: ValidationIssue[];
  counts: Record<Severity, number>;
};

export function makeReport(issues: ValidationIssue[]): ValidationReport {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return { ok: counts.error === 0, issues, counts };
}

/**
 * Validación semántica del proyecto (además del esquema zod).
 * Se ejecuta en el editor, antes de publicar y en el servidor.
 */
export function validateProject(input: unknown): ValidationReport {
  const issues: ValidationIssue[] = [];
  const parsed = CourseProjectSchema.safeParse(input);
  if (!parsed.success) {
    for (const e of parsed.error.issues.slice(0, 50)) {
      issues.push({
        severity: "error",
        code: "schema",
        message: `${e.message} (${e.path.join(".")})`,
        location: e.path.join("."),
      });
    }
    return makeReport(issues);
  }
  const project: CourseProject = parsed.data;

  // Identificadores únicos en todo el proyecto.
  const seen = new Map<string, string>();
  const claim = (id: string, what: string) => {
    const prev = seen.get(id);
    if (prev) {
      issues.push({ severity: "error", code: "duplicate-id", message: `Identificador duplicado ${id} (${prev} y ${what})` });
    } else seen.set(id, what);
  };
  claim(project.id, "proyecto");

  const slideIds = new Set<string>();
  let slideCount = 0;
  for (const mod of project.modules) {
    claim(mod.id, `módulo "${mod.title}"`);
    if (mod.slides.length === 0) {
      issues.push({ severity: "warning", code: "empty-module", message: `El módulo "${mod.title}" no tiene pantallas`, location: mod.title });
    }
    for (const s of mod.slides) {
      slideIds.add(s.id);
      slideCount++;
    }
  }
  if (slideCount === 0) {
    issues.push({ severity: "error", code: "no-slides", message: "El curso no tiene pantallas" });
  }

  const assetsById = new Map(project.assets.map((a) => [a.id, a]));
  for (const a of project.assets) {
    claim(a.id, `asset "${a.filename}"`);
    if (!mimeInfo(a.mimeType)) {
      issues.push({ severity: "error", code: "asset-mime", message: `El asset "${a.filename}" tiene un tipo no publicable (${a.mimeType})` });
    }
  }

  for (const mod of project.modules) {
    for (const slide of mod.slides) {
      const where = `${mod.title} › ${slide.title}`;
      claim(slide.id, `pantalla "${slide.title}"`);
      const layerIds = new Set(slide.layers.map((l) => l.id));
      for (const l of slide.layers) claim(l.id, `capa "${l.name}"`);
      if (slide.width !== project.stage.width || slide.height !== project.stage.height) {
        issues.push({
          severity: "warning",
          code: "slide-size",
          message: `La pantalla mide ${slide.width}×${slide.height} y el escenario ${project.stage.width}×${project.stage.height}`,
          location: where,
          slideId: slide.id,
        });
      }
      for (const el of slide.elements) {
        const elWhere = `${where} › ${el.name}`;
        claim(el.id, `elemento "${el.name}"`);
        const ctx = { location: elWhere, slideId: slide.id, elementId: el.id };
        if (!layerIds.has(el.layerId)) {
          issues.push({ severity: "error", code: "missing-layer", message: `"${el.name}" apunta a una capa inexistente`, ...ctx });
        }
        if (el.x + el.width <= 0 || el.y + el.height <= 0 || el.x >= slide.width || el.y >= slide.height) {
          issues.push({ severity: "warning", code: "off-stage", message: `"${el.name}" está completamente fuera del escenario`, ...ctx });
        }
        if (el.type === "button" && el.action.type === "goto-slide" && !slideIds.has(el.action.slideId)) {
          issues.push({ severity: "error", code: "broken-link", message: `El botón "${el.name}" navega a una pantalla inexistente`, ...ctx });
        }
        if (el.type === "image" && !el.accessibility.decorative && !el.accessibility.altText?.trim()) {
          issues.push({ severity: "warning", code: "a11y-alt", message: `La imagen "${el.name}" no tiene texto alternativo`, ...ctx });
        }
        if (el.type === "video" && el.captions.length === 0) {
          issues.push({ severity: "warning", code: "a11y-captions", message: `El video "${el.name}" no tiene subtítulos`, ...ctx });
        }
        for (const id of collectAssetRefs(el)) {
          if (!assetsById.has(id)) {
            issues.push({ severity: "error", code: "missing-asset", message: `"${el.name}" usa un recurso inexistente (${id})`, ...ctx });
          }
        }
      }
      for (const id of collectAssetRefs(slide.background)) {
        if (!assetsById.has(id)) {
          issues.push({ severity: "error", code: "missing-asset", message: `El fondo usa un recurso inexistente (${id})`, location: where, slideId: slide.id });
        }
      }
    }
  }

  // URLs prohibidas en cualquier texto del proyecto (excepto la tabla de assets,
  // cuyo storageKey es interno y nunca se publica).
  const { assets: _assets, ...rest } = project;
  const serialized = JSON.stringify(rest);
  for (const reason of findForbiddenUrls(serialized)) {
    issues.push({ severity: "error", code: "forbidden-url", message: `El proyecto contiene una referencia no publicable: ${reason}` });
  }

  return makeReport(issues);
}
