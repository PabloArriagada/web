import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

/**
 * Flujo obligatorio: CREAR → EDITAR → GUARDAR → CERRAR → REABRIR →
 * PREVISUALIZAR → VALIDAR → PUBLICAR → EXPORTAR SCORM (ZIP verificado).
 * La apertura en Moodle real no está automatizada (ver docs/ESTADO.md).
 */
const trackProblems = (page: Page) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()} @ ${m.location().url}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
};

test("flujo completo del autor en la app", async ({ page }) => {
  const problems = trackProblems(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mis cursos" })).toBeVisible();
  await expect(page.getByText("Importar PowerPoint")).toBeVisible();
  await expect(page.getByText("Próximamente").first()).toBeVisible();

  // CREAR
  await page.getByLabel("Nombre del nuevo curso").fill("Curso E2E");
  await page.getByRole("button", { name: "Crear curso desde cero" }).click();
  await expect(page).toHaveURL(/\/projects\/prj_/);
  const projectUrl = page.url();
  await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible();

  // EDITAR: texto
  await page.getByRole("toolbar", { name: "Insertar" }).getByRole("button", { name: "Texto", exact: true }).click();
  const content = page.getByLabel("Contenido");
  await content.fill("Hola desde la prueba E2E");
  await page.getByLabel("X", { exact: true }).fill("120");
  await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible({ timeout: 10_000 });

  // EDITAR: subir imagen e insertarla
  await page.getByRole("toolbar", { name: "Insertar" }).getByRole("button", { name: "Imagen" }).click();
  const dialog = page.getByRole("dialog", { name: "Insertar imagen" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await readFile(new URL("./fixtures/tiny.png", import.meta.url)) });
  await expect(dialog.getByText('"logo.png" subido.')).toBeVisible();
  await dialog.getByRole("button", { name: "Insertar" }).click();
  await expect(page.getByLabel("Texto alternativo (ALT)")).toBeVisible();
  await page.getByLabel("Texto alternativo (ALT)").fill("Logo de prueba");
  await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible({ timeout: 10_000 });

  // EDITAR: segunda pantalla
  await page.getByRole("button", { name: "+ Pantalla" }).click();
  await page.getByLabel("Título", { exact: true }).fill("Segunda pantalla");
  await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible({ timeout: 10_000 });

  // CERRAR y REABRIR (recarga completa del navegador)
  await page.goto("/");
  await page.goto(projectUrl);
  await expect(page.getByRole("button", { name: /^2\s*Segunda pantalla$/ })).toBeVisible();
  await page.getByRole("button", { name: /^1\s*Portada$/ }).click();
  await page.getByRole("button", { name: /^Texto\s*Texto$/ }).click();
  await expect(page.getByLabel("Contenido")).toHaveValue("Hola desde la prueba E2E");
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("120");

  // PREVISUALIZAR (mismo paquete que el ZIP) con SCORM Debugger
  await page.getByRole("button", { name: "Vista previa" }).click();
  const preview = page.getByRole("dialog", { name: "Vista previa del paquete" });
  const frame = page.frameLocator('iframe[title="Vista previa del curso"]');
  await expect(frame.getByText("Hola desde la prueba E2E")).toBeVisible();
  await expect(frame.getByRole("img", { name: "Logo de prueba" })).toBeVisible();
  await preview.getByRole("button", { name: /Mostrar SCORM Debugger/ }).click();
  const debuggerPanel = preview.getByRole("complementary", { name: "SCORM Debugger" });
  const lessonStatus = debuggerPanel.locator('dd[title="cmi.core.lesson_status"]');
  await expect(lessonStatus).toHaveText("incomplete");
  await frame.getByRole("button", { name: "Siguiente ›" }).click();
  await expect(lessonStatus).toHaveText("completed");
  await preview.getByRole("button", { name: "Cerrar y volver a entrar" }).click();
  await expect(frame.getByRole("dialog", { name: "Encontramos progreso anterior" })).toBeVisible();
  await frame.getByRole("button", { name: "Continuar donde quedé" }).click();
  await expect(frame.getByText("2 / 2")).toBeVisible();
  await preview.getByRole("button", { name: "Cerrar", exact: true }).click();

  // VALIDAR
  await page.getByRole("button", { name: "Validar", exact: true }).click();
  const validate = page.getByRole("dialog", { name: "Validar curso" });
  await expect(validate.getByText("Listo para publicar")).toBeVisible();
  await validate.getByRole("button", { name: "Cerrar", exact: true }).click();

  // PUBLICAR + EXPORTAR
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  const publish = page.getByRole("dialog", { name: "Publicar SCORM" });
  for (const profile of ["Moodle · SCORM 1.2", "LMS genérico · SCORM 2004 4ª ed."]) {
    await publish.getByLabel("Perfil de publicación").selectOption({ label: profile });
    await publish.getByRole("button", { name: "Publicar", exact: true }).click();
    const link = publish.getByRole("link", { name: /Descargar ZIP/ });
    await expect(link).toBeVisible({ timeout: 20_000 });
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    const zip = unzipSync(new Uint8Array(await readFile((await download.path())!)));
    const manifest = strFromU8(zip["imsmanifest.xml"]!);
    expect(manifest).toContain(profile.includes("1.2") ? "<schemaversion>1.2</schemaversion>" : "<schemaversion>2004 4th Edition</schemaversion>");
    const course = strFromU8(zip["course-data/course.json"]!);
    expect(course).toContain("Hola desde la prueba E2E");
    expect(course).not.toContain("asset://");
    expect(Object.keys(zip).some((n) => /^assets\/images\/ast_[a-z0-9]+\.png$/.test(n))).toBe(true);
  }
  expect(problems).toEqual([]);
});

test("conflicto de edición en dos pestañas se detecta y no sobrescribe", async ({ page, context }) => {
  await page.goto("/");
  await page.getByLabel("Nombre del nuevo curso").fill("Curso conflicto");
  await page.getByRole("button", { name: "Crear curso desde cero" }).click();
  await expect(page).toHaveURL(/\/projects\/prj_/);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible();

  await page.getByRole("button", { name: "+ Pantalla" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible({ timeout: 10_000 });
  await other.getByRole("button", { name: "+ Pantalla" }).click();
  await expect(other.getByRole("status").filter({ hasText: "Conflicto de versión" })).toBeVisible({ timeout: 10_000 });
  await expect(other.getByRole("button", { name: "Recargar la última versión" })).toBeVisible();
});

test("el curso QA de ejemplo se crea y pasa la validación", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Crear curso QA de ejemplo" }).click();
  await expect(page).toHaveURL(/\/projects\/prj_/);
  await expect(page.getByRole("button", { name: /^\d+\s*Video y audio$/ })).toBeVisible();
  await page.getByRole("button", { name: "Validar", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Validar curso" }).getByText("Listo para publicar")).toBeVisible();
});
