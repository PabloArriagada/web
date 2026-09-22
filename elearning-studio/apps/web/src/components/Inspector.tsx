import type { ReactNode } from "react";
import {
  assetUri,
  parseAssetUri,
  ShapeKindSchema,
  type CourseProject,
  type ElementNode,
  type Fill,
  type ShapeKind,
  type Slide,
  type TextStyle,
} from "@studio/schema";
import * as M from "../lib/mutations.js";
import { ColorField } from "./ColorField.js";

type Update = (fn: (p: CourseProject) => CourseProject) => void;

const FONTS = ["Montserrat", "Arial", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Courier New"];

const SHAPE_LABELS: Record<ShapeKind, string> = {
  rectangle: "Rectángulo",
  "rounded-rectangle": "Rectángulo redondeado",
  ellipse: "Círculo / óvalo",
  triangle: "Triángulo",
  diamond: "Rombo",
  pentagon: "Pentágono",
  hexagon: "Hexágono",
  star: "Estrella",
  "arrow-right": "Flecha derecha",
  "arrow-left": "Flecha izquierda",
  line: "Línea",
};

export const TYPE_LABELS: Record<ElementNode["type"], string> = {
  text: "Texto",
  image: "Imagen",
  shape: "Forma",
  button: "Botón",
  video: "Video",
  audio: "Audio",
};

function Num(props: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        className="input"
        type="number"
        value={Number.isFinite(props.value) ? Math.round(props.value * 100) / 100 : 0}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n)) props.onChange(props.min !== undefined ? Math.max(props.min, props.max !== undefined ? Math.min(props.max, n) : n) : n);
        }}
      />
    </label>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="panel-section">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

