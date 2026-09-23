/**
 * Auditoría automatizada del prototipo `creador_elearning_scorm.html`.
 * Ejecuta los pasos del protocolo (docs/AUDITORIA.md) en Chromium y deja
 * las observaciones en prototype/audit/results.json. Los hallazgos NO hacen
 * fallar la prueba: solo se registran. Falla si el propio arnés falla.
 */
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { strFromU8, unzipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const PROTO = `file://${join(here, "..", "creador_elearning_scorm.html")}`;
const STORAGE_KEY = "salesland_elearning_project_v1";
const require = createRequire(import.meta.url);
const JSZIP = require.resolve("jszip/dist/jszip.min.js");

type Finding = { step: string; status: string; detail: string };
const results: Finding[] = [];
const record = (step: string, status: string, detail: string) => results.push({ step, status, detail });

async function savedState(page: Page): Promise<any> {
  await page.click("#saveBtn");
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), STORAGE_KEY);
}
const elCount = (page: Page) => page.locator("#canvas .el").count();
const routeJsZip = (page: Page) => page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ path: JSZIP, contentType: "text/javascript" }));

test("auditoría del prototipo", async ({ page, context }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("dialog", (d) => void d.dismiss());

  await page.goto(PROTO);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // 1. Crear módulo
  await page.click("#addModuleBtn");
  let st = await savedState(page);
  record("1 Crear módulo", st.modules.length === 2 ? "Funciona" : "No funciona", `módulos=${st.modules.length}; ids con Date.now+random: ${st.modules.map((m: any) => m.id).join(", ")}. No se puede renombrar, reordenar ni eliminar módulos (no hay controles).`);

  // 2. Crear pantalla
  await page.locator(".module-title button").first().click();
  st = await savedState(page);
  record("2 Crear pantalla", st.modules[0].slides.length === 2 ? "Funciona parcialmente" : "No funciona", `pantallas módulo 1=${st.modules[0].slides.length}. Sin eliminar, renombrar desde la lista ni reordenar pantallas (solo título en propiedades).`);

  // 3. Insertar texto + edición por teclado (granularidad de undo)
  await page.click('[data-add="text"]');
  await page.locator("#propText").fill("");
  await page.locator("#propText").pressSequentially("abcde");
  const canvasText = await page.locator("#canvas .el.text .content").innerText();
  await page.locator("#undoBtn").click();
  const afterUndo = await page.locator("#canvas .el.text .content").innerText();
  record(
    "3 Insertar texto",
    "Funciona parcialmente",
    `texto en lienzo="${canvasText}"; tras 1 deshacer="${afterUndo}" → cada tecla crea un snapshot completo del proyecto en el historial. Sin control de alineación ni interlineado en la UI; la edición directa es un prompt() del navegador (doble clic).`,
  );
  await page.locator("#canvas .el.text").first().click();
  await page.locator("#propText").fill("Texto auditoría");

  // 4. Insertar forma
  await page.click('[data-add="shape"]');
  await page.locator("#propX").fill("90");
  await page.locator("#propY").fill("320");
  const shapeSelect = await page.locator("#properties select").count();
  record("4 Insertar forma", "Funciona parcialmente", `se inserta un rectángulo redondeado; controles <select> en propiedades de la forma=${shapeSelect}: no hay forma de elegir círculo/triángulo aunque el código los contempla. Formas hechas con CSS (triángulo con clip-path recorta el borde).`);

  // 5. Subir imagen
  const png = await readFile(join(here, "..", "..", "e2e", "fixtures", "tiny.png"));
  await page.locator("#imageInput").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#canvas .el.image img")).toHaveCount(1);
  // Se separan los objetos (todos se insertan en 90,90 y se superponen).
  await page.locator("#propX").fill("560");
  await page.locator("#propY").fill("20");
  const imgSrc = (await page.locator("#canvas .el.image img").getAttribute("src")) ?? "";
  record("5 Subir imagen", "Riesgo técnico", `src="${imgSrc.slice(0, 30)}…" (${imgSrc.length} caracteres): la imagen se guarda como Data URL Base64 dentro del proyecto, del historial de deshacer y de localStorage. ALT por defecto = nombre del archivo.`);

  // 6. Subir video pequeño
  const webm = await readFile(join(here, "..", "..", "fixtures", "sample-video.webm"));
  await page.locator("#videoInput").setInputFiles({ name: "video.webm", mimeType: "video/webm", buffer: webm });
  await expect(page.locator("#canvas .el.video video")).toHaveCount(1);
  await page.locator("#propX").fill("460");
  await page.locator("#propY").fill("260");
  const vSrc = (await page.locator("#canvas .el.video video").getAttribute("src")) ?? "";
  st = await savedState(page);
  const bytes = JSON.stringify(st).length;
  record("6 Subir video pequeño", "Riesgo técnico", `video de ${webm.length} B → Data URL de ${vSrc.length} caracteres (+33 % por Base64). Tamaño del proyecto en localStorage: ${bytes} caracteres. Sin subtítulos, poster ni opciones de reproducción.`);

  // 7. Mover (precisión con escala)
  const canvasBox = (await page.locator("#canvas").boundingBox())!;
  const text = page.locator("#canvas .el.text").first();
  await text.click();
  const x0 = Number(await page.locator("#propX").inputValue());
  const b0 = (await text.boundingBox())!;
  await page.mouse.move(b0.x + 20, b0.y + 20);
  await page.mouse.down();
  await page.mouse.move(b0.x + 120, b0.y + 70, { steps: 5 });
  await page.mouse.up();
  const x1 = Number(await page.locator("#propX").inputValue());
  const b1 = (await text.boundingBox())!;
  const screenDx = Math.round(b1.x - b0.x);
  record(
    "7 Mover",
    screenDx === 100 ? "Funciona" : "Funciona parcialmente",
    `lienzo visible ${Math.round(canvasBox.width)}px de ancho (coordenadas lógicas 960). Cursor movido 100px → modelo +${x1 - x0}, objeto en pantalla +${screenDx}px. ${screenDx !== 100 ? "El lienzo no se escala (sin transform) pero el arrastre divide por la escala: el objeto no sigue al cursor y queda recortado cuando el lienzo mide menos de 960px." : ""}`,
  );

  // 8. Redimensionar
  const w0 = Number(await page.locator("#propW").inputValue());
  const handle = page.locator("#canvas .el.selected .resize");
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + 5, hb.y + 5);
  await page.mouse.down();
  await page.mouse.move(hb.x + 55, hb.y + 35, { steps: 5 });
  await page.mouse.up();
  const w1 = Number(await page.locator("#propW").inputValue());
  const shownW = Math.round((await text.boundingBox())!.width);
  record("8 Redimensionar", w1 !== w0 ? "Funciona parcialmente" : "No funciona", `cursor +50px → ancho modelo ${w0}→${w1}, ancho en pantalla ${shownW}px. Solo un tirador (esquina inferior derecha), sin mantener proporción, sin rotación con el mouse, sin snap ni guías.`);

  // 9-10. Copiar, pegar, duplicar (incluye entre pantallas)
  await text.click();
  const n0 = await elCount(page);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  const n1 = await elCount(page);
  await page.locator(".screen").nth(0).click(); // otra pantalla (Portada)
  const other0 = await elCount(page);
  await page.keyboard.press("Control+v");
  const other1 = await elCount(page);
  await page.locator(".screen").nth(1).click(); // volver a la pantalla de trabajo
  await page.locator("#canvas .el.text").last().click(); // la copia pegada queda encima
  await page.keyboard.press("Control+d");
  const n2 = await elCount(page);
  record("9 Copiar / pegar", n1 === n0 + 1 && other1 === other0 + 1 ? "Funciona" : "No funciona", `pegar en la misma pantalla ${n0}→${n1}; en otra pantalla ${other0}→${other1}. Portapapeles solo interno (no entre pestañas).`);
  record("10 Duplicar", n2 === n1 + 1 ? "Funciona" : "No funciona", `Ctrl+D ${n1}→${n2}. Duplicar pantalla también disponible (⧉).`);

  // 11. Eliminar
  await page.locator("#canvas .el.text").last().click();
  await page.keyboard.press("Delete");
  const n3 = await elCount(page);
  record("11 Eliminar", n3 === n2 - 1 ? "Funciona" : "No funciona", `Supr ${n2}→${n3}. No se pueden eliminar pantallas ni módulos.`);

  // 12. Deshacer / rehacer
  await page.keyboard.press("Control+z");
  const n4 = await elCount(page);
  await page.keyboard.press("Control+Shift+z");
  const n5 = await elCount(page);
  record("12 Deshacer / rehacer", n4 === n2 && n5 === n3 ? "Funciona parcialmente" : "No funciona", `deshacer ${n3}→${n4}, rehacer →${n5}. Cada snapshot clona el proyecto completo (incluidos los Base64) hasta 80 veces; un clic simple en un objeto también genera snapshot. Ctrl+Z dentro de un campo de texto deshace el proyecto, no el texto.`);

  // 13-14. Guardar y recargar
  st = await savedState(page);
  const before = { modules: st.modules.length, elements: st.modules.flatMap((m: any) => m.slides).reduce((a: number, s: any) => a + s.elements.length, 0) };
  await page.reload();
  const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), STORAGE_KEY);
  const afterEls = after.modules.flatMap((m: any) => m.slides).reduce((a: number, s: any) => a + s.elements.length, 0);
  record("13 Guardar", "Funciona parcialmente", `guarda en localStorage (${JSON.stringify(after).length} caracteres). El autosave muestra un toast "Proyecto guardado en este navegador" tras cada cambio. Sin versiones ni servidor.`);
  record("14 Recargar navegador", after.modules.length === before.modules && afterEls === before.elements ? "Funciona" : "No funciona", `antes: ${before.modules} módulos/${before.elements} objetos; después: ${after.modules.length}/${afterEls}.`);

  // 15-16. Exportar y reabrir proyecto
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#jsonExportBtn")]);
  const jsonText = await readFile((await dl.path())!, "utf8");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const fresh = await elCount(page);
  await page.locator("#jsonInput").setInputFiles({ name: "p.course.json", mimeType: "application/json", buffer: Buffer.from(jsonText) });
  await page.waitForTimeout(300);
  const reopened = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), STORAGE_KEY);
  const reEls = reopened.modules.flatMap((m: any) => m.slides).reduce((a: number, s: any) => a + s.elements.length, 0);
  record("15 Exportar proyecto", "Funciona", `${dl.suggestedFilename()} (${jsonText.length} caracteres, contiene Data URLs: ${jsonText.includes("base64,")}).`);
  record("16 Reabrir proyecto", reEls === afterEls ? "Funciona parcialmente" : "No funciona", `lienzo vacío tras limpiar=${fresh} objetos; reabierto=${reEls} objetos. Validación mínima (solo exige modules y schemaVersion): un JSON con estructura distinta rompe el render.`);

  // Robustez de la importación: pantalla sin "elements"
  const bad = JSON.stringify({ schemaVersion: "1.0.0", modules: [{ id: "m", title: "M", slides: [{ id: "s", title: "S" }] }] });
  const errsBefore = consoleErrors.length;
  await page.locator("#jsonInput").setInputFiles({ name: "malo.json", mimeType: "application/json", buffer: Buffer.from(bad) });
  await expect(page.locator("#toast")).not.toBeHidden();
  const importToast = await page.locator("#toast").innerText();
  await page.click('[data-add="text"]').catch(() => undefined);
  await page.waitForTimeout(200);
  const laterErr = consoleErrors.slice(errsBefore).join(" | ");
  const stillSaved = await page.evaluate((k) => (localStorage.getItem(k) ?? "").includes("Texto auditoría"), STORAGE_KEY);
  record(
    "16b Importar JSON malformado",
    "Riesgo técnico",
    `aviso: "${importToast}". Pero el estado en memoria ya fue reemplazado antes de fallar: al usar el editor después → ${laterErr ? `errores no controlados: ${laterErr.slice(0, 140)}` : "sin errores"}. El proyecto anterior sigue en localStorage=${stillSaved} solo porque el guardado no llegó a ejecutarse.`,
  );
  // Restaurar el proyecto bueno
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator("#jsonInput").setInputFiles({ name: "p.course.json", mimeType: "application/json", buffer: Buffer.from(jsonText) });
  await page.waitForTimeout(300);

  // 17. Preview y diferencias con el editor
  await page.locator("#canvas .el.text").last().click();
  await page.locator("#underlineBtn").click();
  const editorDeco = await page.locator("#canvas .el.text .content").last().evaluate((n) => getComputedStyle(n).textDecorationLine);
  await page.click("#previewBtn");
  const frame = page.frameLocator("#previewFrame");
  await expect(frame.locator(".player")).toBeVisible();
  const pf = (await (await page.locator("#previewFrame").elementHandle())!.contentFrame())!;
  const firstPreviewTexts = await pf.locator(".player").innerText();
  await pf.locator("#next").click(); // el preview siempre empieza en la pantalla 1
  await expect(pf.locator(".player img")).toHaveCount(1);
  const pv = await pf.evaluate(() =>
    [...document.querySelectorAll(".el > div")].map((n) => ({ text: n.textContent, deco: getComputedStyle(n).textDecorationLine, radius: getComputedStyle(n).borderRadius, align: getComputedStyle(n).textAlign })),
  );
  const previewDeco = pv.filter((x) => x.text === "Texto auditoría").map((x) => x.deco).join("/");
  const shapeRadiusEditor = await page.locator("#canvas .el.shape .content").first().evaluate((n) => getComputedStyle(n).borderRadius);
  const shapeRadiusPreview = pv.find((x) => x.text === "" && x.radius !== "0px")?.radius ?? "?";
  const sandbox = await page.locator("#previewFrame").getAttribute("sandbox");
  record(
    "17 Previsualizar",
    "Requiere rediseño",
    `el preview usa un segundo motor (runtimeJs) distinto del editor. Subrayado: editor="${editorDeco}", preview (ambas copias del texto)="${previewDeco}". Radio de forma redondeada: editor=${shapeRadiusEditor}, preview=${shapeRadiusPreview}. El preview no aplica text-align ni justify-content, ni clip-path del triángulo. iframe srcdoc sandbox=${sandbox ?? "ninguno"} (mismo origen que el editor). El preview siempre abre en la pantalla 1 (mostraba: "${firstPreviewTexts.replace(/\s+/g, " ").slice(0, 40)}"), no en la que se está editando.`,
  );
  await page.click("#closeModal");

  // 18. Validar
  await page.click("#validateBtn");
  const report = await page.locator("#modalBody").innerText();
  record("18 Validar", "Funciona parcialmente", `informe: "${report.replace(/\s+/g, " ").slice(0, 140)}". Revisa nombre, módulos vacíos, media sin src, ALT y tamaños. No revisa rutas, tamaño del proyecto, SCORM, contraste ni enlaces.`);
  await page.click("#closeModal");

  // 19a. Exportar SCORM sin Internet (CDN bloqueado)
  await page.route("https://cdn.jsdelivr.net/**", (r) => r.abort());
  await page.click("#scormBtn");
  await page.click("#closeModal");
  await expect(page.locator("#toast")).toContainText(/JSZip|Corrige/, { timeout: 10_000 });
  const offlineMsg = await page.locator("#toast").innerText();
  await page.unroute("https://cdn.jsdelivr.net/**");

  // 19b. Exportar SCORM con JSZip servido localmente
  await routeJsZip(page);
  const pickScorm = async (v: "1.2" | "2004") => {
    await page.locator("#canvas").click({ position: { x: 5, y: 5 } });
    await page.locator("#scormVersion").selectOption(v);
    const [d] = await Promise.all([page.waitForEvent("download"), page.click("#scormBtn")]);
    await page.click("#closeModal").catch(() => undefined);
    return unzipSync(new Uint8Array(await readFile((await d.path())!)));
  };
  const zip12 = await pickScorm("1.2");
  const zip2004 = await pickScorm("2004");
  const names = Object.keys(zip12).filter((n) => !n.endsWith("/")).sort();
  const man12 = strFromU8(zip12["imsmanifest.xml"]!);
  const man2004 = strFromU8(zip2004["imsmanifest.xml"]!);
  const listed = [...man12.matchAll(/<file href='([^']+)'/g)].map((m) => m[1]);
  const pm = strFromU8(zip12["course-data/project-manifest.json"]!);
  const cj = strFromU8(zip12["course-data/course.json"]!);
  record(
    "19 Exportar SCORM",
    "Requiere rediseño",
    `sin Internet: "${offlineMsg}". Con JSZip: archivos=${names.join(", ")}. imsmanifest en raíz=${names.includes("imsmanifest.xml")}. Archivos declarados en el manifest: ${listed.join(", ")} (faltan runtime, estilos, datos y assets). 1.2 sin <metadata>/<schemaversion>: ${!man12.includes("schemaversion")}. 2004 declara schemaversion: ${man2004.includes("2004 4th Edition")}. project-manifest.json idéntico a course.json: ${pm.replace(/\s/g, "") === cj.replace(/\s/g, "")}. Identificadores del manifest fijos ('ORG','ITEM','RES').`,
  );

  // 20. El SCORM dentro de un LMS simulado (1.2 y 2004)
  for (const [std, zip] of [["scorm12", zip12], ["scorm2004", zip2004]] as const) {
    const root = await mkdtemp(join(tmpdir(), "proto-lms-"));
    for (const [name, data] of Object.entries(zip)) {
      if (name.endsWith("/")) continue; // entradas de carpeta de JSZip
      await mkdir(dirname(join(root, "pkg", name)), { recursive: true });
      await writeFile(join(root, "pkg", name), data);
    }
    const mock = await build({ entryPoints: [join(here, "..", "..", "packages", "runtime", "src", "lms", "mock-api.ts")], bundle: true, format: "iife", globalName: "MockLms", write: false });
    await writeFile(join(root, "mock.js"), mock.outputFiles[0]!.text);
    await writeFile(
      join(root, "lms.html"),
      `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script src="mock.js"></script><iframe id="f" style="width:1200px;height:800px"></iframe><script>window.lms=MockLms.createMockLms("${std}");MockLms.installMockLms(window,window.lms);f.src="pkg/index.html";</script>`,
    );
    const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webm": "video/webm", ".xml": "application/xml" };
    const server = createServer(async (req, res) => {
      try {
        const p = normalize(join(root, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)));
        if (!p.startsWith(root) || !(await stat(p)).isFile()) throw new Error();
        res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" }).end(await readFile(p));
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const lmsPage = await context.newPage();
    const errs: string[] = [];
    lmsPage.on("pageerror", (e) => errs.push(e.message));
    lmsPage.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await lmsPage.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/lms.html`);
    const sco = lmsPage.frameLocator("#f");
    await expect(sco.locator(".player")).toBeVisible();
    const imgOk = await sco.locator("img").evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0));
    for (let i = 0; i < 4; i++) await sco.locator("#next").click();
    const calls = await lmsPage.evaluate(() => (window as any).lms.log.length);
    const status = await lmsPage.evaluate((k) => (window as any).lms.snapshot()[k], std === "scorm12" ? "cmi.core.lesson_status" : "cmi.completion_status");
    record(
      `20 SCORM ${std} en LMS simulado`,
      calls === 0 ? "No funciona" : "Funciona parcialmente",
      `llamadas a la API SCORM=${calls}; estado final=${status}; imágenes cargadas=${imgOk}; errores=${errs.length ? errs.join(" | ").slice(0, 120) : "ninguno"}. El runtime nunca busca window.API/API_1484_11: sin Initialize, completitud, ubicación, suspend_data, puntaje ni Terminate. El LMS lo verá como no iniciado/incompleto y no hay reanudación.`,
    );
    await lmsPage.close();
    await new Promise<void>((r) => server.close(() => r()));
  }

  // 21. Límite de localStorage con un video mediano
  const big = Buffer.alloc(6 * 1024 * 1024, 7);
  await page.locator("#videoInput").setInputFiles({ name: "grande.mp4", mimeType: "video/mp4", buffer: big });
  await page.waitForTimeout(1200);
  const saveStatus = await page.locator("#saveStatus").innerText();
  await page.reload();
  const kept = await page.evaluate((k) => (localStorage.getItem(k) ?? "").includes("grande.mp4"), STORAGE_KEY);
  record("21 Límite de localStorage", saveStatus.includes("Error") ? "Riesgo técnico" : "Funciona", `video de 6 MB → estado "${saveStatus}"; tras recargar, ¿se conservó el video?=${kept}. Lo no guardado se pierde al recargar.`);

  // 22. Pegar imagen desde el portapapeles del sistema
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  const imgs0 = await page.locator("#canvas .el.image").count();
  await page.locator("#canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(400);
  const imgsCanvas = await page.locator("#canvas .el.image").count();
  await page.locator("#projectTitle").focus();
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(400);
  const imgsField = await page.locator("#canvas .el.image").count();
  record(
    "22 Pegar imagen del portapapeles",
    "No funciona",
    `con el foco en el lienzo: imágenes ${imgs0}→${imgsCanvas}; con el foco en el campo del título: →${imgsField}. El atajo Ctrl+V hace preventDefault en keydown, lo que cancela el evento paste; solo funciona por accidente desde un campo de texto.`,
  );

  // Botones sin función
  await page.click("#layersTab");
  const layersActive = await page.locator("#layersTab").getAttribute("class");
  record("Extra · Pestaña Capas", "No funciona", `al pulsar "Capas" la clase queda "${layersActive}" y el panel no cambia: botón decorativo. Tampoco tienen efecto "Duración (s)", "Color principal" ni "Aprobación (%)" (no se usan en el runtime); el quiz no permite marcar la respuesta correcta (siempre la A) y no envía puntaje.`);

  const unexpected = consoleErrors.filter((e) => !e.includes("net::ERR_FAILED") && !laterErr.includes(e));
  record("Consola del editor", unexpected.length ? "Riesgo técnico" : "Funciona", unexpected.length ? unexpected.join(" | ").slice(0, 300) : "sin errores de JavaScript en el uso normal (solo los provocados a propósito en 16b y el bloqueo del CDN en 19)");

  await writeFile(join(here, "results.json"), JSON.stringify(results, null, 2));
});
