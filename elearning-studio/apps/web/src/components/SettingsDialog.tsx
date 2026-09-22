import type { CourseProject, PublicationProfile } from "@studio/schema";
import { Dialog } from "./Dialog.js";

export function SettingsDialog(props: { project: CourseProject; open: boolean; onClose: () => void; update: (fn: (p: CourseProject) => CourseProject) => void }) {
  const { project } = props;
  const set = (fn: (p: CourseProject) => void) =>
    props.update((p) => {
      const next = structuredClone(p);
      fn(next);
      return next;
    });
  const setProfile = (id: string, fn: (p: PublicationProfile) => void) => set((p) => { const x = p.publicationProfiles.find((y) => y.id === id); if (x) fn(x); });
  return (
    <Dialog title="Configuración del curso" size="md" open={props.open} onClose={props.onClose}>
      <label className="field">
        <span>Título del curso</span>
        <input className="input" value={project.title} maxLength={200} onChange={(e) => set((p) => (p.title = e.target.value || p.title))} />
      </label>
      <label className="field">
        <span>Descripción</span>
        <textarea className="textarea" value={project.description ?? ""} maxLength={5000} onChange={(e) => set((p) => (p.description = e.target.value || undefined))} />
      </label>
      <label className="field">
        <span>Idioma (código BCP 47)</span>
        <input className="input" value={project.locale} maxLength={20} onChange={(e) => set((p) => (p.locale = e.target.value.length >= 2 ? e.target.value : p.locale))} />
      </label>
      <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>Reproductor</h3>
      <div className="grid-2">
        <label className="field">
          <span>Navegación</span>
          <select className="select" value={project.player.navigation} onChange={(e) => set((p) => (p.player.navigation = e.target.value as "free" | "linear"))}>
            <option value="free">Libre</option>
            <option value="linear">Lineal (sin saltar adelante)</option>
          </select>
        </label>
        <label className="field">
          <span>Reanudación</span>
          <select className="select" value={project.player.resume} onChange={(e) => set((p) => (p.player.resume = e.target.value as "ask" | "always" | "never"))}>
            <option value="ask">Preguntar</option>
            <option value="always">Reanudar siempre</option>
            <option value="never">Nunca</option>
          </select>
        </label>
      </div>
      {(["showMenu", "showProgress", "showNavigation"] as const).map((k) => (
        <label className="check" key={k}>
          <input type="checkbox" checked={project.player[k]} onChange={(e) => set((p) => (p.player[k] = e.target.checked))} />
          {{ showMenu: "Mostrar menú de contenido", showProgress: "Mostrar barra de progreso", showNavigation: "Mostrar botones Anterior/Siguiente" }[k]}
        </label>
      ))}
      <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>Perfiles de publicación</h3>
      {project.publicationProfiles.map((pr) => (
        <fieldset key={pr.id} style={{ border: "1px solid var(--c-border)", borderRadius: 8, marginBottom: 10 }}>
          <legend style={{ fontWeight: 700 }}>{pr.name}</legend>
          <div className="grid-2">
            <label className="field">
              <span>Completitud</span>
              <select className="select" value={pr.completion.rule} onChange={(e) => setProfile(pr.id, (x) => (x.completion.rule = e.target.value as "all-slides" | "percent-slides"))}>
                <option value="all-slides">Ver todas las pantallas</option>
                <option value="percent-slides">Ver un porcentaje de pantallas</option>
              </select>
            </label>
            {pr.completion.rule === "percent-slides" && (
              <label className="field">
                <span>Porcentaje</span>
                <input className="input" type="number" min={1} max={100} value={pr.completion.percent} onChange={(e) => { const n = Math.round(Number(e.target.value)); if (n >= 1 && n <= 100) setProfile(pr.id, (x) => (x.completion.percent = n)); }} />
              </label>
            )}
          </div>
          <p className="hint">Aprobación y puntaje se habilitarán con las evaluaciones (Fase 5).</p>
        </fieldset>
      ))}
    </Dialog>
  );
}
