import { describe, expect, it } from "vitest";
import {
  CourseProjectSchema,
  SCHEMA_VERSION,
  assetUri,
  collectAssetRefs,
  createId,
  createImageElement,
  createProject,
  createQaProject,
  findForbiddenUrls,
  loadProject,
  migrateDocument,
  packagePathForAsset,
  rewriteAssetRefs,
  safeFilename,
  SchemaVersionError,
  validateProject,
  type Asset,
  type SchemaMigration,
} from "../src/index.js";

const fakeAsset = (projectId: string, mimeType = "image/png", filename = "foto.png"): Asset => ({
  id: createId("ast"),
  projectId,
  type: "image",
  filename,
  mimeType,
  size: 10,
  hash: "a".repeat(64),
  storageKey: `projects/${projectId}/assets/x/${filename}`,
  metadata: {},
});

describe("ids", () => {
  it("genera ids estables con prefijo y sin colisiones", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => createId("el")));
    expect(ids.size).toBe(5000);
    for (const id of ids) expect(id).toMatch(/^el_[a-z0-9]{20}$/);
  });
});

describe("modelo", () => {
  it("un proyecto nuevo cumple el esquema y la validación semántica", () => {
    const p = createProject({ title: "Curso" });
    expect(CourseProjectSchema.parse(p)).toBeTruthy();
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    const report = validateProject(p);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("el curso QA es válido y referencia todos sus assets", () => {
    const pid = createId("prj");
    const assets = { image: fakeAsset(pid), svg: { ...fakeAsset(pid, "image/svg+xml", "a.svg"), hash: "b".repeat(64) } };
    const p = createQaProject(assets);
    const report = validateProject(p);
    expect(report.ok).toBe(true);
    const refs = collectAssetRefs(p.modules);
    expect(refs.has(assets.image.id)).toBe(true);
    expect(refs.has(assets.svg.id)).toBe(true);
  });

  it("rechaza colores, ids y referencias de asset inválidas", () => {
    const p = createProject({ title: "X" });
    const bad = structuredClone(p) as any;
    bad.theme.colors.primary = "azul";
    expect(CourseProjectSchema.safeParse(bad).success).toBe(false);
    const bad2 = structuredClone(p) as any;
    bad2.modules[0].slides[0].elements.push({ ...createImageElement(p.modules[0]!.slides[0]!.layers[0]!.id, "https://ejemplo.com/a.png") });
    expect(CourseProjectSchema.safeParse(bad2).success).toBe(false);
  });
});

describe("validación semántica", () => {
  it("detecta asset inexistente, capa inexistente, id duplicado y enlace roto", () => {
    const p = createProject({ title: "X" });
    const slide = p.modules[0]!.slides[0]!;
    const img = createImageElement(slide.layers[0]!.id, assetUri(createId("ast")));
    slide.elements.push(img);
    slide.elements.push({ ...slide.elements[0]!, layerId: createId("lyr") });
    const report = validateProject(p);
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain("missing-asset");
    expect(codes).toContain("missing-layer");
    expect(codes).toContain("duplicate-id");
    expect(codes).toContain("a11y-alt");
    expect(report.ok).toBe(false);
  });

  it("detecta URLs no publicables en textos", () => {
    const p = createProject({ title: "X" });
    const t = p.modules[0]!.slides[0]!.elements[0]!;
    if (t.type === "text") t.text = "ver blob:http://localhost:5173/abc";
    const codes = validateProject(p).issues.map((i) => i.code);
    expect(codes).toContain("forbidden-url");
  });

  it("un curso sin pantallas es un error", () => {
    const p = createProject({ title: "X" });
    p.modules[0]!.slides = [];
    expect(validateProject(p).issues.map((i) => i.code)).toContain("no-slides");
  });
});

describe("assets", () => {
  it("reescribe asset:// en profundidad sin mutar el original", () => {
    const id = createId("ast");
    const src = { a: assetUri(id), b: [`url(${assetUri(id)})`], c: 3 };
    const out = rewriteAssetRefs(src, (x) => `assets/images/${x}.png`);
    expect(out.a).toBe(`assets/images/${id}.png`);
    expect(out.b[0]).toBe(`url(assets/images/${id}.png)`);
    expect(src.a).toBe(assetUri(id));
  });

  it("rutas de paquete por tipo MIME", () => {
    const a = fakeAsset(createId("prj"), "video/mp4", "Mi Video.MP4");
    expect(packagePathForAsset(a)).toBe(`assets/video/${a.id}.mp4`);
    expect(() => packagePathForAsset({ id: "x", mimeType: "application/x-msdownload" })).toThrow();
  });

  it("nombres de archivo seguros", () => {
    expect(safeFilename("Presentación Final (v2).PNG")).toBe("presentacion-final-v2.png");
    expect(safeFilename("../../etc/passwd")).toBe("etc-passwd");
  });

  it("detecta URLs prohibidas", () => {
    expect(findForbiddenUrls("blob:https://x/1")).toHaveLength(1);
    expect(findForbiddenUrls("data:image/png;base64,AAAA")).toHaveLength(1);
    expect(findForbiddenUrls("http://127.0.0.1:3000/a")).toHaveLength(1);
    expect(findForbiddenUrls("https://s3/x?X-Amz-Signature=abc")).toHaveLength(1);
    expect(findForbiddenUrls("assets/images/a.png")).toHaveLength(0);
  });
});

describe("migraciones de esquema", () => {
  it("carga un proyecto actual sin migraciones", () => {
    const p = createProject({ title: "X" });
    const { project, applied } = loadProject(JSON.parse(JSON.stringify(p)));
    expect(applied).toEqual([]);
    expect(project.id).toBe(p.id);
  });

  it("encadena migraciones en orden", () => {
    const migrations: SchemaMigration[] = [
      { from: "0.8.0", to: "0.9.0", description: "a", migrate: (d) => ({ ...d, a: 1 }) },
      { from: "0.9.0", to: "1.0.0", description: "b", migrate: (d) => ({ ...d, b: (d["a"] as number) + 1 }) },
    ];
    const { doc, applied } = migrateDocument({ schemaVersion: "0.8.0" }, migrations, "1.0.0");
    expect(applied).toEqual(["0.8.0→0.9.0", "0.9.0→1.0.0"]);
    expect(doc).toMatchObject({ schemaVersion: "1.0.0", a: 1, b: 2 });
  });

  it("rechaza versiones futuras, faltantes o sin camino de migración", () => {
    expect(() => migrateDocument({ schemaVersion: "9.0.0" })).toThrow(SchemaVersionError);
    expect(() => migrateDocument({ title: "x" })).toThrow(SchemaVersionError);
    expect(() => migrateDocument({ schemaVersion: "0.1.0" })).toThrow(/No existe migración/);
    expect(() => migrateDocument(null)).toThrow(SchemaVersionError);
  });
});
