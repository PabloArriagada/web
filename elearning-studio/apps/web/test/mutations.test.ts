import { describe, expect, it } from "vitest";
import { createButtonElement, createProject, createTextElement, validateProject } from "@studio/schema";
import * as M from "../src/lib/mutations.js";
import { contrastRatio, normalizeHex } from "../src/lib/color.js";
import { messageForStatus, toApiError } from "../src/api/client.js";

const base = () => {
  const p = createProject({ title: "Mut" });
  return { p, slide: p.modules[0]!.slides[0]! };
};

describe("mutaciones del proyecto", () => {
  it("no mutan el original y producen proyectos válidos", () => {
    const { p } = base();
    const before = JSON.stringify(p);
    const r = M.addModule(p, "Módulo 2");
    const r2 = M.addSlide(r.project, r.moduleId);
    expect(JSON.stringify(p)).toBe(before);
    expect(M.allSlides(r2.project)).toHaveLength(3);
    expect(validateProject(r2.project).ok).toBe(true);
  });

  it("duplicar pantalla genera ids nuevos y remapea capas", () => {
    const { p, slide } = base();
    const r = M.duplicateSlide(p, slide.id)!;
    const copy = M.findSlide(r.project, r.slideId)!.slide;
    expect(copy.id).not.toBe(slide.id);
    expect(copy.elements[0]!.id).not.toBe(slide.elements[0]!.id);
    expect(copy.elements[0]!.layerId).toBe(copy.layers[0]!.id);
    expect(validateProject(r.project).issues.filter((i) => i.code === "duplicate-id")).toEqual([]);
  });

  it("eliminar pantalla repara botones que apuntaban a ella y conserva al menos una", () => {
    const { p, slide } = base();
    const r = M.addSlide(p, p.modules[0]!.id);
    const btn = createButtonElement(p.theme, slide.layers[0]!.id, { action: { type: "goto-slide", slideId: r.slideId } });
    const withBtn = M.addElement(r.project, slide.id, btn);
    const after = M.deleteSlide(withBtn, r.slideId);
    const b = M.findSlide(after, slide.id)!.slide.elements.find((e) => e.id === btn.id)!;
    expect(b.type === "button" && b.action).toEqual({ type: "next" });
    expect(M.allSlides(M.deleteSlide(after, slide.id))).toHaveLength(1);
    expect(validateProject(after).ok).toBe(true);
  });

  it("mover pantallas entre módulos", () => {
    const { p, slide } = base();
    const r = M.addModule(p, "B");
    const moved = M.moveSlide(r.project, slide.id, 1);
    expect(moved.modules[0]!.slides).toHaveLength(0);
    expect(moved.modules[1]!.slides[0]!.id).toBe(slide.id);
  });

  it("orden de apilamiento y duplicado de elementos", () => {
    const { p, slide } = base();
    const t2 = createTextElement(p.theme, slide.layers[0]!.id, { name: "B" });
    let q = M.addElement(p, slide.id, t2);
    const first = slide.elements[0]!.id;
    q = M.reorderElement(q, slide.id, first, "front");
    expect(M.findSlide(q, slide.id)!.slide.elements.at(-1)!.id).toBe(first);
    q = M.reorderElement(q, slide.id, first, "back");
    expect(M.findSlide(q, slide.id)!.slide.elements[0]!.id).toBe(first);
    const d = M.duplicateElement(q, slide.id, first);
    const els = M.findSlide(d.project, slide.id)!.slide.elements;
    expect(els).toHaveLength(3);
    expect(els[1]!.id).toBe(d.elementId);
    expect(els[1]!.x).toBe(els[0]!.x + 20);
  });
});

describe("utilidades", () => {
  it("contraste WCAG", () => {
    expect(contrastRatio("#000000", "#ffffff")!.toFixed(1)).toBe("21.0");
    expect(contrastRatio("#003a5d", "#ffffff")!).toBeGreaterThan(4.5);
    expect(contrastRatio("#36b9d6", "#ffffff")!).toBeLessThan(4.5);
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("azul")).toBeNull();
  });

  it("errores HTTP no JSON (413 de un proxy) producen mensajes legibles", async () => {
    const e = await toApiError(413, "text/html", async () => "<html>Payload Too Large</html>");
    expect(e.message).toBe(messageForStatus(413));
    expect(e.code).toBe("too-large");
    const j = await toApiError(409, "application/json", async () => JSON.stringify({ error: { code: "revision-conflict", message: "Conflicto" } }));
    expect(j.code).toBe("revision-conflict");
    const broken = await toApiError(500, "application/json", async () => "no es json");
    expect(broken.message).toBe("Error interno del servidor.");
  });
});
