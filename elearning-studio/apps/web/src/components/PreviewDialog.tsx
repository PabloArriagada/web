import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ScormStandard } from "@studio/schema";
import { createMockLms, createMockStore, installMockLms, type MockLms, type MockLmsStore } from "@studio/runtime/mock-lms";
import { api } from "../api/endpoints.js";
import type { PreviewResponse } from "../api/types.js";
import { Dialog } from "./Dialog.js";
import { IssueList, StepList } from "./Report.js";

const KEYS: Record<ScormStandard, Array<[string, string]>> = {
  scorm12: [
    ["Estado", "cmi.core.lesson_status"],
    ["Entrada", "cmi.core.entry"],
    ["Ubicación", "cmi.core.lesson_location"],
    ["Puntaje", "cmi.core.score.raw"],
    ["Salida", "cmi.core.exit"],
    ["Tiempo sesión", "cmi.core.session_time"],
    ["Suspend data", "cmi.suspend_data"],
    ["Interacciones", "cmi.interactions._count"],
  ],
  scorm2004: [
    ["Completitud", "cmi.completion_status"],
    ["Aprobación", "cmi.success_status"],
    ["Entrada", "cmi.entry"],
    ["Ubicación", "cmi.location"],
    ["Progreso", "cmi.progress_measure"],
    ["Puntaje raw", "cmi.score.raw"],
    ["Puntaje scaled", "cmi.score.scaled"],
    ["Salida", "cmi.exit"],
    ["Tiempo sesión", "cmi.session_time"],
    ["Suspend data", "cmi.suspend_data"],
    ["Interacciones", "cmi.interactions._count"],
  ],
};

/**
 * Preview de publicación: el iframe carga el paquete compilado por el mismo
 * pipeline que genera el ZIP, conectado a un LMS simulado (SCORM Debugger).
 */
export function PreviewDialog(props: { projectId: string; open: boolean; onClose: () => void; flush: () => Promise<boolean>; startSlideId?: string | null; expert: boolean }) {
  const [standard, setStandard] = useState<ScormStandard>("scorm12");
  const [build, setBuild] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [launch, setLaunch] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(props.expert);
  const storeRef = useRef<MockLmsStore>(createMockStore());
  const lmsRef = useRef<MockLms | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const connect = (url: string, std: ScormStandard) => {
    const lms = createMockLms(std, storeRef.current);
    let pending = false;
    lms.onChange(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        bump();
      });
    });
    lmsRef.current = lms;
    installMockLms(window, lms);
    setLaunch(url);
  };

  const generate = async (std: ScormStandard, fromSlide: boolean) => {
    setLoading(true);
    setError(null);
    setLaunch(null);
    try {
      if (!(await props.flush())) throw new Error("No se pudo guardar el proyecto antes de previsualizar.");
      storeRef.current = createMockStore();
      const b = await api.preview(props.projectId, std);
      setBuild(b);
      if (b.ok && b.launchUrl) connect(b.launchUrl + (fromSlide && props.startSlideId ? `#slide=${props.startSlideId}` : ""), std);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (props.open) void generate(standard, true);
    return () => {
      const w = window as unknown as Record<string, unknown>;
      delete w["API"];
      delete w["API_1484_11"];
      lmsRef.current = null;
    };
     
  }, [props.open]);

  /** Simula que el alumno cierra y vuelve a entrar (misma "base de datos" del LMS). */
  const relaunch = () => {
    const url = launch?.split("#")[0];
    if (!url || !build) return;
    setLaunch(null);
    // El desmontaje del iframe dispara pagehide → el runtime hace Terminate.
    setTimeout(() => connect(url, build.standard), 50);
  };

  const lms = lmsRef.current;
  const snapshot = lms ? lms.snapshot() : {};
  const errors = useMemo(() => (lms ? lms.log.filter((l) => l.errorCode !== "0") : []), [lms, lms?.log.length]);
  const interactions = Object.entries(snapshot).filter(([k]) => /^cmi\.interactions\.\d+\./.test(k));

  return (
    <Dialog title="Vista previa del paquete" open={props.open} onClose={props.onClose}>
      <div className="row" style={{ alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div className="toggle-group" role="group" aria-label="Estándar">
          {(["scorm12", "scorm2004"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={standard === s}
              onClick={() => {
                setStandard(s);
                void generate(s, false);
              }}
            >
              {s === "scorm12" ? "SCORM 1.2" : "SCORM 2004"}
            </button>
          ))}
        </div>
        <div className="btn-group" style={{ flex: "none" }}>
          <button className="btn btn-sm" onClick={() => void generate(standard, false)} disabled={loading}>
            Reiniciar desde el inicio
          </button>
          <button className="btn btn-sm" onClick={relaunch} disabled={!launch} title="Cierra la sesión LMS y vuelve a abrir el curso para probar la reanudación">
            Cerrar y volver a entrar
          </button>
          <button className="btn btn-sm" aria-pressed={showDebug} onClick={() => setShowDebug((v) => !v)}>
            {showDebug ? "Ocultar" : "Mostrar"} SCORM Debugger
          </button>
        </div>
      </div>
      {loading && <p role="status">Compilando paquete…</p>}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {build && !build.ok && (
        <>
          <div className="alert" role="alert">
            El paquete tiene errores y no se puede previsualizar. Corrígelos y vuelve a intentar.
          </div>
          <IssueList issues={build.report.issues} />
        </>
      )}
      {build?.ok && (
        <div className={`preview-layout ${showDebug ? "with-debug" : ""}`}>
          {launch ? <iframe key={launch} className="preview-frame" title="Vista previa del curso" src={launch} /> : <div className="preview-frame" />}
          {showDebug && lms && (
            <aside className="debugger" aria-label="SCORM Debugger">
              <h3>
                Sesión LMS simulada · {build.standard === "scorm12" ? "SCORM 1.2" : "SCORM 2004"} · {lms.state()}
              </h3>
              <dl className="kv">
                {KEYS[build.standard].map(([label, key]) => (
                  <div key={key} style={{ display: "contents" }}>
                    <dt>{label}</dt>
                    <dd title={key}>{snapshot[key] ?? "—"}</dd>
                  </div>
                ))}
              </dl>
              {interactions.length > 0 && (
                <>
                  <h3>Interacciones</h3>
                  <dl className="kv">
                    {interactions.map(([k, v]) => (
                      <div key={k} style={{ display: "contents" }}>
                        <dt>{k.replace("cmi.interactions.", "")}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
              <h3>Errores ({errors.length})</h3>
              <ul className="log" style={{ flex: "none", maxHeight: 90 }}>
                {errors.map((l) => (
                  <li key={l.seq} className="err">
                    <span className="m">{l.method}</span>({l.args.join(", ")}) → error {l.errorCode}
                  </li>
                ))}
              </ul>
              <h3>Llamadas ({lms.log.length})</h3>
              <ul className="log">
                {lms.log.slice(-300).reverse().map((l) => (
                  <li key={l.seq} className={l.errorCode !== "0" ? "err" : ""}>
                    <span className="m">{l.method}</span>({l.args.map((a) => (a.length > 60 ? a.slice(0, 60) + "…" : a)).join(", ")}) → {l.result === "" ? '""' : l.result}
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      )}
      {build?.ok && props.expert && (
        <details style={{ marginTop: 12 }}>
          <summary>Pipeline y archivos del paquete ({build.files.length})</summary>
          <StepList steps={build.steps} />
          <IssueList issues={build.report.issues} />
        </details>
      )}
    </Dialog>
  );
}
