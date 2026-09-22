/**
 * Operaciones puras sobre el proyecto (devuelven una copia nueva).
 * Fase 2 las envolverá en Commands para Undo/Redo.
 */
import { createId, createModule, createSlide, type CourseProject, type ElementNode, type Slide } from "@studio/schema";

const clone = <T,>(v: T): T => structuredClone(v);

export type SlideRef = { moduleIndex: number; slideIndex: number; slide: Slide };

export function findSlide(p: CourseProject, slideId: string): SlideRef | null {
  for (let m = 0; m < p.modules.length; m++) {
    const s = p.modules[m]!.slides.findIndex((x) => x.id === slideId);
    if (s >= 0) return { moduleIndex: m, slideIndex: s, slide: p.modules[m]!.slides[s]! };
  }
  return null;
}

export function allSlides(p: CourseProject): Slide[] {
  return p.modules.flatMap((m) => m.slides);
}

export function addModule(p: CourseProject, title: string): { project: CourseProject; moduleId: string; slideId: string } {
  const next = clone(p);
  const slide = createSlide("Nueva pantalla", next.stage);
  const mod = createModule(title, next.modules.length, [slide]);
  next.modules.push(mod);
  return { project: next, moduleId: mod.id, slideId: slide.id };
}

export function renameModule(p: CourseProject, moduleId: string, title: string): CourseProject {
  const next = clone(p);
  const m = next.modules.find((x) => x.id === moduleId);
  if (m && title.trim()) m.title = title.trim();
  return next;
}

export function deleteModule(p: CourseProject, moduleId: string): CourseProject {
  const next = clone(p);
  if (next.modules.length <= 1) return next; // siempre queda al menos un módulo
  next.modules = next.modules.filter((m) => m.id !== moduleId).map((m, i) => ({ ...m, order: i }));
  return next;
}

export function moveModule(p: CourseProject, moduleId: string, delta: -1 | 1): CourseProject {
  const next = clone(p);
  const i = next.modules.findIndex((m) => m.id === moduleId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= next.modules.length) return next;
  [next.modules[i], next.modules[j]] = [next.modules[j]!, next.modules[i]!];
  next.modules.forEach((m, k) => (m.order = k));
  return next;
}

export function addSlide(p: CourseProject, moduleId: string, afterSlideId?: string): { project: CourseProject; slideId: string } {
  const next = clone(p);
  const m = next.modules.find((x) => x.id === moduleId) ?? next.modules[0]!;
  const slide = createSlide("Nueva pantalla", next.stage);
  const idx = afterSlideId ? m.slides.findIndex((s) => s.id === afterSlideId) : -1;
  m.slides.splice(idx >= 0 ? idx + 1 : m.slides.length, 0, slide);
  return { project: next, slideId: slide.id };
}

/** Duplica con ids nuevos (pantalla, capas y elementos) y remapea capas. */
export function duplicateSlide(p: CourseProject, slideId: string): { project: CourseProject; slideId: string } | null {
  const next = clone(p);
  const ref = findSlide(next, slideId);
  if (!ref) return null;
  const copy = clone(ref.slide);
  copy.id = createId("sld");
  copy.title = `${ref.slide.title} (copia)`;
  const layerMap = new Map<string, string>();
  copy.layers = copy.layers.map((l) => {
    const id = createId("lyr");
    layerMap.set(l.id, id);
    return { ...l, id };
  });
  copy.elements = copy.elements.map((e) => ({ ...e, id: createId("el"), layerId: layerMap.get(e.layerId) ?? copy.layers[0]!.id }));
  copy.timeline = [];
  next.modules[ref.moduleIndex]!.slides.splice(ref.slideIndex + 1, 0, copy);
  return { project: next, slideId: copy.id };
}

export function deleteSlide(p: CourseProject, slideId: string): CourseProject {
  const next = clone(p);
  if (allSlides(next).length <= 1) return next; // el curso necesita al menos una pantalla
  for (const m of next.modules) m.slides = m.slides.filter((s) => s.id !== slideId);
  // Botones que apuntaban a la pantalla eliminada pasan a "siguiente".
  for (const s of allSlides(next)) {
    for (const el of s.elements) if (el.type === "button" && el.action.type === "goto-slide" && el.action.slideId === slideId) el.action = { type: "next" };
  }
  return next;
}

/** Mueve una pantalla una posición (cruza módulos en los extremos). */
export function moveSlide(p: CourseProject, slideId: string, delta: -1 | 1): CourseProject {
  const next = clone(p);
  const ref = findSlide(next, slideId);
  if (!ref) return next;
  const mod = next.modules[ref.moduleIndex]!;
  const j = ref.slideIndex + delta;
  if (j >= 0 && j < mod.slides.length) {
    [mod.slides[ref.slideIndex], mod.slides[j]] = [mod.slides[j]!, mod.slides[ref.slideIndex]!];
    return next;
  }
  const target = next.modules[ref.moduleIndex + delta];
  if (!target) return next;
  mod.slides.splice(ref.slideIndex, 1);
  if (delta === -1) target.slides.push(ref.slide);
  else target.slides.unshift(ref.slide);
  return next;
}

export function updateSlide(p: CourseProject, slideId: string, fn: (s: Slide) => void): CourseProject {
  const next = clone(p);
  const ref = findSlide(next, slideId);
  if (ref) fn(ref.slide);
  return next;
}

export function addElement(p: CourseProject, slideId: string, el: ElementNode): CourseProject {
  return updateSlide(p, slideId, (s) => {
    s.elements.push(el);
  });
}

export function updateElement(p: CourseProject, slideId: string, elementId: string, fn: (el: ElementNode) => void): CourseProject {
  return updateSlide(p, slideId, (s) => {
    const el = s.elements.find((e) => e.id === elementId);
    if (el) fn(el);
  });
}

export function deleteElement(p: CourseProject, slideId: string, elementId: string): CourseProject {
  return updateSlide(p, slideId, (s) => {
    s.elements = s.elements.filter((e) => e.id !== elementId);
  });
}

export function duplicateElement(p: CourseProject, slideId: string, elementId: string): { project: CourseProject; elementId: string | null } {
  let newId: string | null = null;
  const project = updateSlide(p, slideId, (s) => {
    const i = s.elements.findIndex((e) => e.id === elementId);
    if (i < 0) return;
    const copy = { ...clone(s.elements[i]!), id: createId("el") };
    copy.name = `${copy.name} (copia)`;
    copy.x += 20;
    copy.y += 20;
    s.elements.splice(i + 1, 0, copy);
    newId = copy.id;
  });
  return { project, elementId: newId };
}

/** Orden de apilamiento: el arreglo va del fondo (0) al frente (n-1). */
export function reorderElement(p: CourseProject, slideId: string, elementId: string, to: "front" | "back" | "forward" | "backward"): CourseProject {
  return updateSlide(p, slideId, (s) => {
    const i = s.elements.findIndex((e) => e.id === elementId);
    if (i < 0) return;
    const [el] = s.elements.splice(i, 1);
    const j = to === "front" ? s.elements.length : to === "back" ? 0 : to === "forward" ? Math.min(s.elements.length, i + 1) : Math.max(0, i - 1);
    s.elements.splice(j, 0, el!);
  });
}
