import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { assetUri, createId, type ScormStandard } from "@studio/schema";
import { buildPackage, readNativePackage, readZipDirectory, validatePackage, writeZip, type BuildResult, type PackageEntry } from "../src/index.js";
import { qaFixture, resources, MemoryReader, pathOf } from "./helpers.js";

async function build(standard: ScormStandard, mutate?: (f: ReturnType<typeof qaFixture>) => void) {
  const f = qaFixture();
  mutate?.(f);
  const profile = f.project.publicationProfiles.find((p) => p.standard === standard)!;
  const result = await buildPackage(f.project, { standard, profile, reader: f.reader, ...(await resources()), now: new Date("2026-01-01T00:00:00Z") });
  return { ...f, result };
}

async function zipToFiles(result: BuildResult, reader: MemoryReader) {
  const chunks: Uint8Array[] = [];
  await writeZip(result.entries, reader, (c) => void chunks.push(c));
  const zip = Buffer.concat(chunks);
  return { zip, files: unzipSync(new Uint8Array(zip)) };
}

const parseXml = (s: string) => new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" }).parse(s);

describe.each(["scorm12", "scorm2004"] as const)("paquete %s", (standard) => {
  it("pasa el pipeline completo sin errores", async () => {
    const { result } = await build(standard);
    expect(result.report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.name)).toEqual([
      "snapshot",
      "validar-proyecto",
      "recopilar-assets",
      "copiar-assets",
      "reescribir-rutas",
      "construir-runtime",
      "construir-wrapper",
      "generar-manifest",
      "validar-publicacion",
    ]);
  });

  it("genera la estructura esperada con imsmanifest.xml en la raíz", async () => {
    const { result, reader, project } = await build(standard);
    const { files, zip } = await zipToFiles(result, reader);
    const names = Object.keys(files).sort();
    expect(names).toContain("imsmanifest.xml");
    expect(names).toContain("index.html");
    expect(names).toContain("runtime/runtime.js");
    expect(names).toContain("styles/runtime.css");
    expect(names).toContain("styles/fonts.css");
    expect(names).toContain("course-data/course.json");
    expect(names).toContain("course-data/project-manifest.json");
    for (const a of project.assets) expect(names).toContain(pathOf(a));
    expect(names.some((n) => n.startsWith("assets/fonts/montserrat-latin-400-normal"))).toBe(true);
    // Los bytes de cada asset llegan intactos.
    for (const a of project.assets) expect(Buffer.from(files[pathOf(a)]!).equals(Buffer.from(reader.files.get(a.storageKey)!))).toBe(true);
    // El directorio central coincide y el manifest es la primera entrada.
    const dir = await readZipDirectory(async (o, l) => new Uint8Array(zip.subarray(o, o + l)), zip.length);
    expect(dir[0]!.name).toBe("imsmanifest.xml");
    expect(dir.map((d) => d.name).sort()).toEqual(names);
    // Media sin recomprimir (método 0 = stored).
    expect(dir.find((d) => d.name.endsWith(".webm"))!.method).toBe(0);
  });

  it("manifest correcto para el estándar y lista todos los archivos", async () => {
    const { result, reader } = await build(standard);
    const { files } = await zipToFiles(result, reader);
    const m = parseXml(strFromU8(files["imsmanifest.xml"]!)).manifest;
    expect(m.metadata.schemaversion).toBe(standard === "scorm12" ? 1.2 : "2004 4th Edition");
    const res = m.resources.resource;
    expect(res["@href"]).toBe("index.html");
    expect(res[standard === "scorm12" ? "@adlcp:scormtype" : "@adlcp:scormType"]).toBe("sco");
    const listed = (Array.isArray(res.file) ? res.file : [res.file]).map((f: any) => f["@href"]).sort();
    expect(listed).toEqual(Object.keys(files).filter((n) => n !== "imsmanifest.xml").sort());
    expect(m["@xmlns"]).toBe(standard === "scorm12" ? "http://www.imsproject.org/xsd/imscp_rootv1p1p2" : "http://www.imsglobal.org/xsd/imscp_v1p1");
  });

  it("reescribe las rutas: sin asset://, sin URLs temporales", async () => {
    const { result, reader, project } = await build(standard);
    const { files } = await zipToFiles(result, reader);
    const course = strFromU8(files["course-data/course.json"]!);
    expect(course).not.toContain("asset://");
    expect(course).not.toMatch(/blob:|localhost|\/api\//);
    for (const a of project.assets) expect(course).toContain(pathOf(a));
    const js = strFromU8(files["course-data/course.js"]!);
    expect(js.startsWith("window.__STUDIO_COURSE__ = ")).toBe(true);
    expect(JSON.parse(course).tracking.standard).toBe(standard);
    // No se filtran claves internas del almacenamiento.
    for (const f of Object.values(files)) expect(strFromU8(f, true)).not.toContain("projects/prj_");
  });

  it("round-trip: el paquete nativo reconstruye el proyecto editable", async () => {
    const { result, reader, project } = await build(standard);
    const { files } = await zipToFiles(result, reader);
    const back = readNativePackage(files);
    expect(back.project.id).toBe(project.id);
    expect(back.project.modules).toEqual(project.modules);
    expect(back.assets.map((a) => a.asset.id).sort()).toEqual(project.assets.map((a) => a.id).sort());
    expect(back.manifest.snapshotHash).toBe(result.snapshotHash);
  });
});

