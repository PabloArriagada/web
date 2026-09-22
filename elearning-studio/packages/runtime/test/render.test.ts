// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { assetUri, createId, createImageElement, createProject, createShapeElement, createTextElement, type ShapeKind } from "@studio/schema";
import { renderSlide, shapeGeometry } from "../src/index.js";

describe("renderSlide", () => {
  const project = createProject({ title: "Render" });
  const slide = project.modules[0]!.slides[0]!;
  const L = slide.layers[0]!.id;
  const imgId = createId("ast");
  slide.elements.push(
    createImageElement(L, assetUri(imgId), { name: "Foto", x: 10, y: 20, width: 300, height: 200, alt: "Una foto" }),
    createTextElement(project.theme, L, { name: "HTML", text: "<img src=x onerror=alert(1)>" }),
    createShapeElement(project.theme, L, { shape: "star" }),
  );
  const hidden = createTextElement(project.theme, L, { name: "Oculto", text: "no" });
  hidden.visible = false;
  slide.elements.push(hidden);

  const stage = renderSlide(slide, { mode: "static", theme: project.theme, resolveAsset: (s) => s.replace("asset://", "/files/") });

  it("posiciona elementos en coordenadas del escenario", () => {
    expect(stage.style.width).toBe("1280px");
    const img = stage.querySelector("img")!;
    expect(img.style.left).toBe("10px");
    expect(img.style.top).toBe("20px");
    expect(img.getAttribute("src")).toBe(`/files/${imgId}`);
    expect(img.alt).toBe("Una foto");
  });

  it("nunca interpreta el texto del autor como HTML", () => {
    const texts = [...stage.querySelectorAll(".rt-text-inner")].map((n) => n.textContent);
    expect(texts).toContain("<img src=x onerror=alert(1)>");
    expect(stage.querySelectorAll("img").length).toBe(1);
  });

  it("omite elementos ocultos y marca decorativos", () => {
    expect([...stage.querySelectorAll(".rt-text-inner")].some((n) => n.textContent === "no")).toBe(false);
    const shape = stage.querySelector(".rt-el-shape")!;
    expect(shape.getAttribute("aria-hidden")).toBe("true");
    expect(shape.querySelector("polygon")).not.toBeNull();
  });

  it("el título se expone como encabezado", () => {
    const h = stage.querySelector('[role="heading"]');
    expect(h?.getAttribute("aria-level")).toBe("1");
  });
});

describe("shapeGeometry", () => {
  it("genera geometría para todas las formas", () => {
    const kinds: ShapeKind[] = ["rectangle", "rounded-rectangle", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "star", "arrow-right", "arrow-left", "line"];
    for (const k of kinds) {
      const g = shapeGeometry(k, 200, 100, 12);
      expect(g.tag).toMatch(/rect|ellipse|polygon|line/);
      for (const v of Object.values(g.attrs)) expect(v).not.toMatch(/NaN|undefined/);
    }
  });
});
