import { useCallback, useEffect, useState } from "react";
import { assetUri, createAudioElement, createImageElement, createVideoElement, type ElementNode, type ValidationIssue } from "@studio/schema";
import type { AssetDto } from "../api/types.js";
import { AssetLibrary } from "../components/AssetLibrary.js";
import { InsertBar, type PickRequest } from "../components/InsertBar.js";
import { ElementInspector, SlideInspector } from "../components/Inspector.js";
import { Outline } from "../components/Outline.js";
import { PreviewDialog } from "../components/PreviewDialog.js";
import { PublishDialog } from "../components/PublishDialog.js";
import { SettingsDialog } from "../components/SettingsDialog.js";
import { SlideCanvas } from "../components/SlideCanvas.js";
import { ValidateDialog } from "../components/ValidateDialog.js";
import { VersionsDialog } from "../components/VersionsDialog.js";
import * as M from "../lib/mutations.js";
import { navigate } from "../lib/router.js";
import { useProjectEditor, type SaveState } from "../lib/useProjectEditor.js";

type Modal = "assets" | "preview" | "validate" | "publish" | "versions" | "settings" | null;

const SAVE_TEXT: Record<SaveState, string> = { saved: "Guardado", dirty: "Cambios sin guardar", saving: "Guardando…", error: "Error al guardar", conflict: "Conflicto de versión" };

function readMode(): boolean {
  try {
    return localStorage.getItem("studio-mode") === "expert";
  } catch {
    return false;
  }
}