describe("pipeline: garantías", () => {
  it("snapshot inmutable y hash determinista", async () => {
    const f = qaFixture();
    const opts = { standard: "scorm12" as const, profile: f.project.publicationProfiles[0]!, reader: f.reader, ...(await resources()) };
    const a = await buildPackage(f.project, opts);
    const b = await buildPackage(structuredClone(f.project), opts);
    expect(a.snapshotHash).toBe(b.snapshotHash);
    f.project.title = "Cambiado después";
    expect(a.course.title).not.toBe("Cambiado después");
  });

  it("no incluye assets que no se usan", async () => {
    const { result } = await build("scorm12", (f) => {
      f.project.assets.push({ ...f.project.assets[0]!, id: createId("ast"), hash: "c".repeat(64) });
    });
    expect(result.entries.filter((e) => e.path.startsWith("assets/") && !e.path.startsWith("assets/fonts/")).length).toBe(5);
  });

  it("bloquea la publicación si un asset falta en el almacenamiento", async () => {
    const { result } = await build("scorm12", (f) => f.reader.files.delete(f.project.assets[0]!.storageKey));
    expect(result.ok).toBe(false);
    expect(result.report.issues.map((i) => i.code)).toContain("asset-missing-storage");
  });

  it("bloquea la publicación si el proyecto es inválido y no genera archivos", async () => {
    const { result } = await build("scorm2004", (f) => {
      const s = f.project.modules[0]!.slides[0]!;
      s.elements.push({ ...(s.elements[0] as any), id: createId("el"), type: "image", src: assetUri(createId("ast")), fit: "contain" });
    });
    expect(result.ok).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.report.issues.map((i) => i.code)).toContain("missing-asset");
  });

  it("detecta tamaño distinto entre proyecto y almacenamiento", async () => {
    const { result } = await build("scorm12", (f) => {
      const a = f.project.assets[0]!;
      f.reader.files.set(a.storageKey, new Uint8Array(3));
    });
    expect(result.report.issues.map((i) => i.code)).toContain("asset-size-mismatch");
  });
});

describe("validador de paquete", () => {
  const enc = new TextEncoder();
  const inline = (path: string, mime: string, text: string): PackageEntry => ({ path, mime, source: { kind: "inline", data: enc.encode(text) }, compress: true });

  it("detecta colisiones de mayúsculas, rutas inseguras, MIME, referencias rotas y URLs temporales", async () => {
    const { result } = await build("scorm12");
    const entries = [
      ...result.entries,
      inline("assets/images/Foto.png", "image/png", "x"),
      inline("assets/images/foto.png", "image/png", "x"),
      inline("assets/../evil.js", "text/javascript", "x"),
      inline("assets/documents/a.exe", "application/octet-stream", "x"),
      inline("styles/extra.css", "text/css", "a{background:url(../assets/images/no-existe.png)} b{background:url(https://cdn.example.com/x.png)}"),
      inline("assets/documents/nota.txt", "text/plain", "ver https://bucket.s3.amazonaws.com/a?X-Amz-Signature=abc"),
    ];
    const codes = validatePackage(entries, { launch: "index.html", standard: "scorm12" }).map((i) => i.code);
    for (const c of ["pkg-case-collision", "pkg-unsafe-path", "pkg-mime", "css-ref-missing", "css-external", "forbidden-url", "manifest-file-unlisted"]) {
      expect(codes).toContain(c);
    }
  });

  it("detecta manifest ausente o mal formado y launch faltante", async () => {
    const { result } = await build("scorm2004");
    const noManifest = result.entries.filter((e) => e.path !== "imsmanifest.xml");
    expect(validatePackage(noManifest, { launch: "index.html", standard: "scorm2004" }).map((i) => i.code)).toContain("manifest-missing");
    const broken = result.entries.map((e) => (e.path === "imsmanifest.xml" ? inline(e.path, e.mime, "<manifest><a></manifest>") : e));
    expect(validatePackage(broken, { launch: "index.html", standard: "scorm2004" }).map((i) => i.code)).toContain("manifest-xml");
    const noLaunch = result.entries.filter((e) => e.path !== "index.html");
    const codes = validatePackage(noLaunch, { launch: "index.html", standard: "scorm2004" }).map((i) => i.code);
    expect(codes).toContain("launch-missing");
    expect(validatePackage(result.entries, { launch: "index.html", standard: "scorm12" }).map((i) => i.code)).toContain("manifest-version");
  });

  it("detecta runtime alterado", async () => {
    const { result } = await build("scorm12");
    const { runtime } = await resources();
    const tampered = result.entries.map((e) => (e.path === "runtime/runtime.js" ? inline(e.path, e.mime, "alert(1)") : e));
    expect(validatePackage(tampered, { launch: "index.html", standard: "scorm12", runtimeSha256: runtime.jsSha256 }).map((i) => i.code)).toContain("runtime-hash");
  });
});
