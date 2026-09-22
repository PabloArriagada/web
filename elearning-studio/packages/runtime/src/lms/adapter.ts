/**
 * Adaptadores LMS. Cada uno habla el dialecto exacto de su estándar
 * (nombres de claves incluidos). La traducción semántica vive en Tracker.
 */
export interface LMSAdapter {
  readonly standard: "scorm12" | "scorm2004" | "local";
  initialize(): boolean;
  getValue(key: string): string;
  setValue(key: string, value: string): boolean;
  commit(): boolean;
  terminate(): boolean;
  getLastError(): string;
}

export type ApiCallLogger = (entry: { method: string; args: string[]; result: string; error: string }) => void;

/** API SCORM 1.2 tal como la expone el LMS en `window.API`. */
export type Scorm12Api = {
  LMSInitialize(p: ""): string | boolean;
  LMSFinish(p: ""): string | boolean;
  LMSGetValue(k: string): string;
  LMSSetValue(k: string, v: string): string | boolean;
  LMSCommit(p: ""): string | boolean;
  LMSGetLastError(): string | number;
  LMSGetErrorString(code: string): string;
  LMSGetDiagnostic(code: string): string;
};

/** API SCORM 2004 tal como la expone el LMS en `window.API_1484_11`. */
export type Scorm2004Api = {
  Initialize(p: ""): string | boolean;
  Terminate(p: ""): string | boolean;
  GetValue(k: string): string;
  SetValue(k: string, v: string): string | boolean;
  Commit(p: ""): string | boolean;
  GetLastError(): string | number;
  GetErrorString(code: string): string;
  GetDiagnostic(code: string): string;
};

const truthy = (r: unknown) => r === true || r === "true";

/**
 * Algoritmo estándar de búsqueda de la API: recorre la cadena de
 * `parent` (máx. 500 niveles) y luego la de `opener`. Accesos cross-origin
 * lanzan excepción y se tratan como "no encontrada".
 */
export function findApi<T>(start: Window, name: "API" | "API_1484_11"): T | null {
  const scan = (w: Window | null): T | null => {
    let win = w;
    let tries = 0;
    while (win && tries < 500) {
      try {
        const api = (win as unknown as Record<string, unknown>)[name];
        if (api) return api as T;
      } catch {
        return null;
      }
      if (!win.parent || win.parent === win) break;
      win = win.parent;
      tries++;
    }
    return null;
  };
  let found = scan(start);
  if (!found) {
    try {
      if (start.opener) found = scan(start.opener as Window);
    } catch {
      found = null;
    }
  }
  return found;
}

export class Scorm12Adapter implements LMSAdapter {
  readonly standard = "scorm12" as const;
  constructor(
    private readonly api: Scorm12Api,
    private readonly log?: ApiCallLogger,
  ) {}
  private call(method: string, args: string[], fn: () => unknown): string {
    const r = fn();
    const result = String(r);
    this.log?.({ method, args, result, error: this.getLastError() });
    return result;
  }
  initialize() {
    return truthy(this.call("LMSInitialize", [""], () => this.api.LMSInitialize("")));
  }
  getValue(key: string) {
    return this.call("LMSGetValue", [key], () => this.api.LMSGetValue(key) ?? "");
  }
  setValue(key: string, value: string) {
    return truthy(this.call("LMSSetValue", [key, value], () => this.api.LMSSetValue(key, value)));
  }
  commit() {
    return truthy(this.call("LMSCommit", [""], () => this.api.LMSCommit("")));
  }
  terminate() {
    return truthy(this.call("LMSFinish", [""], () => this.api.LMSFinish("")));
  }
  getLastError() {
    return String(this.api.LMSGetLastError());
  }
}

export class Scorm2004Adapter implements LMSAdapter {
  readonly standard = "scorm2004" as const;
  constructor(
    private readonly api: Scorm2004Api,
    private readonly log?: ApiCallLogger,
  ) {}
  private call(method: string, args: string[], fn: () => unknown): string {
    const r = fn();
    const result = String(r);
    this.log?.({ method, args, result, error: this.getLastError() });
    return result;
  }
  initialize() {
    return truthy(this.call("Initialize", [""], () => this.api.Initialize("")));
  }
  getValue(key: string) {
    return this.call("GetValue", [key], () => this.api.GetValue(key) ?? "");
  }
  setValue(key: string, value: string) {
    return truthy(this.call("SetValue", [key, value], () => this.api.SetValue(key, value)));
  }
  commit() {
    return truthy(this.call("Commit", [""], () => this.api.Commit("")));
  }
  terminate() {
    return truthy(this.call("Terminate", [""], () => this.api.Terminate("")));
  }
  getLastError() {
    return String(this.api.GetLastError());
  }
}

/**
 * Sin LMS (publicación web o archivo abierto directamente): guarda el
 * progreso en localStorage con claves estilo SCORM 2004. Si el
 * almacenamiento no está disponible, trabaja solo en memoria.
 */
export class LocalAdapter implements LMSAdapter {
  readonly standard = "local" as const;
  private data: Record<string, string> = {};
  constructor(private readonly storageKey: string) {}
  initialize() {
    try {
      const raw = globalThis.localStorage?.getItem(this.storageKey);
      if (raw) this.data = JSON.parse(raw) as Record<string, string>;
    } catch {
      this.data = {};
    }
    return true;
  }
  getValue(key: string) {
    return this.data[key] ?? "";
  }
  setValue(key: string, value: string) {
    this.data[key] = value;
    return true;
  }
  commit() {
    try {
      globalThis.localStorage?.setItem(this.storageKey, JSON.stringify(this.data));
    } catch {
      /* almacenamiento no disponible: se conserva en memoria */
    }
    return true;
  }
  terminate() {
    return this.commit();
  }
  getLastError() {
    return "0";
  }
}

/** Detecta el LMS según el estándar con el que se publicó el paquete. */
export function detectAdapter(
  win: Window,
  preferred: "scorm12" | "scorm2004" | "none",
  courseId: string,
  log?: ApiCallLogger,
): LMSAdapter {
  if (preferred === "scorm2004") {
    const api = findApi<Scorm2004Api>(win, "API_1484_11");
    if (api) return new Scorm2004Adapter(api, log);
  }
  if (preferred === "scorm12") {
    const api = findApi<Scorm12Api>(win, "API");
    if (api) return new Scorm12Adapter(api, log);
  }
  return new LocalAdapter(`studio-progress:${courseId}`);
}
