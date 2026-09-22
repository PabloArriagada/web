import { useEffect, useState } from "react";
import type { ScormStandard, ValidationIssue } from "@studio/schema";
import { api } from "../api/endpoints.js";
import type { ValidateResponse } from "../api/types.js";
import { fmtBytes } from "./AssetLibrary.js";
import { Dialog } from "./Dialog.js";
import { IssueList, StepList } from "./Report.js";

/** Validador: ejecuta el pipeline completo (sin ZIP) sobre lo guardado. */
export function ValidateDialog(props: { projectId: string; open: boolean; onClose: () => void; flush: () => Promise<boolean>; onGo: (i: ValidationIssue) => void }) {
  const [standard, setStandard] = useState<ScormStandard>("scorm12");
  const [result, setResult] = useState<ValidateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (std: ScormStandard) => {
    setBusy(true);
    setError(null);
    try {
      if (!(await props.flush())) throw new Error("No se pudo guardar el proyecto antes de validar.");
      setResult(await api.validate(props.projectId, std));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (props.open) void run(standard);
     
  }, [props.open]);

  const c = result?.report.counts;
  return (
    <Dialog title="Validar curso" size="md" open={props.open} onClose={props.onClose}>
      <div className="row" style={{ alignItems: "center", marginBottom: 12 }}>
        <div className="toggle-group" role="group" aria-label="Estándar">
          {(["scorm12", "scorm2004"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={standard === s} onClick={() => { setStandard(s); void run(s); }}>
              {s === "scorm12" ? "SCORM 1.2" : "SCORM 2004"}
            </button>
          ))}
        </div>
        <button className="btn btn-sm" style={{ flex: "none" }} onClick={() => void run(standard)} disabled={busy}>
          Validar de nuevo
        </button>
      </div>
      {busy && <p role="status">Validando…</p>}
      {error && <div className="alert" role="alert">{error}</div>}
      {result && !busy && (
        <div aria-live="polite">
          <p>
            {result.ok ? <span className="badge ok">Listo para publicar</span> : <span className="badge error">Hay errores que bloquean la publicación</span>}{" "}
            {c && `${c.error} error(es) · ${c.warning} advertencia(s)`}
            {result.ok && ` · ${result.files} archivos · ${fmtBytes(result.totalBytes)}`}
          </p>
          <StepList steps={result.steps} />
          <div style={{ marginTop: 12 }}>
            <IssueList issues={result.report.issues} onGo={(i) => { props.onGo(i); props.onClose(); }} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
