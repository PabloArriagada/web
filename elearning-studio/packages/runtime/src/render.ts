/**
 * Renderizador compartido: lo usan el editor (modo "static"), el preview y
 * el paquete SCORM (modo "player"). Es la ÚNICA implementación que
 * convierte datos del curso en DOM.
 */
import type { ElementNode, Fill, Slide, TextStyle, Theme } from "@studio/schema";
import { shapeGeometry } from "./shapes.js";

export type RenderMode = "player" | "static";

export type RenderOptions = {
  mode: RenderMode;
  theme: Theme;
  /** Traduce `asset://id` (editor) o devuelve la ruta tal cual (paquete). */
  resolveAsset: (src: string) => string;
  /** Acción de botones en modo player. */
  onNavigate?: (action: Extract<ElementNode, { type: "button" }>["action"]) => void;
  document?: Document;
};

const SVG_NS = "http://www.w3.org/2000/svg";

export function cssFill(fill: Fill, resolve: (s: string) => string): Partial<CSSStyleDeclaration> {
  switch (fill.type) {
    case "none":
      return { background: "transparent" };
    case "solid":
      return { backgroundColor: fill.color };
    case "linear-gradient":
      return {
        backgroundImage: `linear-gradient(${fill.angle}deg, ${fill.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ")})`,
      };
    case "image":
      return {
        backgroundColor: fill.color ?? "transparent",
        backgroundImage: `url("${cssEscapeUrl(resolve(fill.src))}")`,
        backgroundSize: fill.fit === "fill" ? "100% 100%" : fill.fit,
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      };
  }
}

function cssEscapeUrl(url: string): string {
  return url.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c));
}

function applyTextStyle(node: HTMLElement, style: TextStyle, theme: Theme): void {
  const s = node.style;
  s.fontFamily = fontStack(style.fontFamily, theme);
  s.fontSize = `${style.fontSize}px`;
  s.color = style.color;
  s.fontWeight = style.bold ? "700" : "400";
  s.fontStyle = style.italic ? "italic" : "normal";
  s.textDecoration = style.underline ? "underline" : "none";
  s.textAlign = style.align;
  s.lineHeight = String(style.lineHeight);
  s.justifyContent = style.verticalAlign === "top" ? "flex-start" : style.verticalAlign === "bottom" ? "flex-end" : "center";
  if (style.background) s.backgroundColor = style.background;
}

