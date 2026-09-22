import { expect, test, type Frame, type Page } from "@playwright/test";
import { makePackageSite } from "./package-harness.ts";

for (const standard of ["scorm12", "scorm2004"] as const) {
  test.describe(`paquete ${standard} en un LMS simulado`, () => {
    let site: Awaited<ReturnType<typeof makePackageSite>>;
    test.beforeAll(async () => {
      site = await makePackageSite(standard);
    });
    test.afterAll(async () => site?.close());

    const collectProblems = (page: Page) => {
      const problems: string[] = [];
      page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()} @ ${m.location().url}`));
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()}`));
      page.on("response", (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`));
      return problems;
    };
    const sco = async (page: Page): Promise<Frame> => {
      await expect.poll(() => page.frames().find((f) => f.url().endsWith("pkg/index.html"))).toBeTruthy();
      return page.frames().find((f) => f.url().endsWith("pkg/index.html"))!;
    };
    const value = (page: Page, key: string) => page.evaluate((k) => (window as any).value(k), key);

    test("se lanza, carga recursos y registra completitud y reanudación", async ({ page }) => {
      const problems = collectProblems(page);
      const fontResponses: string[] = [];
      page.on("response", (r) => r.url().includes("/assets/fonts/") && r.ok() && fontResponses.push(r.url()));
      await page.goto(`${site.url}/lms.html?std=${standard}`);
      const f = await sco(page);
      await expect(f.locator(".rt-counter")).toHaveText(/^1 \/ \d+$/);
      const total = Number((await f.locator(".rt-counter").innerText()).split("/")[1]);
      expect(total).toBe(5);
      await expect(f.getByRole("heading", { name: "Curso QA · Fase 1" }).first()).toBeVisible();

      // Fuentes empaquetadas (sin CDN).
      await f.evaluate(() => document.fonts.ready);
      expect(await f.evaluate(() => document.fonts.check('700 16px "Montserrat"'))).toBe(true);
      expect(fontResponses.length).toBeGreaterThan(0);

      // Recorrer todas las pantallas.
      const status = standard === "scorm12" ? "cmi.core.lesson_status" : "cmi.completion_status";
      expect(await value(page, status)).toBe("incomplete");
      for (let i = 1; i < total; i++) {
        await f.locator(".rt-next").click();
        await expect(f.locator(".rt-counter")).toHaveText(`${i + 1} / ${total}`);
        const title = await f.locator(".rt-stage").getAttribute("data-slide-id");
        expect(title).toBeTruthy();
        if (await f.locator("img.rt-image").count()) {
          await expect.poll(() => f.locator("img.rt-image").evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
        }
        if (await f.locator("video").count()) {
          await expect.poll(() => f.locator("video").evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
          await expect.poll(() => f.locator("video").evaluate((v) => (v as HTMLVideoElement).textTracks.length)).toBe(1);
          await expect.poll(() => f.locator("audio").evaluate((a) => (a as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1);
        }
      }
      await expect(f.locator(".rt-next")).toBeDisabled();
      expect(await value(page, status)).toBe("completed");
      if (standard === "scorm2004") expect(await value(page, "cmi.progress_measure")).toBe("1.0000");
      const lastSlide = await f.locator(".rt-stage").getAttribute("data-slide-id");
      expect(await value(page, standard === "scorm12" ? "cmi.core.lesson_location" : "cmi.location")).toBe(lastSlide);

      // Volver a la pantalla 2 y "cerrar" el curso: Terminate con exit=suspend.
      await f.locator(".rt-menu-btn").click();
      await f.locator(".rt-menu-item").nth(1).click();
      await page.evaluate(() => (window as any).closeSco());
      expect(await page.evaluate(() => (window as any).lms.state())).toBe("terminated");
      expect(await page.evaluate(() => (window as any).store.lastExit)).toBe("suspend");

      // Reingreso: diálogo de reanudación.
      await page.evaluate(() => (window as any).launch());
      const f2 = await sco(page);
      const dialog = f2.getByRole("dialog", { name: "Encontramos progreso anterior" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Continuar donde quedé" }).click();
      await expect(f2.locator(".rt-counter")).toHaveText(`2 / ${total}`);
      expect(await value(page, standard === "scorm12" ? "cmi.core.entry" : "cmi.entry")).toBe("resume");
      expect(await value(page, status)).toBe("completed");

      const log = await page.evaluate(() => (window as any).lms.log.filter((l: any) => l.errorCode !== "0"));
      expect(log).toEqual([]);
      expect(problems).toEqual([]);
    });

    test("abre sin LMS (archivo local) sin errores", async ({ page }) => {
      const problems = collectProblems(page);
      await page.goto(`file://${site.root}/pkg/index.html`);
      await expect(page.locator(".rt-counter")).toHaveText(/^1 \/ 5$/);
      await page.locator(".rt-next").click();
      await expect(page.locator(".rt-counter")).toHaveText("2 / 5");
      expect(problems).toEqual([]);
    });
  });
}
