/**
 * LMS simulado (SCORM 1.2 y 2004) para el preview, el SCORM Debugger y las
 * pruebas automáticas. Implementa el ciclo de vida, los códigos de error y
 * las validaciones de tipo/vocabulario de las claves que usa el runtime.
 *
 * NO sustituye la prueba en un LMS real (Moodle): solo permite detectar
 * regresiones de forma reproducible.
 */
import type { Scorm12Api, Scorm2004Api } from "./adapter.js";

export type MockStandard = "scorm12" | "scorm2004";

export type MockLogEntry = {
  seq: number;
  time: number;
  method: string;
  args: string[];
  result: string;
  errorCode: string;
};

type Access = "ro" | "rw" | "wo";
type KeyRule = { access: Access; validate?: (v: string) => boolean; initial?: string };

const isDecimal = (v: string) => /^-?\d+(\.\d+)?$/.test(v);
const inRange = (min: number, max: number) => (v: string) => isDecimal(v) && Number(v) >= min && Number(v) <= max;
const maxLen = (n: number) => (v: string) => v.length <= n;
const vocab = (...words: string[]) => (v: string) => words.includes(v);
const scoreRule = (v: string) => v === "" || isDecimal(v);

const RULES_12: Record<string, KeyRule> = {
  "cmi.core._children": { access: "ro", initial: "student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time" },
  "cmi.core.student_id": { access: "ro", initial: "mock-001" },
  "cmi.core.student_name": { access: "ro", initial: "Alumno, Prueba" },
  "cmi.core.lesson_location": { access: "rw", validate: maxLen(255), initial: "" },
  "cmi.core.credit": { access: "ro", initial: "credit" },
  "cmi.core.lesson_status": {
    access: "rw",
    validate: vocab("passed", "completed", "failed", "incomplete", "browsed"),
    initial: "not attempted",
  },
  "cmi.core.entry": { access: "ro", initial: "ab-initio" },
  "cmi.core.score._children": { access: "ro", initial: "raw,min,max" },
  "cmi.core.score.raw": { access: "rw", validate: scoreRule, initial: "" },
  "cmi.core.score.min": { access: "rw", validate: scoreRule, initial: "" },
  "cmi.core.score.max": { access: "rw", validate: scoreRule, initial: "" },
  "cmi.core.total_time": { access: "ro", initial: "0000:00:00.00" },
  "cmi.core.lesson_mode": { access: "ro", initial: "normal" },
  "cmi.core.exit": { access: "wo", validate: vocab("time-out", "suspend", "logout", "") },
  "cmi.core.session_time": { access: "wo", validate: (v) => /^\d{2,4}:\d{2}:\d{2}(\.\d{1,2})?$/.test(v) },
  "cmi.suspend_data": { access: "rw", validate: maxLen(4096), initial: "" },
  "cmi.launch_data": { access: "ro", initial: "" },
  "cmi.interactions._children": { access: "ro", initial: "id,objectives,time,type,correct_responses,weighting,student_response,result,latency" },
};

const RULES_2004: Record<string, KeyRule> = {
  "cmi._version": { access: "ro", initial: "1.0" },
  "cmi.learner_id": { access: "ro", initial: "mock-001" },
  "cmi.learner_name": { access: "ro", initial: "Alumno, Prueba" },
  "cmi.location": { access: "rw", validate: maxLen(1000), initial: "" },
  "cmi.credit": { access: "ro", initial: "credit" },
  "cmi.mode": { access: "ro", initial: "normal" },
  "cmi.entry": { access: "ro", initial: "ab-initio" },
  "cmi.completion_status": { access: "rw", validate: vocab("completed", "incomplete", "not attempted", "unknown"), initial: "unknown" },
  "cmi.success_status": { access: "rw", validate: vocab("passed", "failed", "unknown"), initial: "unknown" },
  "cmi.progress_measure": { access: "rw", validate: inRange(0, 1) },
  "cmi.completion_threshold": { access: "ro" },
  "cmi.score._children": { access: "ro", initial: "scaled,raw,min,max" },
  "cmi.score.scaled": { access: "rw", validate: inRange(-1, 1) },
  "cmi.score.raw": { access: "rw", validate: isDecimal },
  "cmi.score.min": { access: "rw", validate: isDecimal },
  "cmi.score.max": { access: "rw", validate: isDecimal },
  "cmi.suspend_data": { access: "rw", validate: maxLen(64000), initial: "" },
  "cmi.launch_data": { access: "ro", initial: "" },
  "cmi.exit": { access: "wo", validate: vocab("time-out", "suspend", "logout", "normal", "") },
  "cmi.session_time": { access: "wo", validate: (v) => /^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d{1,2})?S)?)?$/.test(v) && v !== "P" && !v.endsWith("T") },
  "cmi.total_time": { access: "ro", initial: "PT0S" },
  "cmi.interactions._children": { access: "ro", initial: "id,type,objectives,timestamp,correct_responses,weighting,learner_response,result,latency,description" },
};