function AssetSelect(props: { project: CourseProject; label: string; value: string | undefined; types: string[]; optional?: boolean; onChange: (uri: string | undefined) => void }) {
  const current = props.value ? parseAssetUri(props.value) : null;
  const options = props.project.assets.filter((a) => props.types.includes(a.type));
  return (
    <label className="field">
      <span>{props.label}</span>
      <select className="select" value={current ?? ""} onChange={(e) => props.onChange(e.target.value ? assetUri(e.target.value) : undefined)}>
        {(props.optional || !current) && <option value="">{props.optional ? "— Ninguno —" : "Selecciona un recurso"}</option>}
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.filename}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextStyleEditor(props: { style: TextStyle; onChange: (s: TextStyle) => void; project: CourseProject; background: string }) {
  const s = props.style;
  const set = (patch: Partial<TextStyle>) => props.onChange({ ...s, ...patch });
  return (
    <>
      <div className="grid-2">
        <label className="field">
          <span>Fuente</span>
          <select className="select" value={s.fontFamily} style={{ fontFamily: s.fontFamily }} onChange={(e) => set({ fontFamily: e.target.value })}>
            {[...new Set([s.fontFamily, ...FONTS])].map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <Num label="Tamaño (px)" value={s.fontSize} min={6} max={400} onChange={(v) => set({ fontSize: v })} />
      </div>
      <div className="field">
        <span className="field-label">Estilo</span>
        <div className="toggle-group" role="group" aria-label="Estilo de texto">
          <button type="button" aria-pressed={s.bold} onClick={() => set({ bold: !s.bold })} style={{ fontWeight: 700 }}>
            N<span className="sr-only">egrita</span>
          </button>
          <button type="button" aria-pressed={s.italic} onClick={() => set({ italic: !s.italic })} style={{ fontStyle: "italic" }}>
            K<span className="sr-only">cursiva</span>
          </button>
          <button type="button" aria-pressed={s.underline} onClick={() => set({ underline: !s.underline })} style={{ textDecoration: "underline" }}>
            S<span className="sr-only">ubrayado</span>
          </button>
        </div>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>Alineación</span>
          <select className="select" value={s.align} onChange={(e) => set({ align: e.target.value as TextStyle["align"] })}>
            <option value="left">Izquierda</option>
            <option value="center">Centro</option>
            <option value="right">Derecha</option>
            <option value="justify">Justificado</option>
          </select>
        </label>
        <label className="field">
          <span>Vertical</span>
          <select className="select" value={s.verticalAlign} onChange={(e) => set({ verticalAlign: e.target.value as TextStyle["verticalAlign"] })}>
            <option value="top">Arriba</option>
            <option value="middle">Centro</option>
            <option value="bottom">Abajo</option>
          </select>
        </label>
      </div>
      <Num label="Interlineado" value={s.lineHeight} min={0.5} max={5} step={0.1} onChange={(v) => set({ lineHeight: v })} />
      <ColorField label="Color del texto" value={s.color} projectColors={props.project.theme.projectColors} contrastWith={s.background ?? props.background} onChange={(c) => set({ color: c })} />
    </>
  );
}

function solidColor(fill: Fill, fallback: string): string {
  return fill.type === "solid" ? fill.color : fallback;
}

export function ElementInspector(props: { project: CourseProject; slide: Slide; element: ElementNode; update: Update; onSelect: (id: string | null) => void }) {
  const { project, slide, element: el } = props;
  const edit = (fn: (e: ElementNode) => void) => props.update((p) => M.updateElement(p, slide.id, el.id, fn));
  const bg = solidColor(slide.background, "#ffffff");
  const idx = slide.elements.findIndex((e) => e.id === el.id);

  return (
    <>
      <Section title={`Objeto: ${TYPE_LABELS[el.type]}`}>
        <label className="field">
          <span>Nombre</span>
          <input className="input" value={el.name} maxLength={200} onChange={(e) => edit((x) => (x.name = e.target.value || x.name))} />
        </label>
        <div className="btn-group" role="group" aria-label="Acciones del objeto">
          <button className="btn btn-sm" onClick={() => props.update((p) => {
            const r = M.duplicateElement(p, slide.id, el.id);
            if (r.elementId) props.onSelect(r.elementId);
            return r.project;
          })}>
            Duplicar
          </button>
          <button className="btn btn-sm" disabled={idx === slide.elements.length - 1} onClick={() => props.update((p) => M.reorderElement(p, slide.id, el.id, "front"))}>
            Traer al frente
          </button>
          <button className="btn btn-sm" disabled={idx === slide.elements.length - 1} onClick={() => props.update((p) => M.reorderElement(p, slide.id, el.id, "forward"))}>
            Subir
          </button>
          <button className="btn btn-sm" disabled={idx === 0} onClick={() => props.update((p) => M.reorderElement(p, slide.id, el.id, "backward"))}>
            Bajar
          </button>
          <button className="btn btn-sm" disabled={idx === 0} onClick={() => props.update((p) => M.reorderElement(p, slide.id, el.id, "back"))}>
            Enviar al fondo
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => {
              props.onSelect(null);
              props.update((p) => M.deleteElement(p, slide.id, el.id));
            }}
          >
            Eliminar
          </button>
        </div>
      </Section>

      <Section title="Posición y tamaño">
        <div className="grid-2">
          <Num label="X" value={el.x} onChange={(v) => edit((x) => (x.x = v))} />
          <Num label="Y" value={el.y} onChange={(v) => edit((x) => (x.y = v))} />
          <Num label="Ancho" value={el.width} min={1} onChange={(v) => edit((x) => (x.width = v))} />
          <Num label="Alto" value={el.height} min={1} onChange={(v) => edit((x) => (x.height = v))} />
          <Num label="Rotación (°)" value={el.rotation} min={-360} max={360} onChange={(v) => edit((x) => (x.rotation = v))} />
          <Num label="Opacidad (%)" value={Math.round(el.opacity * 100)} min={0} max={100} onChange={(v) => edit((x) => (x.opacity = v / 100))} />
        </div>
        <label className="check">
          <input type="checkbox" checked={el.visible} onChange={(e) => edit((x) => (x.visible = e.target.checked))} /> Visible
        </label>
      </Section>

      {el.type === "text" && (
        <Section title="Texto">
          <label className="field">
            <span>Contenido</span>
            <textarea className="textarea" value={el.text} onChange={(e) => edit((x) => x.type === "text" && (x.text = e.target.value))} />
          </label>
          <label className="field">
            <span>Semántica</span>
            <select className="select" value={el.role} onChange={(e) => edit((x) => x.type === "text" && (x.role = e.target.value as typeof el.role))}>
              <option value="paragraph">Párrafo</option>
              <option value="heading-1">Título 1</option>
              <option value="heading-2">Título 2</option>
              <option value="heading-3">Título 3</option>
            </select>
          </label>
          <TextStyleEditor project={project} background={bg} style={el.style} onChange={(s) => edit((x) => x.type === "text" && (x.style = s))} />
          <label className="check">
            <input
              type="checkbox"
              checked={el.style.background !== undefined}
              onChange={(e) =>
                edit((x) => {
                  if (x.type !== "text") return;
                  if (e.target.checked) x.style.background = project.theme.colors.surface;
                  else delete x.style.background;
                })
              }
            />
            Fondo del cuadro de texto
          </label>
          {el.style.background !== undefined && (
            <ColorField label="Color de fondo" value={el.style.background} projectColors={project.theme.projectColors} onChange={(c) => edit((x) => x.type === "text" && (x.style.background = c))} />
          )}
        </Section>
      )}

      {el.type === "shape" && (
        <Section title="Forma">
          <label className="field">
            <span>Tipo de forma</span>
            <select className="select" value={el.shape} onChange={(e) => edit((x) => {
              if (x.type !== "shape") return;
              x.shape = e.target.value as ShapeKind;
              if (x.shape === "rounded-rectangle" && !x.cornerRadius) x.cornerRadius = 16;
            })}>
              {ShapeKindSchema.options.map((k) => (
                <option key={k} value={k}>
                  {SHAPE_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <ColorField label={el.shape === "line" ? "Color de línea" : "Relleno"} value={solidColor(el.fill, "#36b9d6")} projectColors={project.theme.projectColors} onChange={(c) => edit((x) => x.type === "shape" && (x.fill = { type: "solid", color: c }))} />
          {el.shape === "rounded-rectangle" && <Num label="Radio de esquinas" value={el.cornerRadius} min={0} max={500} onChange={(v) => edit((x) => x.type === "shape" && (x.cornerRadius = v))} />}
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(el.stroke)}
              onChange={(e) => edit((x) => {
                if (x.type !== "shape") return;
                if (e.target.checked) x.stroke = { color: project.theme.colors.primaryDark, width: 2, dash: "solid" };
                else delete x.stroke;
              })}
            />
            Borde
          </label>
          {el.stroke && (
            <>
              <ColorField label="Color del borde" value={el.stroke.color} projectColors={project.theme.projectColors} onChange={(c) => edit((x) => x.type === "shape" && x.stroke && (x.stroke.color = c))} />
              <Num label="Grosor" value={el.stroke.width} min={0} max={100} onChange={(v) => edit((x) => x.type === "shape" && x.stroke && (x.stroke.width = v))} />
            </>
          )}
          {el.shape !== "line" && (
            <>
              <label className="field">
                <span>Texto dentro de la forma</span>
                <textarea className="textarea" value={el.text} onChange={(e) => edit((x) => {
                  if (x.type !== "shape") return;
                  x.text = e.target.value;
                  x.textStyle ??= { fontFamily: project.theme.fonts.body, fontSize: 20, color: "#ffffff", bold: true, italic: false, underline: false, align: "center", verticalAlign: "middle", lineHeight: 1.3 };
                })} />
              </label>
              {el.text && el.textStyle && (
                <TextStyleEditor project={project} background={solidColor(el.fill, bg)} style={el.textStyle} onChange={(s) => edit((x) => x.type === "shape" && (x.textStyle = s))} />
              )}
            </>
          )}
        </Section>
      )}

      {el.type === "image" && (
        <Section title="Imagen">
          <AssetSelect project={project} label="Archivo" value={el.src} types={["image", "svg"]} onChange={(u) => u && edit((x) => x.type === "image" && (x.src = u))} />
          <label className="field">
            <span>Ajuste</span>
            <select className="select" value={el.fit} onChange={(e) => edit((x) => x.type === "image" && (x.fit = e.target.value as typeof el.fit))}>
              <option value="contain">Contener (mantiene proporción)</option>
              <option value="cover">Cubrir (recorta)</option>
              <option value="fill">Estirar</option>
            </select>
          </label>
          <button
            className="btn btn-sm"
            onClick={() => {
              const a = project.assets.find((x) => x.id === parseAssetUri(el.src));
              const w = Number(a?.metadata["width"]);
              const h = Number(a?.metadata["height"]);
              if (w > 0 && h > 0) edit((x) => (x.height = Math.round((x.width * h) / w)));
            }}
          >
            Ajustar alto a la proporción original
          </button>
        </Section>
      )}

      {el.type === "button" && (
        <Section title="Botón">
          <label className="field">
            <span>Etiqueta</span>
            <input className="input" value={el.label} maxLength={200} onChange={(e) => edit((x) => x.type === "button" && e.target.value && (x.label = e.target.value))} />
          </label>
          <label className="field">
            <span>Al hacer clic</span>
            <select
              className="select"
              value={el.action.type === "goto-slide" ? `goto:${el.action.slideId}` : el.action.type}
              onChange={(e) =>
                edit((x) => {
                  if (x.type !== "button") return;
                  const v = e.target.value;
                  x.action = v.startsWith("goto:") ? { type: "goto-slide", slideId: v.slice(5) } : { type: v as "next" | "previous" | "none" };
                })
              }
            >
              <option value="next">Ir a la siguiente pantalla</option>
              <option value="previous">Ir a la pantalla anterior</option>
              {M.allSlides(project).map((s, i) => (
                <option key={s.id} value={`goto:${s.id}`}>
                  Ir a: {i + 1}. {s.title}
                </option>
              ))}
              <option value="none">Sin acción</option>
            </select>
          </label>
          <ColorField label="Color del botón" value={solidColor(el.fill, "#003a5d")} projectColors={project.theme.projectColors} onChange={(c) => edit((x) => x.type === "button" && (x.fill = { type: "solid", color: c }))} />
          <TextStyleEditor project={project} background={solidColor(el.fill, "#003a5d")} style={el.style} onChange={(s) => edit((x) => x.type === "button" && (x.style = s))} />
          <Num label="Radio de esquinas" value={el.cornerRadius} min={0} max={500} onChange={(v) => edit((x) => x.type === "button" && (x.cornerRadius = v))} />
        </Section>
      )}

      {el.type === "video" && (
        <Section title="Video">
          <AssetSelect project={project} label="Archivo de video" value={el.src} types={["video"]} onChange={(u) => u && edit((x) => x.type === "video" && (x.src = u))} />
          <AssetSelect project={project} label="Imagen de portada (poster)" value={el.poster} types={["image"]} optional onChange={(u) => edit((x) => {
            if (x.type !== "video") return;
            if (u) x.poster = u;
            else delete x.poster;
          })} />
          <AssetSelect
            project={project}
            label="Subtítulos (VTT)"
            value={el.captions[0]?.src}
            types={["caption"]}
            optional
            onChange={(u) => edit((x) => {
              if (x.type !== "video") return;
              x.captions = u ? [{ src: u, srclang: project.locale.slice(0, 2), label: "Subtítulos", default: true }] : [];
            })}
          />
          {(["controls", "autoplay", "loop", "muted"] as const).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={el[k]} onChange={(e) => edit((x) => x.type === "video" && (x[k] = e.target.checked))} />
              {{ controls: "Mostrar controles", autoplay: "Reproducir automáticamente", loop: "Repetir", muted: "Silenciado" }[k]}
            </label>
          ))}
          {el.autoplay && !el.muted && <p className="hint">Los navegadores pueden bloquear la reproducción automática con sonido.</p>}
        </Section>
      )}

      {el.type === "audio" && (
        <Section title="Audio">
          <AssetSelect project={project} label="Archivo de audio" value={el.src} types={["audio"]} onChange={(u) => u && edit((x) => x.type === "audio" && (x.src = u))} />
          {(["controls", "autoplay", "loop"] as const).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={el[k]} onChange={(e) => edit((x) => x.type === "audio" && (x[k] = e.target.checked))} />
              {{ controls: "Mostrar controles", autoplay: "Reproducir automáticamente", loop: "Repetir" }[k]}
            </label>
          ))}
        </Section>
      )}

      <Section title="Accesibilidad">
        <label className="check">
          <input type="checkbox" checked={el.accessibility.decorative} onChange={(e) => edit((x) => (x.accessibility.decorative = e.target.checked))} />
          Decorativo (oculto a lectores de pantalla)
        </label>
        {!el.accessibility.decorative && (
          <label className="field">
            <span>{el.type === "image" ? "Texto alternativo (ALT)" : "Nombre accesible"}</span>
            <textarea
              className="textarea"
              style={{ minHeight: 56 }}
              value={el.accessibility.altText ?? ""}
              onChange={(e) =>
                edit((x) => {
                  if (e.target.value) x.accessibility.altText = e.target.value;
                  else delete x.accessibility.altText;
                })
              }
            />
          </label>
        )}
      </Section>
    </>
  );
}

