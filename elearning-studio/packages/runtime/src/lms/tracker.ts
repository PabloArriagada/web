import type { LMSAdapter } from "./adapter.js";
import { formatScorm12Clock, formatScorm12Time, formatScorm2004Time, formatScorm2004Timestamp } from "./time.js";

export type InteractionType = "true-false" | "choice" | "fill-in" | "matching" | "sequencing" | "likert" | "numeric" | "other";

export type InteractionRecord = {
  id: string;
  type: InteractionType;
  /** Respuesta del alumno como lista de valores (se formatea según el estándar). */
  response: string[];
  correctResponse?: string[];
  result: "correct" | "incorrect" | "neutral" | "unanticipated";
  weighting?: number;
  latencyMs?: number;
  description?: string;
};

export type LaunchState = {
  entry: "resume" | "ab-initio" | "";
  location: string;
  suspendData: string;
  completed: boolean;
  lmsConnected: boolean;
};

/** Límites de suspend_data de cada estándar (caracteres). */
export const SUSPEND_LIMITS = { scorm12: 4096, scorm2004: 64000, local: 64000 } as const;

const sanitizeId = (id: string) => id.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 250);

/**
 * Traduce operaciones semánticas del curso a claves del data model de cada
 * estándar. Nunca lanza: si el LMS rechaza un valor se registra el error.
 */
export class Tracker {
  private readonly startedAt = Date.now();
  private terminated = false;
  private initialized = false;
  private completed = false;
  private interactionIndex = 0;
  readonly errors: string[] = [];

  constructor(readonly adapter: LMSAdapter) {}

  get standard() {
    return this.adapter.standard;
  }

  private get is12() {
    return this.adapter.standard === "scorm12";
  }

  private set(key: string, value: string): boolean {
    const ok = this.adapter.setValue(key, value);
    if (!ok) this.errors.push(`SetValue(${key}) → error ${this.adapter.getLastError()}`);
    return ok;
  }

  private get(key: string): string {
    return this.adapter.getValue(key) ?? "";
  }

  start(): LaunchState {
    this.initialized = this.adapter.initialize();
    if (!this.initialized) {
      this.errors.push(`Initialize → error ${this.adapter.getLastError()}`);
      return { entry: "", location: "", suspendData: "", completed: false, lmsConnected: false };
    }
    const status = this.is12 ? this.get("cmi.core.lesson_status") : this.get("cmi.completion_status");
    this.completed = this.is12 ? ["completed", "passed", "failed"].includes(status) : status === "completed";
    if (this.is12) {
      if (status === "not attempted" || status === "") this.set("cmi.core.lesson_status", "incomplete");
    } else if (status === "not attempted" || status === "unknown" || status === "") {
      this.set("cmi.completion_status", "incomplete");
    }
    const entry = (this.is12 ? this.get("cmi.core.entry") : this.get("cmi.entry")) as LaunchState["entry"];
    const state: LaunchState = {
      entry: entry === "resume" || entry === "ab-initio" ? entry : "",
      location: this.is12 ? this.get("cmi.core.lesson_location") : this.get("cmi.location"),
      suspendData: this.get("cmi.suspend_data"),
      completed: this.completed,
      lmsConnected: this.adapter.standard !== "local",
    };
    this.interactionIndex = Number(this.get("cmi.interactions._count")) || 0;
    return state;
  }

  get isCompleted() {
    return this.completed;
  }

  setLocation(location: string): void {
    this.set(this.is12 ? "cmi.core.lesson_location" : "cmi.location", location.slice(0, this.is12 ? 255 : 1000));
  }

  /** Devuelve false si excede el límite del estándar (no se envía). */
  setSuspendData(data: string): boolean {
    const limit = SUSPEND_LIMITS[this.adapter.standard];
    if (data.length > limit) {
      this.errors.push(`suspend_data excede ${limit} caracteres (${data.length})`);
      return false;
    }
    return this.set("cmi.suspend_data", data);
  }

