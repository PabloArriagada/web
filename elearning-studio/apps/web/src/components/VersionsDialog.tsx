import { useEffect, useState } from "react";
import type { CourseProject } from "@studio/schema";
import { api } from "../api/endpoints.js";
import type { Version } from "../api/types.js";
import { Dialog } from "./Dialog.js";

const KIND = { manual: "Manual", publication: "Publicación", "restore-backup": "Respaldo automático" } as const;

export function VersionsDialog(props: { projectId: string; open: boolean; onClose: () => void; flush: () => Promise<boolean>; onRestored: (p: CourseProject, revision: number) => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => api.listVersions(props.projectId).then((r) => setVersions(r.versions)).catch((e: Error) => setError(e.message));
  useEffect(() => {
    if (props.open) void load();
     
  }, [props.open]);

  const save = async () => {
    setError(null);
    try {
      if (!(await props.flush())) throw new Error("No se pudo guardar antes de crear la versión.");
      await api.createVersion(props.projectId, label.trim());
      setLabel("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const restore = async (v: Version) => {
    if (!confirm(`¿Restaurar la versión ${v.versionNumber}? El estado actual se guardará como respaldo automático.`)) return;
    try {
      await props.flush();
      const r = await api.restoreVersion(props.projectId, v.id);
      props.onRestored(r.project, r.revision);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog title="Versiones" size="md" open={props.open} onClose={props.onClose}>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="field" style={{ margin: 0 }}>
          <span>Nombre de la versión (opcional)</span>
          <input className="input" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} placeholder="Ej.: Revisión con el cliente" />
        </label>
        <button className="btn btn-primary" style={{ flex: "none" }} type="submit">
          Guardar versión
        </button>
      </form>
      {error && <div className="alert" role="alert">{error}</div>}
      <table className="simple" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>#</th><th>Tipo</th><th>Nombre</th><th>Fecha</th><th /></tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id}>
              <td>{v.versionNumber}</td>
              <td>{KIND[v.kind]}</td>
              <td>{v.label ?? "—"}</td>
              <td>{new Date(v.createdAt).toLocaleString("es")}</td>
              <td><button className="btn btn-sm" onClick={() => void restore(v)}>Restaurar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {versions.length === 0 && <p className="hint">No hay versiones guardadas.</p>}
    </Dialog>
  );
}