export function SlideInspector(props: { project: CourseProject; slide: Slide; update: Update; onSelect: (id: string | null) => void }) {
  const { project, slide } = props;
  const edit = (fn: (s: Slide) => void) => props.update((p) => M.updateSlide(p, slide.id, fn));
  return (
    <>
      <Section title="Pantalla">
        <label className="field">
          <span>Título</span>
          <input className="input" value={slide.title} maxLength={200} onChange={(e) => edit((s) => (s.title = e.target.value || s.title))} />
        </label>
        <ColorField label="Color de fondo" value={solidColor(slide.background, "#ffffff")} projectColors={project.theme.projectColors} onChange={(c) => edit((s) => (s.background = { type: "solid", color: c }))} />
        <AssetSelect
          project={project}
          label="Imagen de fondo"
          value={slide.background.type === "image" ? slide.background.src : undefined}
          types={["image", "svg"]}
          optional
          onChange={(u) => edit((s) => {
            const color = solidColor(s.background, s.background.type === "image" ? (s.background.color ?? "#ffffff") : "#ffffff");
            s.background = u ? { type: "image", src: u, fit: "cover", color } : { type: "solid", color };
          })}
        />
        <label className="field">
          <span>Descripción para lectores de pantalla</span>
          <textarea className="textarea" style={{ minHeight: 56 }} value={slide.accessibility.description ?? ""} onChange={(e) => edit((s) => (s.accessibility.description = e.target.value || undefined))} />
        </label>
        <label className="field">
          <span>Notas del autor (no se publican en pantalla)</span>
          <textarea className="textarea" style={{ minHeight: 56 }} value={slide.notes} onChange={(e) => edit((s) => (s.notes = e.target.value))} />
        </label>
      </Section>
      <Section title={`Objetos (${slide.elements.length})`}>
        {slide.elements.length === 0 ? (
          <p className="hint">Usa la barra “Insertar” para agregar texto, imágenes, formas, botones, video o audio.</p>
        ) : (
          <ul className="el-list">
            {[...slide.elements].reverse().map((el) => (
              <li key={el.id}>
                <button onClick={() => props.onSelect(el.id)}>
                  <span className="el-type">{TYPE_LABELS[el.type]}</span>
                  {el.name}
                  {!el.visible && " (oculto)"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
