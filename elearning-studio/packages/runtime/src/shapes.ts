import type { ShapeKind } from "@studio/schema";

function regularPolygon(sides: number, w: number, h: number, rotate = -Math.PI / 2): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotate + (i * 2 * Math.PI) / sides;
    pts.push(`${fmt(w / 2 + (w / 2) * Math.cos(a))},${fmt(h / 2 + (h / 2) * Math.sin(a))}`);
  }
  return pts.join(" ");
}

function star(points: number, w: number, h: number, inner = 0.45): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push(`${fmt(w / 2 + (w / 2) * r * Math.cos(a))},${fmt(h / 2 + (h / 2) * r * Math.sin(a))}`);
  }
  return pts.join(" ");
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Geometría SVG de cada forma en coordenadas del propio elemento (w×h).
 * Devuelve el nombre de etiqueta y sus atributos.
 */
export function shapeGeometry(kind: ShapeKind, w: number, h: number, radius: number): { tag: string; attrs: Record<string, string> } {
  switch (kind) {
    case "rectangle":
      return { tag: "rect", attrs: { x: "0", y: "0", width: fmt(w), height: fmt(h) } };
    case "rounded-rectangle": {
      const r = fmt(Math.min(radius, w / 2, h / 2));
      return { tag: "rect", attrs: { x: "0", y: "0", width: fmt(w), height: fmt(h), rx: r, ry: r } };
    }
    case "ellipse":
      return { tag: "ellipse", attrs: { cx: fmt(w / 2), cy: fmt(h / 2), rx: fmt(w / 2), ry: fmt(h / 2) } };
    case "triangle":
      return { tag: "polygon", attrs: { points: `${fmt(w / 2)},0 ${fmt(w)},${fmt(h)} 0,${fmt(h)}` } };
    case "diamond":
      return { tag: "polygon", attrs: { points: `${fmt(w / 2)},0 ${fmt(w)},${fmt(h / 2)} ${fmt(w / 2)},${fmt(h)} 0,${fmt(h / 2)}` } };
    case "pentagon":
      return { tag: "polygon", attrs: { points: regularPolygon(5, w, h) } };
    case "hexagon":
      return { tag: "polygon", attrs: { points: regularPolygon(6, w, h, 0) } };
    case "star":
      return { tag: "polygon", attrs: { points: star(5, w, h) } };
    case "arrow-right":
      return {
        tag: "polygon",
        attrs: { points: `0,${fmt(h * 0.3)} ${fmt(w * 0.6)},${fmt(h * 0.3)} ${fmt(w * 0.6)},0 ${fmt(w)},${fmt(h / 2)} ${fmt(w * 0.6)},${fmt(h)} ${fmt(w * 0.6)},${fmt(h * 0.7)} 0,${fmt(h * 0.7)}` },
      };
    case "arrow-left":
      return {
        tag: "polygon",
        attrs: { points: `${fmt(w)},${fmt(h * 0.3)} ${fmt(w * 0.4)},${fmt(h * 0.3)} ${fmt(w * 0.4)},0 0,${fmt(h / 2)} ${fmt(w * 0.4)},${fmt(h)} ${fmt(w * 0.4)},${fmt(h * 0.7)} ${fmt(w)},${fmt(h * 0.7)}` },
      };
    case "line":
      return { tag: "line", attrs: { x1: "0", y1: fmt(h / 2), x2: fmt(w), y2: fmt(h / 2) } };
  }
}
