import { useEffect, useState } from "react";
import { api } from "../api/endpoints.js";
import type { ProjectSummary } from "../api/types.js";
import { navigate } from "../lib/router.js";

const fmtDate = (s: string) => new Date(s).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });

export function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listProjects()
      .then((r) => setProjects(r.projects))
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    document.title = "Mis cursos · Studio E-learning";
    void load();
  }, []);

  const create = async (template: "blank" | "qa") => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createProject(template === "qa" ? "Curso QA · Fase 1" : title.trim() || "Curso sin título", template);
      navigate(`/projects/${r.project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: ProjectSummary) => {
    if (!confirm(`¿Eliminar "${p.title}"? Podrás pedir su recuperación al administrador (borrado lógico).`)) return;
    try {
      await api.deleteProject(p.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <header className="topbar">
        <span className="brand">
          Studio E-learning<small>autoría y SCORM</small>
        </span>
      </header>
      <main className="home">
        <h1>Mis cursos</h1>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <form
          className="create-card"
          onSubmit={(e) => {
            e.preventDefault();
            void create("blank");
          }}
        >
          <label className="field">
            <span>Nombre del nuevo curso</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Inducción de seguridad" maxLength={200} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Crear curso desde cero
          </button>
          <button className="btn" type="button" disabled={busy} onClick={() => void create("qa")}>
            Crear curso QA de ejemplo
          </button>
        </form>

        <h2>Proyectos</h2>
        {projects === null && !error && <p>Cargando…</p>}
        {projects?.length === 0 && <div className="empty">Aún no tienes cursos. Crea el primero arriba.</div>}
        <div className="cards">
          {projects?.map((p) => (
            <article key={p.id} className="card">
              <h3>{p.title}</h3>
              <span className="meta">
                {p.slideCount} pantalla{p.slideCount === 1 ? "" : "s"} · actualizado {fmtDate(p.updatedAt)}
              </span>
              <div className="actions">
                <button className="btn btn-primary btn-sm" onClick={() => navigate(`/projects/${p.id}`)}>
                  Abrir
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => void remove(p)} aria-label={`Eliminar ${p.title}`}>
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>

        <h2>Otras formas de crear</h2>
        <div className="cards">
          {[
            ["Importar PowerPoint", "Convierte cada diapositiva en una pantalla editable."],
            ["Importar PDF, Word o texto", "Genera la estructura a partir de documentos."],
            ["Crear con IA", "Propuesta de objetivos, estructura y evaluación editable."],
            ["Importar SCORM para editar", "Recupera un paquete SCORM como proyecto nativo."],
          ].map(([t, d]) => (
            <div key={t} className="card soon" aria-disabled="true">
              <span className="badge soon">Próximamente</span>
              <h3>{t}</h3>
              <span className="meta">{d}</span>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
