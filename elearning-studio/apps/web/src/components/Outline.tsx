import type { CourseProject } from "@studio/schema";
import * as M from "../lib/mutations.js";

type Props = {
  project: CourseProject;
  currentSlideId: string;
  onSelectSlide: (id: string) => void;
  update: (fn: (p: CourseProject) => CourseProject) => void;
};

/** Panel izquierdo: módulos y pantallas (agregar, duplicar, ordenar, eliminar). */
export function Outline({ project, currentSlideId, onSelectSlide, update }: Props) {
  const total = M.allSlides(project).length;
  let n = 0;
  return (
    <nav className="panel-section" aria-label="Estructura del curso">
      <h2>
        Estructura
        <button
          className="btn btn-sm"
          onClick={() =>
            update((p) => {
              const r = M.addModule(p, `Módulo ${p.modules.length + 1}`);
              onSelectSlide(r.slideId);
              return r.project;
            })
          }
        >
          + Módulo
        </button>
      </h2>
      {project.modules.map((mod, mi) => (
        <section key={mod.id} className="outline-module" aria-label={`Módulo ${mod.title}`}>
          <div className="outline-module-head">
            <input aria-label="Nombre del módulo" defaultValue={mod.title} key={mod.title} onBlur={(e) => update((p) => M.renameModule(p, mod.id, e.target.value))} />
            <button className="btn btn-ghost btn-icon btn-sm" title="Subir módulo" aria-label={`Subir módulo ${mod.title}`} disabled={mi === 0} onClick={() => update((p) => M.moveModule(p, mod.id, -1))}>
              ↑
            </button>
            <button className="btn btn-ghost btn-icon btn-sm" title="Bajar módulo" aria-label={`Bajar módulo ${mod.title}`} disabled={mi === project.modules.length - 1} onClick={() => update((p) => M.moveModule(p, mod.id, 1))}>
              ↓
            </button>
            <button
              className="btn btn-ghost btn-icon btn-sm btn-danger"
              title="Eliminar módulo"
              aria-label={`Eliminar módulo ${mod.title}`}
              disabled={project.modules.length <= 1 || total - mod.slides.length < 1}
              onClick={() => {
                if (!confirm(`¿Eliminar el módulo "${mod.title}" y sus ${mod.slides.length} pantalla(s)?`)) return;
                update((p) => {
                  const next = M.deleteModule(p, mod.id);
                  if (!M.findSlide(next, currentSlideId)) onSelectSlide(M.allSlides(next)[0]!.id);
                  return next;
                });
              }}
            >
              ✕
            </button>
          </div>
          <ol className="outline-slides">
            {mod.slides.map((s) => {
              n++;
              const active = s.id === currentSlideId;
              return (
                <li key={s.id} className={`outline-slide ${active ? "active" : ""}`}>
                  <button className="pick" aria-current={active ? "true" : undefined} onClick={() => onSelectSlide(s.id)}>
                    <span className="num">{n}</span>
                    {s.title}
                  </button>
                  <span className="tools">
                    <button className="btn btn-ghost btn-icon btn-sm" aria-label={`Subir ${s.title}`} title="Subir" onClick={() => update((p) => M.moveSlide(p, s.id, -1))}>
                      ↑
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" aria-label={`Bajar ${s.title}`} title="Bajar" onClick={() => update((p) => M.moveSlide(p, s.id, 1))}>
                      ↓
                    </button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      aria-label={`Duplicar ${s.title}`}
                      title="Duplicar"
                      onClick={() =>
                        update((p) => {
                          const r = M.duplicateSlide(p, s.id);
                          if (!r) return p;
                          onSelectSlide(r.slideId);
                          return r.project;
                        })
                      }
                    >
                      ⧉
                    </button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm btn-danger"
                      aria-label={`Eliminar ${s.title}`}
                      title="Eliminar"
                      disabled={total <= 1}
                      onClick={() => {
                        if (!confirm(`¿Eliminar la pantalla "${s.title}"?`)) return;
                        update((p) => {
                          const next = M.deleteSlide(p, s.id);
                          if (active) onSelectSlide(M.allSlides(next)[0]!.id);
                          return next;
                        });
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() =>
              update((p) => {
                const r = M.addSlide(p, mod.id);
                onSelectSlide(r.slideId);
                return r.project;
              })
            }
          >
            + Pantalla
          </button>
        </section>
      ))}
    </nav>
  );
}
