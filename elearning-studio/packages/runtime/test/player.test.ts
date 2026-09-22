// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { createProject, createSlide, type CourseProject, type RuntimeCourse } from "@studio/schema";
import { LocalAdapter, Player, Scorm12Adapter, Scorm2004Adapter, decodeVisited, encodeVisited, type Scorm12Api, type Scorm2004Api } from "../src/index.js";
import { createMockLms, createMockStore } from "../src/lms/mock-api.js";

function course(slides = 4, patch: (p: CourseProject) => void = () => undefined): RuntimeCourse {
  const p = createProject({ title: "Curso de prueba" });
  for (let i = 1; i < slides; i++) p.modules[0]!.slides.push(createSlide(`Pantalla ${i + 1}`));
  patch(p);
  return {
    schemaVersion: p.schemaVersion,
    id: p.id,
    title: p.title,
    locale: p.locale,
    stage: p.stage,
    theme: p.theme,
    player: p.player,
    modules: p.modules,
    tracking: { standard: "scorm12", completion: { rule: "all-slides", percent: 100 }, passing: { enabled: false, threshold: 80 }, lms: "moodle" },
  };
}

const click = (el: Element | null) => (el as HTMLElement).click();
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Player", () => {
  let container: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("navega, marca progreso y completa en SCORM 1.2", async () => {
    const lms = createMockLms("scorm12");
    const c = course(3);
    const player = new Player({ container, course: c, adapter: new Scorm12Adapter(lms.api as Scorm12Api) });
    await player.start();
    expect(container.querySelector(".rt-counter")!.textContent).toBe("1 / 3");
    expect((container.querySelector(".rt-prev") as HTMLButtonElement).disabled).toBe(true);
    click(container.querySelector(".rt-next"));
    expect(lms.snapshot()["cmi.core.lesson_status"]).toBe("incomplete");
    click(container.querySelector(".rt-next"));
    expect(container.querySelector(".rt-counter")!.textContent).toBe("3 / 3");
    expect((container.querySelector(".rt-next") as HTMLButtonElement).disabled).toBe(true);
    expect(lms.snapshot()["cmi.core.lesson_status"]).toBe("completed");
    expect(lms.snapshot()["cmi.core.lesson_location"]).toBe(c.modules[0]!.slides[2]!.id);
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Pantalla 3 de 3");
    player.destroy();
    expect(lms.state()).toBe("terminated");
    expect(lms.log.filter((l) => l.method === "LMSCommit").length).toBeGreaterThanOrEqual(3);
  });

  it("pregunta si reanudar y continúa donde quedó (SCORM 2004)", async () => {
    const store = createMockStore();
    const c = course(4);
    const first = createMockLms("scorm2004", store);
    const p1 = new Player({ container, course: c, adapter: new Scorm2004Adapter(first.api as Scorm2004Api) });
    await p1.start();
    click(container.querySelector(".rt-next"));
    click(container.querySelector(".rt-next"));
    expect(first.snapshot()["cmi.progress_measure"]).toBe("0.7500");
    p1.destroy();

    const second = createMockLms("scorm2004", store);
    const p2 = new Player({ container, course: c, adapter: new Scorm2004Adapter(second.api as Scorm2004Api) });
    const started = p2.start();
    await tick();
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Encontramos progreso anterior");
    const cont = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Continuar donde quedé")!;
    cont.click();
    await started;
    expect(p2.currentIndex).toBe(2);
    expect(p2.visitedCount).toBe(3);
  });

  it("comenzar nuevamente vuelve a la primera pantalla y reinicia visitas", async () => {
    const store = createMockStore();
    const c = course(3);
    const a = createMockLms("scorm12", store);
    const p1 = new Player({ container, course: c, adapter: new Scorm12Adapter(a.api as Scorm12Api) });
    await p1.start();
    click(container.querySelector(".rt-next"));
    p1.destroy();
    const b = createMockLms("scorm12", store);
    const p2 = new Player({ container, course: c, adapter: new Scorm12Adapter(b.api as Scorm12Api) });
    const started = p2.start();
    await tick();
    const restart = [...container.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent === "Comenzar nuevamente") as HTMLButtonElement;
    restart.click();
    await started;
    expect(p2.currentIndex).toBe(0);
    expect(p2.visitedCount).toBe(1);
  });

  it("navegación lineal bloquea saltos en el menú", async () => {
    const c = course(4, (p) => (p.player.navigation = "linear"));
    const player = new Player({ container, course: c, adapter: new LocalAdapter("test-linear") });
    await player.start();
    const items = [...container.querySelectorAll<HTMLButtonElement>(".rt-menu-item")];
    expect(items.map((b) => b.disabled)).toEqual([false, false, true, true]);
    player.navigate({ type: "goto-slide", slideId: c.modules[0]!.slides[3]!.id });
    expect(player.currentIndex).toBe(0);
  });

  it("los botones de la pantalla navegan", async () => {
    const c = course(3, (p) => {
      const s = p.modules[0]!.slides[0]!;
      s.elements.push({
        id: "el_boton00000000000000",
        name: "Ir al final",
        type: "button",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        layerId: s.layers[0]!.id,
        accessibility: { decorative: false },
        label: "Ir",
        style: { fontFamily: "Montserrat", fontSize: 16, color: "#ffffff", bold: false, italic: false, underline: false, align: "center", verticalAlign: "middle", lineHeight: 1.2 },
        fill: { type: "solid", color: "#003a5d" },
        cornerRadius: 4,
        action: { type: "goto-slide", slideId: p.modules[0]!.slides[2]!.id },
      });
    });
    const player = new Player({ container, course: c, adapter: new LocalAdapter("test-btn") });
    await player.start();
    click(container.querySelector(".rt-button"));
    expect(player.currentIndex).toBe(2);
  });

  it("codifica visitas de forma compacta", () => {
    const v = Array.from({ length: 101 }, (_, i) => i % 3 === 0);
    const enc = encodeVisited(v);
    expect(enc.length).toBe(26);
    expect(decodeVisited(enc, 101)).toEqual(v);
  });
});