export function Workspace({ projectId }: { projectId: string }) {
  const ed = useProjectEditor(projectId);
  const { project } = ed;
  const [slideId, setSlideId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [pick, setPick] = useState<PickRequest | null>(null);
  const [expert, setExpert] = useState(readMode);

  const slideRef = project && slideId ? M.findSlide(project, slideId) : null;
  const slide = slideRef?.slide ?? (project ? M.allSlides(project)[0] ?? null : null);
  const selected = slide?.elements.find((e) => e.id === selectedId) ?? null;

  useEffect(() => {
    if (project) document.title = `${project.title} · Studio E-learning`;
  }, [project?.title]);

  const selectSlide = useCallback((id: string) => {
    setSlideId(id);
    setSelectedId(null);
  }, []);

  const insert = (el: ElementNode) => {
    if (!slide) return;
    ed.update((p) => M.addElement(p, slide.id, el));
    setSelectedId(el.id);
  };

  const onPicked = (a: AssetDto) => {
    if (!slide || !pick) return;
    const layer = slide.layers[0]!.id;
    const src = assetUri(a.id);
    let el: ElementNode;
    if (pick.kind === "image") {
      const w0 = Number(a.metadata["width"]) || 400;
      const h0 = Number(a.metadata["height"]) || 300;
      const k = Math.min(1, (slide.width * 0.6) / w0, (slide.height * 0.6) / h0);
      const width = Math.round(w0 * k);
      const height = Math.round(h0 * k);
      el = createImageElement(layer, src, { name: a.filename, width, height, x: Math.round((slide.width - width) / 2), y: Math.round((slide.height - height) / 2) });
    } else if (pick.kind === "video") {
      el = createVideoElement(layer, src, { name: a.filename, x: Math.round((slide.width - 640) / 2), y: Math.round((slide.height - 360) / 2) });
    } else {
      el = createAudioElement(layer, src, { name: a.filename, x: 80, y: slide.height - 134 });
    }
    // El asset recién subido todavía no está en project.assets: se recarga el
    // proyecto (el servidor compone la lista de assets) antes de insertar.
    void ed.flush().then(async (saved) => {
      if (!saved) return; // no recargar si hay cambios sin guardar (se perderían)
      await ed.reload();
      insert(el);
    });
    setPick(null);
    setModal(null);
  };

  const flush = ed.flush;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
        return;
      }
      if (typing || modal || !slide || !selectedId) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        ed.update((p) => M.deleteElement(p, slide.id, selectedId));
        setSelectedId(null);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        ed.update((p) => {
          const r = M.duplicateElement(p, slide.id, selectedId);
          if (r.elementId) setSelectedId(r.elementId);
          return r.project;
        });
      } else if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush, modal, slide, selectedId, ed]);

  if (ed.loadError) {
    return (
      <main className="home">
        <div className="alert" role="alert">
          No se pudo abrir el proyecto: {ed.loadError}
        </div>
        <button className="btn" onClick={() => navigate("/")}>
          Volver a mis cursos
        </button>
      </main>
    );
  }
  if (!project || !slide) return <main className="home" aria-busy="true">Cargando proyecto…</main>;

  const goToIssue = (i: ValidationIssue) => {
    if (i.slideId) setSlideId(i.slideId);
    setSelectedId(i.elementId ?? null);
  };

  const status = ed.saveState;
  return (
    <div className="ws">
      <header className="ws-toolbar">
        <button className="btn btn-sm" onClick={() => void ed.flush().then(() => navigate("/"))} aria-label="Volver a mis cursos">
          ← Cursos
        </button>
        <span className="title" title={project.title}>
          {project.title}
        </span>
        <span className={`save-status ${status}`} role="status" title={ed.saveMessage ?? (ed.savedAt ? `Último guardado: ${ed.savedAt.toLocaleTimeString("es")}` : "")}>
          {SAVE_TEXT[status]}
        </span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => void ed.flush()} disabled={status === "saved" || status === "saving" || status === "conflict"}>
          Guardar
        </button>
        <button className="btn btn-sm" onClick={() => setModal("versions")}>
          Versiones
        </button>
        <button className="btn btn-sm" onClick={() => setModal("settings")}>
          Configuración
        </button>
        <button className="btn btn-sm" onClick={() => { setPick(null); setModal("assets"); }}>
          Recursos
        </button>
        <label className="check" style={{ margin: 0, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={expert}
            onChange={(e) => {
              setExpert(e.target.checked);
              try {
                localStorage.setItem("studio-mode", e.target.checked ? "expert" : "simple");
              } catch {
                /* sin almacenamiento */
              }
            }}
          />
          Modo experto
        </label>
        <button className="btn btn-sm" onClick={() => setModal("validate")}>
          Validar
        </button>
        <button className="btn btn-sm" onClick={() => setModal("preview")}>
          Vista previa
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => setModal("publish")}>
          Publicar
        </button>
      </header>
      <InsertBar project={project} slide={slide} onInsert={insert} onPick={(r) => { setPick(r); setModal("assets"); }} />
      {(status === "conflict" || status === "error" || ed.recoverable) && (
        <div style={{ padding: "0 12px" }}>
          {status === "conflict" && (
            <div className="alert" role="alert">
              {ed.saveMessage} Tus cambios locales no se guardaron.{" "}
              <button className="btn btn-sm" onClick={() => void ed.reload()}>
                Recargar la última versión
              </button>
            </div>
          )}
          {status === "error" && (
            <div className="alert" role="alert">
              Error al guardar: {ed.saveMessage}{" "}
              <button className="btn btn-sm" onClick={() => void ed.flush()}>
                Reintentar
              </button>
            </div>
          )}
          {ed.recoverable && (
            <div className="alert warning" role="alert">
              Encontramos cambios locales no guardados del {new Date(ed.recoverable.savedAt).toLocaleString("es")}.{" "}
              <button className="btn btn-sm" onClick={ed.recoverDraft}>
                Recuperar
              </button>{" "}
              <button className="btn btn-sm" onClick={ed.discardDraft}>
                Descartar
              </button>
            </div>
          )}
        </div>
      )}
      <div className="ws-body">
        <aside className="panel" aria-label="Módulos y pantallas">
          <Outline project={project} currentSlideId={slide.id} onSelectSlide={selectSlide} update={ed.update} />
        </aside>
        <main className="center" aria-label="Lienzo">
          <SlideCanvas project={project} slide={slide} selectedId={selectedId} onSelect={setSelectedId} />
          <p className="canvas-info">
            {slide.title} · {slide.width}×{slide.height} · Selecciona un objeto para editarlo. Supr: eliminar · Ctrl+D: duplicar · Ctrl+S: guardar
          </p>
        </main>
        <aside className="panel right" aria-label="Propiedades">
          {selected ? (
            <ElementInspector project={project} slide={slide} element={selected} update={ed.update} onSelect={setSelectedId} />
          ) : (
            <SlideInspector project={project} slide={slide} update={ed.update} onSelect={setSelectedId} />
          )}
        </aside>
      </div>

      <AssetLibrary
        projectId={project.id}
        open={modal === "assets"}
        pick={pick ? { types: pick.types, label: pick.label, onPick: onPicked } : null}
        onClose={() => { setModal(null); setPick(null); }}
        onChanged={() => void ed.flush().then(async (saved) => { if (saved) await ed.reload(); })}
      />
      <PreviewDialog projectId={project.id} open={modal === "preview"} onClose={() => setModal(null)} flush={ed.flush} startSlideId={slide.id} expert={expert} />
      <ValidateDialog projectId={project.id} open={modal === "validate"} onClose={() => setModal(null)} flush={ed.flush} onGo={goToIssue} />
      <PublishDialog project={project} open={modal === "publish"} onClose={() => setModal(null)} flush={ed.flush} />
      <VersionsDialog projectId={project.id} open={modal === "versions"} onClose={() => setModal(null)} flush={ed.flush} onRestored={(p, r) => { ed.replace(p, r); setSlideId(null); setSelectedId(null); }} />
      <SettingsDialog project={project} open={modal === "settings"} onClose={() => setModal(null)} update={ed.update} />
    </div>
  );
}
