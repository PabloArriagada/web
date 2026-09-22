import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { assetUri, createImageElement, type CourseProject } from "@studio/schema";
import { readNativePackage } from "@studio/publisher";
import { migrate } from "../src/db/migrate.js";
import type { Db } from "../src/db/pool.js";
import { generatePng, generateSvg, generateWav } from "../src/services/sample-media.js";
import { dbAvailable, makeTestApp, multipart, resetDb } from "./setup.js";

const hasDb = await dbAvailable();
if (!hasDb) console.warn("⚠ PostgreSQL de pruebas no disponible: se omiten las pruebas de la API (define TEST_DATABASE_URL).");

describe.skipIf(!hasDb)("API", () => {
  let db: Db;
  let t: Awaited<ReturnType<typeof makeTestApp>>;

  beforeAll(async () => {
    db = await resetDb();
    t = await makeTestApp(db, { maxUpload: 2 * 1024 * 1024 });
  });
  afterAll(async () => {
    await t?.cleanup();
    await t?.removeStorage();
    await db?.end();
  });

  const createProject = async (title = "Curso API") => {
    const r = await t.app.inject({ method: "POST", url: "/api/projects", payload: { title } });
    expect(r.statusCode).toBe(201);
    return r.json() as { project: CourseProject; revision: number };
  };
  const save = (project: CourseProject, baseRevision: number) =>
    t.app.inject({ method: "PUT", url: `/api/projects/${project.id}`, payload: { project, baseRevision } });
  const upload = (projectId: string, name: string, data: Buffer) => {
    const m = multipart([{ name, data }]);
    return t.app.inject({ method: "POST", url: `/api/projects/${projectId}/assets`, ...m });
  };

  it("health y migraciones idempotentes", async () => {
    expect((await t.app.inject("/api/health")).json()).toEqual({ ok: true, storage: "fs" });
    expect(await migrate(db)).toEqual([]);
  });

  it("crear, guardar, cerrar y reabrir conserva el proyecto", async () => {
    const { project, revision } = await createProject();
    expect(revision).toBe(1);
    project.title = "Título editado";
    const first = project.modules[0]!.slides[0]!.elements[0]!;
    if (first.type === "text") first.text = "Texto persistente ñandú";
    const r = await save(project, 1);
    expect(r.statusCode).toBe(200);
    expect(r.json().revision).toBe(2);

    // "Cerrar": se destruye la instancia del servidor; "reabrir": nueva instancia.
    const again = await makeTestApp(db, { storageRoot: t.root });
    const g = await again.app.inject(`/api/projects/${project.id}`);
    await again.cleanup();
    expect(g.statusCode).toBe(200);
    const body = g.json() as { project: CourseProject; revision: number };
    expect(body.revision).toBe(2);
    expect(body.project.title).toBe("Título editado");
    expect(body.project.modules).toEqual(project.modules);

    const list = (await t.app.inject("/api/projects")).json().projects as Array<{ id: string; slideCount: number }>;
    expect(list.find((p) => p.id === project.id)?.slideCount).toBe(1);
  });

  it("control de conflictos: una revisión antigua devuelve 409", async () => {
    const { project } = await createProject();
    expect((await save(project, 1)).statusCode).toBe(200);
    const stale = await save(project, 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("revision-conflict");
    expect(stale.json().error.details.currentRevision).toBe(2);
  });

  it("rechaza documentos inválidos con errores JSON comprensibles", async () => {
    const { project } = await createProject();
    const bad = { ...project, theme: { ...project.theme, colors: { ...project.theme.colors, primary: "rojo" } } };
    const r = await save(bad as CourseProject, 1);
    expect(r.statusCode).toBe(422);
    expect(r.headers["content-type"]).toContain("application/json");
    expect(r.json().error.code).toBe("invalid-project");
    const future = await save({ ...project, schemaVersion: "9.9.9" } as unknown as CourseProject, 1);
    expect(future.json().error.code).toBe("schema-version");
  });

  it("Asset Manager: subir, deduplicar, servir, rango, validar contenido", async () => {
    const { project } = await createProject();
    const png = generatePng(64, 48);
    const up = await upload(project.id, "Foto Principal.PNG", png);
    expect(up.statusCode).toBe(201);
    const asset = up.json().results[0].asset;
    expect(asset).toMatchObject({ type: "image", mimeType: "image/png", size: png.length, metadata: { width: 64, height: 48 } });
    expect(asset.storageKey).toBeUndefined();

    const dup = await upload(project.id, "copia.png", png);
    expect(dup.json().results[0]).toMatchObject({ duplicate: true, asset: { id: asset.id } });

    const content = await t.app.inject(`/api/projects/${project.id}/assets/${asset.id}/content`);
    expect(content.statusCode).toBe(200);
    expect(content.rawPayload.equals(png)).toBe(true);
    expect(content.headers["content-security-policy"]).toContain("sandbox");
    const ranged = await t.app.inject({ url: `/api/projects/${project.id}/assets/${asset.id}/content`, headers: { range: "bytes=0-7" } });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers["content-range"]).toBe(`bytes 0-7/${png.length}`);
    expect(ranged.rawPayload.length).toBe(8);

    expect((await upload(project.id, "falso.png", Buffer.from("no soy una imagen"))).json().error.code).toBe("content-mismatch");
    expect((await upload(project.id, "virus.exe", Buffer.from("MZ"))).statusCode).toBe(415);
    expect((await upload(project.id, "vacio.png", Buffer.alloc(0))).json().error.code).toBe("empty-file");
    const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await upload(project.id, "malo.svg", evil)).json().error.code).toBe("unsafe-svg");
    expect((await upload(project.id, "ok.svg", generateSvg())).statusCode).toBe(201);
    expect((await upload(project.id, "audio.wav", generateWav(0.2))).json().results[0].asset.type).toBe("audio");

    const list = (await t.app.inject(`/api/projects/${project.id}/assets`)).json().assets;
    expect(list).toHaveLength(3);
  });

  it("HTTP 413 devuelve JSON legible (nunca 'Payload Too Large is not valid JSON')", async () => {
    const { project } = await createProject();
    const r = await upload(project.id, "grande.wav", generateWav(60)); // ~2.6 MB > 2 MB
    expect(r.statusCode).toBe(413);
    expect(r.headers["content-type"]).toContain("application/json");
    expect(r.json().error.code).toBe("too-large");
    const assets = (await t.app.inject(`/api/projects/${project.id}/assets`)).json().assets;
    expect(assets).toHaveLength(0);
  });

  it("no permite eliminar un asset en uso y lista sus referencias", async () => {
    const { project, revision } = await createProject();
    const asset = (await upload(project.id, "img.png", generatePng(10, 10))).json().results[0].asset;
    const slide = project.modules[0]!.slides[0]!;
    slide.elements.push(createImageElement(slide.layers[0]!.id, assetUri(asset.id), { name: "Logo", alt: "Logo" }));
    expect((await save(project, revision)).statusCode).toBe(200);
    const listed = (await t.app.inject(`/api/projects/${project.id}/assets`)).json().assets[0];
    expect(listed.usage[0]).toMatchObject({ elementName: "Logo", slideTitle: "Portada" });
    const del = await t.app.inject({ method: "DELETE", url: `/api/projects/${project.id}/assets/${asset.id}` });
    expect(del.statusCode).toBe(409);
    slide.elements.pop();
    expect((await save(project, revision + 1)).statusCode).toBe(200);
    expect((await t.app.inject({ method: "DELETE", url: `/api/projects/${project.id}/assets/${asset.id}` })).statusCode).toBe(204);
  });

  it("preview usa el paquete compilado y sirve cada archivo", async () => {
    const { project, revision } = await createProject();
    const asset = (await upload(project.id, "img.png", generatePng(20, 20))).json().results[0].asset;
    const slide = project.modules[0]!.slides[0]!;
    slide.elements.push(createImageElement(slide.layers[0]!.id, assetUri(asset.id), { alt: "x" }));
    await save(project, revision);
    const r = await t.app.inject({ method: "POST", url: `/api/projects/${project.id}/preview`, payload: { standard: "scorm2004" } });
    const body = r.json();
    expect(body.ok).toBe(true);
    expect(body.launchUrl).toMatch(/^\/api\/preview\/[0-9a-f-]+\/index\.html$/);
    const html = await t.app.inject(body.launchUrl);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.body).toContain("runtime/runtime.js");
    const base = body.launchUrl.replace("index.html", "");
    const img = await t.app.inject(`${base}assets/images/${asset.id}.png`);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    const course = (await t.app.inject(`${base}course-data/course.json`)).json();
    expect(course.tracking.standard).toBe("scorm2004");
    expect((await t.app.inject(`${base}no-existe.js`)).statusCode).toBe(404);
  });

  it("publicación asíncrona: versión, trabajo, ZIP verificado y descarga", async () => {
    const r0 = await t.app.inject({ method: "POST", url: "/api/projects", payload: { title: "Curso QA", template: "qa" } });
    expect(r0.statusCode).toBe(201);
    const { project } = r0.json() as { project: CourseProject };
    expect(project.assets.map((a) => a.type).sort()).toEqual(["audio", "caption", "image", "svg", "video"]);
    const v = (await t.app.inject({ method: "POST", url: `/api/projects/${project.id}/validate`, payload: { standard: "scorm12" } })).json();
    expect(v.ok).toBe(true);

    for (const profile of project.publicationProfiles) {
      const pr = await t.app.inject({ method: "POST", url: `/api/projects/${project.id}/publications`, payload: { profileId: profile.id } });
      expect(pr.statusCode).toBe(202);
      const pubId = pr.json().publication.id;
      expect(pr.json().publication.status).toBe("queued");
      await t.ctx.worker.tick();
      const pub = (await t.app.inject(`/api/publications/${pubId}`)).json().publication;
      expect(pub.status).toBe("completed");
      expect(pub.steps.map((s: { name: string }) => s.name)).toContain("verificar-zip");
      const dl = await t.app.inject(pub.downloadUrl);
      expect(dl.headers["content-type"]).toBe("application/zip");
      expect(dl.headers["content-disposition"]).toContain(`-${profile.standard}.zip`);
      const files = unzipSync(new Uint8Array(dl.rawPayload));
      expect(Object.keys(files)).toContain("imsmanifest.xml");
      expect(strFromU8(files["imsmanifest.xml"]!)).toContain(profile.standard === "scorm12" ? "<schemaversion>1.2</schemaversion>" : "2004 4th Edition");
      const back = readNativePackage(files);
      expect(back.project.modules).toEqual(project.modules);
      expect(back.assets).toHaveLength(project.assets.length);
    }
    const versions = (await t.app.inject(`/api/projects/${project.id}/versions`)).json().versions;
    expect(versions.filter((x: { kind: string }) => x.kind === "publication")).toHaveLength(2);
  });

  it("una publicación con errores falla con informe y sin ZIP", async () => {
    const { project, revision } = await createProject();
    project.modules[0]!.slides = [];
    await save(project, revision);
    const pr = await t.app.inject({ method: "POST", url: `/api/projects/${project.id}/publications`, payload: { profileId: project.publicationProfiles[0]!.id } });
    await t.ctx.worker.tick();
    const pub = (await t.app.inject(`/api/publications/${pr.json().publication.id}`)).json().publication;
    expect(pub.status).toBe("failed");
    expect(pub.downloadUrl).toBeNull();
    expect(pub.report.issues.map((i: { code: string }) => i.code)).toContain("no-slides");
  });

  it("versiones: guardar y restaurar con respaldo automático", async () => {
    const { project, revision } = await createProject("Original");
    const v = await t.app.inject({ method: "POST", url: `/api/projects/${project.id}/versions`, payload: { label: "Antes del cambio" } });
    expect(v.statusCode).toBe(201);
    project.title = "Modificado";
    await save(project, revision);
    const restored = await t.app.inject({ method: "POST", url: `/api/projects/${project.id}/versions/${v.json().version.id}/restore` });
    expect(restored.json().project.title).toBe("Original");
    expect(restored.json().revision).toBe(revision + 2);
    const kinds = (await t.app.inject(`/api/projects/${project.id}/versions`)).json().versions.map((x: { kind: string }) => x.kind);
    expect(kinds).toEqual(["restore-backup", "manual"]);
  });

  it("ids inválidos y rutas desconocidas devuelven JSON", async () => {
    expect((await t.app.inject("/api/projects/../../etc")).statusCode).toBe(404);
    const bad = await t.app.inject("/api/projects/xyz");
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe("invalid-input");
    expect((await t.app.inject("/api/projects/prj_aaaaaaaaaaaaaaaaaaaa")).statusCode).toBe(404);
  });
});
