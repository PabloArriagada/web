import { useEffect, useRef, useState } from "react";
import type { CourseProject } from "@studio/schema";
import { api } from "../api/endpoints.js";
import type { Publication } from "../api/types.js";
import { fmtBytes } from "./AssetLibrary.js";
import { Dialog } from "./Dialog.js";
import { IssueList, StepList } from "./Report.js";

const STATUS: Record<Publication["status"], string> = { queued: "En cola", building: "Generando…", completed: "Listo", failed: "Falló" };

export function PublishDialog(props: { project: CourseProject; open: boolean; onClose: () => void; flush: () => Promise<boolean> }) {
  const { project } = props;
  const [profileId, setProfileId] = useState(project.publicationProfiles[0]!.id);
  const [current, setCurrent] = useState<Publication | null>(null);
  const [history, setHistory] = useState<Publication[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const loadHistory = () => api.listPublications(project.id).then((r) => setHistory(r.publications)).catch(() => undefined);

  useEffect(() => {
    if (props.open) void loadHistory();
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
     
  }, [props.open]);

  const poll = (id: string) => {
    timer.current = window.setTimeout(async () => {
      try {
        const { publication } = await api.getPublication(id);
        setCurrent(publication);
        if (publication.status === "queued" || publication.status === "building") poll(id);
        else void loadHistory();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 800);
  };

  const publish = async () => {
    setError(null);
    setCurrent(null);
    try {
      if (!(await props.flush())) throw new Error("No se pudo guardar el proyecto antes de publicar.");
      const { publication } = await api.publish(project.id, profileId);
      setCurrent(publication);
      poll(publication.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const busy = current?.status === "queued" || current?.status === "building";
  return (
    <Dialog title="Publicar SCORM" size="md" open={props.open} onClose={props.onClose}>
      <label className="field">
        <span>Perfil de publicación</span>
        <select className="select" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
          {project.publicationProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Se crea una versión inmutable del proyecto, se valida, se empaqueta y se verifica el ZIP antes de habilitar la descarga. Completitud:{" "}
        {(() => {
          const p = project.publicationProfiles.find((x) => x.id === profileId)!;
          return p.completion.rule === "all-slides" ? "ver todas las pantallas" : `ver el ${p.completion.percent}% de las pantallas`;
        })()}
        .
      </p>
      <button className="btn btn-primary" onClick={() => void publish()} disabled={busy}>
        {busy ? "Publicando…" : "Publicar"}
      </button>
      {error && <div className="alert" role="alert">{error}</div>}
      {current && (
        <section aria-live="polite" style={{ marginTop: 16 }}>
          <p>
            Estado: <strong>{STATUS[current.status]}</strong>
            {current.error && ` · ${current.error}`}
          </p>
          {current.steps && <StepList steps={current.steps} />}
          {current.downloadUrl && (
            <p>
              <a className="btn btn-primary" href={current.downloadUrl} download>
                Descargar ZIP ({current.size ? fmtBytes(current.size) : ""})
              </a>
            </p>
          )}
          {current.report && current.report.issues.length > 0 && <IssueList issues={current.report.issues} />}
        </section>
      )}
      <h3 style={{ margin: "20px 0 8px", fontSize: 14 }}>Publicaciones anteriores</h3>
      {history.length === 0 ? (
        <p className="hint">Aún no hay publicaciones.</p>
      ) : (
        <table className="simple">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Perfil</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {history.map((p) => (
              <tr key={p.id}>
                <td>{new Date(p.createdAt).toLocaleString("es")}</td>
                <td>{p.profile.name}</td>
                <td>{STATUS[p.status]}</td>
                <td>{p.downloadUrl && <a href={p.downloadUrl} download>Descargar</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
