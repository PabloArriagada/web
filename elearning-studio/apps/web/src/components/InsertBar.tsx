import {
  createButtonElement,
  createShapeElement,
  createTextElement,
  defaultTextStyle,
  ShapeKindSchema,
  type CourseProject,
  type ElementNode,
  type ShapeKind,
  type Slide,
} from "@studio/schema";
import type { AssetType } from "@studio/schema";

export type PickRequest = { types: AssetType[]; label: string; kind: "image" | "video" | "audio" };

const SHAPE_NAMES: Partial<Record<ShapeKind, string>> = { rectangle: "Rectángulo", "rounded-rectangle": "Redondeado", ellipse: "Círculo", triangle: "Triángulo", diamond: "Rombo", pentagon: "Pentágono", hexagon: "Hexágono", star: "Estrella", "arrow-right": "Flecha →", "arrow-left": "Flecha ←", line: "Línea" };

/** Barra "Insertar": solo muestra tipos que funcionan de extremo a extremo. */
export function InsertBar(props: { project: CourseProject; slide: Slide; onInsert: (el: ElementNode) => void; onPick: (req: PickRequest) => void }) {
  const { project, slide } = props;
  const layer = slide.layers[0]!.id;
  const center = (w: number, h: number) => ({ x: Math.round((slide.width - w) / 2), y: Math.round((slide.height - h) / 2) });
  return (
    <div className="ws-insert" role="toolbar" aria-label="Insertar">
      <span className="label">Insertar</span>
      <button className="btn btn-sm" onClick={() => props.onInsert(createTextElement(project.theme, layer, { name: "Título", text: "Título", role: "heading-2", width: 800, height: 80, ...center(800, 80), style: defaultTextStyle(project.theme, { fontSize: 40, bold: true, color: project.theme.colors.primary }) }))}>
        Título
      </button>
      <button className="btn btn-sm" onClick={() => props.onInsert(createTextElement(project.theme, layer, { ...center(480, 80) }))}>
        Texto
      </button>
      <label className="sr-only" htmlFor="shape-insert">
        Forma
      </label>
      <select
        id="shape-insert"
        className="select"
        style={{ width: 150, minHeight: 28, padding: "2px 6px" }}
        value=""
        onChange={(e) => {
          const shape = e.target.value as ShapeKind;
          if (!shape) return;
          const el = createShapeElement(project.theme, layer, { shape, ...center(240, shape === "line" ? 20 : 160), ...(shape === "line" ? { height: 20 } : {}) });
          el.name = SHAPE_NAMES[shape] ?? "Forma";
          props.onInsert(el);
        }}
      >
        <option value="">Forma…</option>
        {ShapeKindSchema.options.map((k) => (
          <option key={k} value={k}>
            {SHAPE_NAMES[k]}
          </option>
        ))}
      </select>
      <button className="btn btn-sm" onClick={() => props.onPick({ types: ["image", "svg"], label: "Insertar imagen", kind: "image" })}>
        Imagen
      </button>
      <button className="btn btn-sm" onClick={() => props.onPick({ types: ["video"], label: "Insertar video", kind: "video" })}>
        Video
      </button>
      <button className="btn btn-sm" onClick={() => props.onPick({ types: ["audio"], label: "Insertar audio", kind: "audio" })}>
        Audio
      </button>
      <button className="btn btn-sm" onClick={() => props.onInsert(createButtonElement(project.theme, layer, { ...center(220, 56) }))}>
        Botón
      </button>
    </div>
  );
}
