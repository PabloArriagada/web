import { assetUri } from "./assets.js";
import {
  createAudioElement,
  createButtonElement,
  createImageElement,
  createModule,
  createProject,
  createShapeElement,
  createSlide,
  createTextElement,
  createVideoElement,
  defaultTextStyle,
} from "./factory.js";
import type { Asset, CourseProject, ShapeKind } from "./model.js";

export type QaAssets = Partial<Record<"image" | "svg" | "video" | "audio" | "caption", Asset>>;

/**
 * Curso QA automático (alcance Fase 1): texto, formas, imagen, SVG, botones
 * de navegación, video con subtítulos y audio en varios módulos. Las
 * funciones de fases posteriores (timeline, quiz, triggers…) se agregarán
 * a este generador a medida que existan.
 */
export function createQaProject(assets: QaAssets = {}, title = "Curso QA · Fase 1"): CourseProject {
  const p = createProject({ title, description: "Proyecto generado automáticamente para pruebas de regresión." });
  const t = p.theme;
  p.assets = Object.values(assets).filter((a): a is Asset => Boolean(a)).map((a) => ({ ...a, projectId: p.id }));

  const intro = p.modules[0]!;
  intro.title = "Introducción";
  const cover = intro.slides[0]!;
  cover.background = { type: "solid", color: t.colors.primary };
  const title0 = cover.elements[0]!;
  if (title0.type === "text") title0.style.color = "#ffffff";
  cover.elements.push(
    createButtonElement(t, cover.layers[0]!.id, { name: "Comenzar", label: "Comenzar", x: 530, y: 460, action: { type: "next" } }),
  );

  const shapes = createSlide("Formas y texto");
  const L = shapes.layers[0]!.id;
  shapes.elements.push(
    createTextElement(t, L, {
      name: "Encabezado",
      text: "Formas básicas",
      x: 60,
      y: 30,
      width: 800,
      height: 70,
      role: "heading-2",
      style: defaultTextStyle(t, { fontSize: 40, bold: true, color: t.colors.primary }),
    }),
  );
  const kinds: ShapeKind[] = ["rectangle", "rounded-rectangle", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "star", "arrow-right"];
  kinds.forEach((shape, i) => {
    const el = createShapeElement(t, L, {
      name: `Forma ${shape}`,
      shape,
      x: 60 + (i % 5) * 240,
      y: 140 + Math.floor(i / 5) * 220,
      width: 200,
      height: 160,
      color: i % 2 ? t.colors.accent : t.colors.primary,
    });
    el.text = shape;
    el.textStyle = defaultTextStyle(t, { color: "#ffffff", align: "center", verticalAlign: "middle", fontSize: 18, bold: true });
    el.accessibility = { decorative: false, altText: `Forma ${shape}` };
    shapes.elements.push(el);
  });
  shapes.elements.push(
    createTextElement(t, L, {
      name: "Texto con estilos",
      text: "Negrita, cursiva y subrayado\nsegunda línea justificada",
      x: 60,
      y: 600,
      width: 700,
      height: 90,
      style: defaultTextStyle(t, { bold: true, italic: true, underline: true, background: t.colors.surface }),
    }),
  );
  intro.slides.push(shapes);

  const media = createModule("Multimedia", 1);
  const s1 = createSlide("Imágenes");
  const L1 = s1.layers[0]!.id;
  s1.elements.push(createTextElement(t, L1, { name: "Título", text: "Imagen y SVG", x: 60, y: 30, width: 800, height: 70, role: "heading-2", style: defaultTextStyle(t, { fontSize: 40, bold: true, color: t.colors.primary }) }));
  if (assets.image) s1.elements.push(createImageElement(L1, assetUri(assets.image.id), { name: "Foto", x: 60, y: 130, width: 520, height: 390, alt: "Imagen de prueba" }));
  if (assets.svg) s1.elements.push(createImageElement(L1, assetUri(assets.svg.id), { name: "Ilustración SVG", x: 660, y: 130, width: 520, height: 390, alt: "Ilustración vectorial de prueba" }));
  media.slides.push(s1);

  if (assets.video || assets.audio) {
    const s2 = createSlide("Video y audio");
    const L2 = s2.layers[0]!.id;
    s2.elements.push(createTextElement(t, L2, { name: "Título", text: "Video y audio", x: 60, y: 30, width: 800, height: 70, role: "heading-2", style: defaultTextStyle(t, { fontSize: 40, bold: true, color: t.colors.primary }) }));
    if (assets.video) {
      const v = createVideoElement(L2, assetUri(assets.video.id), { name: "Video", x: 60, y: 120, width: 640, height: 360 });
      if (assets.caption) v.captions.push({ src: assetUri(assets.caption.id), srclang: "es", label: "Español", default: true });
      s2.elements.push(v);
    }
    if (assets.audio) s2.elements.push(createAudioElement(L2, assetUri(assets.audio.id), { name: "Narración", x: 760, y: 120, width: 400, height: 54 }));
    media.slides.push(s2);
  }

  const close = createModule("Cierre", 2);
  const end = createSlide("Fin del curso");
  const L3 = end.layers[0]!.id;
  end.elements.push(
    createTextElement(t, L3, { name: "Mensaje", text: "¡Has completado el curso!", x: 140, y: 260, width: 1000, height: 100, role: "heading-1", style: defaultTextStyle(t, { fontSize: 48, bold: true, align: "center", color: t.colors.primary }) }),
    createButtonElement(t, L3, { name: "Volver al inicio", label: "Volver al inicio", x: 530, y: 440, action: { type: "goto-slide", slideId: cover.id } }),
  );
  close.slides.push(end);

  p.modules.push(media, close);
  return p;
}