const INTERACTION_FIELDS_12 = new Set(["id", "time", "type", "weighting", "student_response", "result", "latency"]);
const INTERACTION_FIELDS_2004 = new Set(["id", "type", "timestamp", "weighting", "learner_response", "result", "latency", "description"]);

const ERR_TEXT: Record<string, string> = {
  "0": "No error",
  "101": "General exception",
  "103": "Already initialized",
  "104": "Content instance terminated",
  "112": "Termination before initialization",
  "113": "Termination after termination",
  "122": "Retrieve data before initialization",
  "123": "Retrieve data after termination",
  "132": "Store data before initialization",
  "133": "Store data after termination",
  "142": "Commit before initialization",
  "143": "Commit after termination",
  "201": "Invalid argument",
  "301": "Not initialized",
  "351": "General set failure",
  "401": "Undefined data model element / not implemented",
  "403": "Element is read only / value not initialized",
  "404": "Element is write only / read only",
  "405": "Incorrect data type / write only",
  "406": "Data model element type mismatch",
  "408": "Data model dependency not established",
};

/** Estado persistente entre lanzamientos (simula la base de datos del LMS). */
export type MockLmsStore = { data: Record<string, string>; lastExit: string; launches: number };

export function createMockStore(): MockLmsStore {
  return { data: {}, lastExit: "", launches: 0 };
}

export type MockLms = {
  standard: MockStandard;
  api: Scorm12Api | Scorm2004Api;
  log: MockLogEntry[];
  /** Valores actuales (incluidos los no confirmados con Commit). */
  snapshot(): Record<string, string>;
  store: MockLmsStore;
  state(): "not-initialized" | "running" | "terminated";
  onChange(fn: () => void): void;
};

/**
 * Crea una instancia de API para UN lanzamiento. Para simular un nuevo
 * ingreso del alumno se llama otra vez con el mismo `store`.
 */