  setProgress(fraction: number): void {
    if (this.is12) return; // SCORM 1.2 no tiene progress_measure
    this.set("cmi.progress_measure", Math.min(1, Math.max(0, fraction)).toFixed(4));
  }

  setCompleted(): void {
    if (this.completed) return;
    this.completed = true;
    if (this.is12) {
      const cur = this.get("cmi.core.lesson_status");
      // Nunca degradar passed/failed a completed.
      if (cur !== "passed" && cur !== "failed") this.set("cmi.core.lesson_status", "completed");
    } else {
      this.set("cmi.completion_status", "completed");
    }
  }

  /** Puntaje en escala 0..max. Se envía raw, min, max y (2004) scaled. */
  setScore(raw: number, min = 0, max = 100): void {
    const r = Math.round(raw * 100) / 100;
    if (this.is12) {
      this.set("cmi.core.score.raw", String(r));
      this.set("cmi.core.score.min", String(min));
      this.set("cmi.core.score.max", String(max));
    } else {
      this.set("cmi.score.raw", String(r));
      this.set("cmi.score.min", String(min));
      this.set("cmi.score.max", String(max));
      const scaled = max > min ? (r - min) / (max - min) : 0;
      this.set("cmi.score.scaled", Math.min(1, Math.max(-1, scaled)).toFixed(4));
    }
  }

  setSuccess(passed: boolean): void {
    if (this.is12) this.set("cmi.core.lesson_status", passed ? "passed" : "failed");
    else this.set("cmi.success_status", passed ? "passed" : "failed");
  }

  recordInteraction(rec: InteractionRecord): void {
    const n = this.interactionIndex++;
    const p = `cmi.interactions.${n}`;
    const fmt = (vals: string[]) => {
      if (rec.type === "true-false") {
        const v = vals[0] === "true" || vals[0] === "t";
        return this.is12 ? (v ? "t" : "f") : v ? "true" : "false";
      }
      return vals.join(this.is12 ? "," : "[,]");
    };
    this.set(`${p}.id`, sanitizeId(rec.id));
    this.set(`${p}.type`, rec.type === "other" && this.is12 ? "performance" : rec.type);
    if (rec.weighting !== undefined) this.set(`${p}.weighting`, String(rec.weighting));
    if (rec.correctResponse) this.set(`${p}.correct_responses.0.pattern`, fmt(rec.correctResponse));
    if (this.is12) {
      this.set(`${p}.time`, formatScorm12Clock(new Date()));
      this.set(`${p}.student_response`, fmt(rec.response));
      this.set(`${p}.result`, rec.result === "incorrect" ? "wrong" : rec.result);
      if (rec.latencyMs !== undefined) this.set(`${p}.latency`, formatScorm12Time(rec.latencyMs));
    } else {
      this.set(`${p}.timestamp`, formatScorm2004Timestamp(new Date()));
      this.set(`${p}.learner_response`, fmt(rec.response));
      this.set(`${p}.result`, rec.result);
      if (rec.latencyMs !== undefined) this.set(`${p}.latency`, formatScorm2004Time(rec.latencyMs));
      if (rec.description) this.set(`${p}.description`, rec.description.slice(0, 250));
    }
  }

  commit(): boolean {
    if (!this.initialized || this.terminated) return false;
    const ok = this.adapter.commit();
    if (!ok) this.errors.push(`Commit → error ${this.adapter.getLastError()}`);
    return ok;
  }

  /** Cierra la sesión: tiempo, modo de salida, commit y terminate. Idempotente. */
  finish(): void {
    if (!this.initialized || this.terminated) return;
    const elapsed = Date.now() - this.startedAt;
    if (this.is12) {
      this.set("cmi.core.session_time", formatScorm12Time(elapsed));
      // Siempre "suspend": conserva suspend_data para revisitar el curso
      // aunque esté completo (misma conducta en Moodle y LMS genéricos).
      this.set("cmi.core.exit", "suspend");
    } else {
      this.set("cmi.session_time", formatScorm2004Time(elapsed));
      this.set("cmi.exit", "suspend");
    }
    this.adapter.commit();
    this.terminated = true;
    this.adapter.terminate();
  }
}
