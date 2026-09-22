import { CourseProjectSchema, SCHEMA_VERSION, type CourseProject } from "./model.js";

/**
 * Migraciones del esquema del proyecto.
 *
 * Cada migración transforma un documento desde `from` hacia `to`. Se
 * aplican en cadena hasta llegar a SCHEMA_VERSION y luego el resultado se
 * valida con zod. Un proyecto de una versión FUTURA se rechaza para no
 * perder datos al guardarlo con un editor antiguo.
 */
export type SchemaMigration = {
  from: string;
  to: string;
  description: string;
  migrate: (doc: Record<string, unknown>) => Record<string, unknown>;
};

/**
 * Registro de migraciones. 1.0.0 es la primera versión publicada, por lo
 * que aún no hay migraciones reales; al introducir 1.1.0 se agrega aquí
 * `{ from: "1.0.0", to: "1.1.0", ... }` junto con su prueba.
 */
export const MIGRATIONS: SchemaMigration[] = [];

export class SchemaVersionError extends Error {
  constructor(
    message: string,
    readonly found: unknown,
  ) {
    super(message);
    this.name = "SchemaVersionError";
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function migrateDocument(
  raw: unknown,
  migrations: SchemaMigration[] = MIGRATIONS,
  target: string = SCHEMA_VERSION,
): { doc: Record<string, unknown>; applied: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SchemaVersionError("El proyecto no es un objeto JSON válido", raw);
  }
  let doc = structuredClone(raw) as Record<string, unknown>;
  const found = doc["schemaVersion"];
  if (typeof found !== "string" || !/^\d+\.\d+\.\d+$/.test(found)) {
    throw new SchemaVersionError("El proyecto no declara schemaVersion", found);
  }
  if (compareVersions(found, target) > 0) {
    throw new SchemaVersionError(
      `El proyecto usa el esquema ${found}, más nuevo que el soportado (${target}). Actualiza la plataforma.`,
      found,
    );
  }
  const applied: string[] = [];
  let current = found;
  while (current !== target) {
    const step = migrations.find((m) => m.from === current);
    if (!step) {
      throw new SchemaVersionError(`No existe migración desde el esquema ${current}`, current);
    }
    doc = step.migrate(doc);
    doc["schemaVersion"] = step.to;
    applied.push(`${step.from}→${step.to}`);
    current = step.to;
  }
  return { doc, applied };
}

/** Migra y valida. Lanza si el resultado no cumple el esquema actual. */
export function loadProject(raw: unknown): { project: CourseProject; applied: string[] } {
  const { doc, applied } = migrateDocument(raw);
  const project = CourseProjectSchema.parse(doc);
  return { project, applied };
}
