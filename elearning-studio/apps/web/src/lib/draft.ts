import type { CourseProject } from "@studio/schema";

/**
 * Copia local de cambios no guardados (recuperación ante cierre o caída de
 * red). Solo es una red de seguridad: la fuente de verdad es el servidor.
 */
export type LocalDraft = { baseRevision: number; savedAt: string; project: CourseProject };

const key = (id: string) => `studio-draft:${id}`;

export function writeDraft(project: CourseProject, baseRevision: number): void {
  try {
    const d: LocalDraft = { baseRevision, savedAt: new Date().toISOString(), project };
    localStorage.setItem(key(project.id), JSON.stringify(d));
  } catch {
    /* cuota excedida o almacenamiento bloqueado: se omite la copia local */
  }
}

export function readDraft(id: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(key(id));
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch {
    return null;
  }
}

export function clearDraft(id: string): void {
  try {
    localStorage.removeItem(key(id));
  } catch {
    /* sin acceso a almacenamiento */
  }
}
