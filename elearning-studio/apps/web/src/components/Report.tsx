import type { ValidationIssue } from "@studio/schema";
import type { PipelineStep } from "../api/types.js";

const SEV = { error: "Error", warning: "Advertencia", info: "Info" } as const;

export function IssueList(props: { issues: ValidationIssue[]; onGo?: (i: ValidationIssue) => void }) {
  if (!props.issues.length) return <p className="alert info">Sin observaciones.</p>;
  const sorted = [...props.issues].sort((a, b) => ["error", "warning", "info"].indexOf(a.severity) - ["error", "warning", "info"].indexOf(b.severity));
  return (
    <ul className="issues">
      {sorted.map((i, k) => (
        <li key={k}>
          <span className={`badge ${i.severity}`}>{SEV[i.severity]}</span>
          <div>
            {props.onGo && i.slideId ? (
              <button onClick={() => props.onGo?.(i)}>{i.message}</button>
            ) : (
              <span>{i.message}</span>
            )}
            {i.location && <div className="loc">{i.location}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

const STEP_NAMES: Record<string, string> = {
  snapshot: "Snapshot",
  "validar-proyecto": "Validar proyecto",
  "recopilar-assets": "Recopilar assets",
  "copiar-assets": "Copiar assets",
  "reescribir-rutas": "Reescribir rutas",
  "construir-runtime": "Runtime",
  "construir-wrapper": "Wrapper SCORM",
  "generar-manifest": "Manifest",
  "validar-publicacion": "Validar publicación",
  "generar-zip": "ZIP",
  "verificar-zip": "Verificar ZIP",
};

export function StepList(props: { steps: PipelineStep[] }) {
  return (
    <ul className="steps" aria-label="Pasos del pipeline">
      {props.steps.map((s) => (
        <li key={s.name} className={s.ok ? "" : "fail"} title={s.detail}>
          {s.ok ? "✓" : "✗"} {STEP_NAMES[s.name] ?? s.name} · {s.ms} ms
        </li>
      ))}
    </ul>
  );
}