export function fontStack(family: string, theme: Theme): string {
  const safe = family.replace(/["\\]/g, "");
  return `"${safe}", "${theme.fonts.body.replace(/["\\]/g, "")}", system-ui, sans-serif`;
}

function textBlock(doc: Document, text: string, style: TextStyle, theme: Theme, padding: number): HTMLElement {
  const box = doc.createElement("div");
  box.className = "rt-text";
  applyTextStyle(box, style, theme);
  box.style.padding = `${padding}px`;
  const inner = doc.createElement("div");
  inner.className = "rt-text-inner";
  inner.textContent = text; // nunca innerHTML: el texto del autor no es HTML confiable
  box.appendChild(inner);
  return box;
}

function svgEl(doc: Document, tag: string, attrs: Record<string, string>): SVGElement {
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function applyA11y(node: HTMLElement, el: ElementNode, fallbackLabel?: string): void {
  if (el.accessibility.decorative) {
    node.setAttribute("aria-hidden", "true");
    return;
  }
  const label = el.accessibility.altText?.trim() || fallbackLabel;
  if (label) node.setAttribute("aria-label", label);
}

let gradientCounter = 0;

function renderShape(doc: Document, el: Extract<ElementNode, { type: "shape" }>, opts: RenderOptions): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "rt-shape";
  const svg = svgEl(doc, "svg", {
    viewBox: `0 0 ${el.width} ${el.height}`,
    width: "100%",
    height: "100%",
    preserveAspectRatio: "none",
    focusable: "false",
    "aria-hidden": "true",
  });
  const geom = shapeGeometry(el.shape, el.width, el.height, el.cornerRadius);
  const node = svgEl(doc, geom.tag, geom.attrs);
  let paint = "none";
  if (el.fill.type === "solid") paint = el.fill.color;
  else if (el.fill.type === "linear-gradient") {
    const id = `rtg${++gradientCounter}`;
    const rad = ((el.fill.angle - 90) * Math.PI) / 180;
    const defs = svgEl(doc, "defs", {});
    const grad = svgEl(doc, "linearGradient", {
      id,
      x1: String(0.5 - Math.cos(rad) / 2),
      y1: String(0.5 - Math.sin(rad) / 2),
      x2: String(0.5 + Math.cos(rad) / 2),
      y2: String(0.5 + Math.sin(rad) / 2),
    });
    for (const s of el.fill.stops) grad.appendChild(svgEl(doc, "stop", { offset: String(s.offset), "stop-color": s.color }));
    defs.appendChild(grad);
    svg.appendChild(defs);
    paint = `url(#${id})`;
  } else if (el.fill.type === "image") {
    const id = `rtp${++gradientCounter}`;
    const defs = svgEl(doc, "defs", {});
    const pattern = svgEl(doc, "pattern", { id, patternUnits: "userSpaceOnUse", width: String(el.width), height: String(el.height) });
    pattern.appendChild(
      svgEl(doc, "image", {
        href: opts.resolveAsset(el.fill.src),
        width: String(el.width),
        height: String(el.height),
        preserveAspectRatio: el.fill.fit === "cover" ? "xMidYMid slice" : el.fill.fit === "contain" ? "xMidYMid meet" : "none",
      }),
    );
    defs.appendChild(pattern);
    svg.appendChild(defs);
    paint = `url(#${id})`;
  }
  if (el.shape === "line") {
    node.setAttribute("stroke", el.stroke?.color ?? (el.fill.type === "solid" ? el.fill.color : "#000000"));
    node.setAttribute("stroke-width", String(el.stroke?.width ?? 4));
  } else {
    node.setAttribute("fill", paint);
    if (el.stroke && el.stroke.width > 0) {
      node.setAttribute("stroke", el.stroke.color);
      node.setAttribute("stroke-width", String(el.stroke.width));
      if (el.stroke.dash !== "solid") node.setAttribute("stroke-dasharray", el.stroke.dash === "dashed" ? "8 6" : "2 4");
    }
  }
  node.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(node);
  wrap.appendChild(svg);
  if (el.text) {
    const style = el.textStyle ?? {
      fontFamily: opts.theme.fonts.body,
      fontSize: 20,
      color: "#ffffff",
      bold: false,
      italic: false,
      underline: false,
      align: "center" as const,
      verticalAlign: "middle" as const,
      lineHeight: 1.3,
    };
    const t = textBlock(doc, el.text, style, opts.theme, 8);
    t.classList.add("rt-shape-text");
    wrap.appendChild(t);
  }
  if (el.accessibility.decorative) wrap.setAttribute("aria-hidden", "true");
  else {
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", el.accessibility.altText?.trim() || el.text || el.name);
  }
  return wrap;
}

export function renderElement(el: ElementNode, opts: RenderOptions): HTMLElement {
  const doc = opts.document ?? document;
  let node: HTMLElement;
  switch (el.type) {
    case "text": {
      node = textBlock(doc, el.text, el.style, opts.theme, el.padding);
      if (el.role !== "paragraph") {
        node.setAttribute("role", "heading");
        node.setAttribute("aria-level", el.role.slice(-1));
      }
      if (el.accessibility.decorative) node.setAttribute("aria-hidden", "true");
      break;
    }
    case "image": {
      const img = doc.createElement("img");
      img.className = "rt-image";
      img.src = opts.resolveAsset(el.src);
      img.draggable = false;
      img.style.objectFit = el.fit;
      img.alt = el.accessibility.decorative ? "" : (el.accessibility.altText ?? "");
      if (el.accessibility.decorative) img.setAttribute("role", "presentation");
      node = img;
      break;
    }
    case "shape":
      node = renderShape(doc, el, opts);
      break;
    case "button": {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "rt-button";
      Object.assign(btn.style, cssFill(el.fill, opts.resolveAsset));
      applyTextStyle(btn, el.style, opts.theme);
      btn.style.borderRadius = `${el.cornerRadius}px`;
      if (el.stroke && el.stroke.width > 0) btn.style.border = `${el.stroke.width}px ${el.stroke.dash} ${el.stroke.color}`;
      btn.textContent = el.label;
      if (el.accessibility.altText) btn.setAttribute("aria-label", el.accessibility.altText);
      if (opts.mode === "player") btn.addEventListener("click", () => opts.onNavigate?.(el.action));
      else btn.tabIndex = -1;
      node = btn;
      break;
    }
    case "video": {
      const v = doc.createElement("video");
      v.className = "rt-media";
      v.src = opts.resolveAsset(el.src);
      if (el.poster) v.poster = opts.resolveAsset(el.poster);
      v.controls = el.controls;
      v.loop = el.loop;
      v.muted = el.muted;
      v.preload = "metadata";
      v.setAttribute("playsinline", "");
      if (opts.mode === "player" && el.autoplay) v.autoplay = true;
      for (const c of el.captions) {
        const tr = doc.createElement("track");
        tr.kind = "captions";
        tr.src = opts.resolveAsset(c.src);
        tr.srclang = c.srclang;
        tr.label = c.label;
        if (c.default) tr.default = true;
        v.appendChild(tr);
      }
      applyA11y(v, el, el.name);
      node = v;
      break;
    }
    case "audio": {
      const a = doc.createElement("audio");
      a.className = "rt-media";
      a.src = opts.resolveAsset(el.src);
      a.controls = el.controls;
      a.loop = el.loop;
      a.preload = "metadata";
      if (opts.mode === "player" && el.autoplay) a.autoplay = true;
      applyA11y(a, el, el.name);
      node = a;
      break;
    }
  }
  node.classList.add("rt-el", `rt-el-${el.type}`);
  node.dataset["elementId"] = el.id;
  const s = node.style;
  s.left = `${el.x}px`;
  s.top = `${el.y}px`;
  s.width = `${el.width}px`;
  s.height = `${el.height}px`;
  if (el.rotation) s.transform = `rotate(${el.rotation}deg)`;
  if (el.opacity !== 1) s.opacity = String(el.opacity);
  return node;
}

/** Renderiza una pantalla completa a tamaño nativo (sin escalar). */
export function renderSlide(slide: Slide, opts: RenderOptions): HTMLElement {
  const doc = opts.document ?? document;
  const stage = doc.createElement("div");
  stage.className = "rt-stage";
  stage.dataset["slideId"] = slide.id;
  stage.style.width = `${slide.width}px`;
  stage.style.height = `${slide.height}px`;
  stage.style.fontFamily = fontStack(opts.theme.fonts.body, opts.theme);
  Object.assign(stage.style, cssFill(slide.background, opts.resolveAsset));
  const hiddenLayers = new Set(slide.layers.filter((l) => !l.visible).map((l) => l.id));
  const layerOrder = new Map(slide.layers.map((l, i) => [l.id, i]));
  // Orden visual: capa (en orden de la lista) y luego orden del arreglo.
  const ordered = slide.elements
    .map((el, i) => ({ el, i }))
    .sort((a, b) => (layerOrder.get(a.el.layerId) ?? 0) - (layerOrder.get(b.el.layerId) ?? 0) || a.i - b.i);
  for (const { el } of ordered) {
    if (!el.visible || hiddenLayers.has(el.layerId)) continue;
    stage.appendChild(renderElement(el, opts));
  }
  return stage;
}