export function createMockLms(standard: MockStandard, store: MockLmsStore = createMockStore()): MockLms {
  const is12 = standard === "scorm12";
  const rules = is12 ? RULES_12 : RULES_2004;
  const log: MockLogEntry[] = [];
  const listeners: Array<() => void> = [];
  let seq = 0;
  let state: "not-initialized" | "running" | "terminated" = "not-initialized";
  let lastError = "0";

  // Nuevo intento si la sesión anterior no terminó en suspend.
  const resuming = store.lastExit === "suspend";
  const values: Record<string, string> = {};
  for (const [k, r] of Object.entries(rules)) if (r.initial !== undefined) values[k] = r.initial;
  if (resuming) Object.assign(values, store.data);
  values[is12 ? "cmi.core.entry" : "cmi.entry"] = resuming ? "resume" : "ab-initio";
  const interactionCount = () => Number(values["cmi.interactions._count"] ?? "0");
  if (values["cmi.interactions._count"] === undefined) values["cmi.interactions._count"] = "0";
  store.launches++;
  let exitValue = "";

  const record = (method: string, args: string[], result: string) => {
    log.push({ seq: ++seq, time: Date.now(), method, args, result, errorCode: lastError });
    for (const l of listeners) l();
    return result;
  };
  const fail = (code: string, ret: string) => {
    lastError = code;
    return ret;
  };

  const lifecycle = {
    initialize(): string {
      lastError = "0";
      if (state === "running") return fail(is12 ? "101" : "103", "false");
      if (state === "terminated") return fail(is12 ? "101" : "104", "false");
      state = "running";
      return "true";
    },
    terminate(): string {
      lastError = "0";
      if (state === "not-initialized") return fail(is12 ? "301" : "112", "false");
      if (state === "terminated") return fail(is12 ? "101" : "113", "false");
      persist();
      state = "terminated";
      return "true";
    },
    commit(): string {
      lastError = "0";
      if (state === "not-initialized") return fail(is12 ? "301" : "142", "false");
      if (state === "terminated") return fail(is12 ? "101" : "143", "false");
      persist();
      return "true";
    },
    get(key: string): string {
      lastError = "0";
      if (state === "not-initialized") return fail(is12 ? "301" : "122", "");
      if (state === "terminated") return fail(is12 ? "101" : "123", "");
      if (!key) return fail(is12 ? "201" : "301", "");
      const inter = /^cmi\.interactions\.(\d+)\.(.+)$/.exec(key);
      if (inter) {
        if (is12) return fail("404", ""); // en 1.2 las interacciones son de solo escritura
        const v = values[key];
        if (v === undefined) return fail("403", "");
        return v;
      }
      const rule = rules[key];
      if (!rule && key !== "cmi.interactions._count") return fail("401", "");
      if (rule?.access === "wo") return fail(is12 ? "404" : "405", "");
      const v = values[key];
      if (v === undefined) return fail(is12 ? "0" : "403", "");
      return v;
    },
    set(key: string, value: string): string {
      lastError = "0";
      if (state === "not-initialized") return fail(is12 ? "301" : "132", "false");
      if (state === "terminated") return fail(is12 ? "101" : "133", "false");
      const inter = /^cmi\.interactions\.(\d+)\.(.+)$/.exec(key);
      if (inter) {
        const n = Number(inter[1]);
        const field = inter[2]!;
        const count = interactionCount();
        if (n > count) return fail(is12 ? "201" : "351", "false");
        const allowed = is12 ? INTERACTION_FIELDS_12 : INTERACTION_FIELDS_2004;
        if (!allowed.has(field) && !/^correct_responses\.\d+\.pattern$/.test(field)) return fail("401", "false");
        if (field !== "id" && values[`cmi.interactions.${n}.id`] === undefined && !is12) return fail("408", "false");
        values[key] = value;
        if (n === count) values["cmi.interactions._count"] = String(count + 1);
        return "true";
      }
      const rule = rules[key];
      if (!rule) return fail(key.endsWith("._count") || key.endsWith("._children") ? (is12 ? "402" : "404") : "401", "false");
      if (rule.access === "ro") return fail(is12 ? "403" : "404", "false");
      if (rule.validate && !rule.validate(value)) return fail(is12 ? "405" : "406", "false");
      if (key === "cmi.core.exit" || key === "cmi.exit") exitValue = value;
      values[key] = value;
      return "true";
    },
  };

  function persist() {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      const r = rules[k];
      if (r?.access === "ro" && !k.endsWith("_count")) continue;
      out[k] = v;
    }
    store.data = out;
    store.lastExit = exitValue;
  }

  const errString = (code: string) => ERR_TEXT[code] ?? "Unknown error";
  let api: Scorm12Api | Scorm2004Api;
  if (is12) {
    const a: Scorm12Api = {
      LMSInitialize: (p) => record("LMSInitialize", [p], lifecycle.initialize()),
      LMSFinish: (p) => record("LMSFinish", [p], lifecycle.terminate()),
      LMSGetValue: (k) => record("LMSGetValue", [k], lifecycle.get(k)),
      LMSSetValue: (k, v) => record("LMSSetValue", [k, v], lifecycle.set(k, String(v))),
      LMSCommit: (p) => record("LMSCommit", [p], lifecycle.commit()),
      LMSGetLastError: () => lastError,
      LMSGetErrorString: errString,
      LMSGetDiagnostic: errString,
    };
    api = a;
  } else {
    const a: Scorm2004Api = {
      Initialize: (p) => record("Initialize", [p], lifecycle.initialize()),
      Terminate: (p) => record("Terminate", [p], lifecycle.terminate()),
      GetValue: (k) => record("GetValue", [k], lifecycle.get(k)),
      SetValue: (k, v) => record("SetValue", [k, v], lifecycle.set(k, String(v))),
      Commit: (p) => record("Commit", [p], lifecycle.commit()),
      GetLastError: () => lastError,
      GetErrorString: errString,
      GetDiagnostic: errString,
    };
    api = a;
  }

  return {
    standard,
    api,
    log,
    store,
    snapshot: () => ({ ...values }),
    state: () => state,
    onChange: (fn) => listeners.push(fn),
  };
}

/** Publica la API en una ventana con el nombre que espera cada estándar. */
export function installMockLms(win: Window, lms: MockLms): void {
  const w = win as unknown as Record<string, unknown>;
  delete w["API"];
  delete w["API_1484_11"];
  w[lms.standard === "scorm12" ? "API" : "API_1484_11"] = lms.api;
}
