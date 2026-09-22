import { useCallback, useEffect, useRef, useState } from "react";
import type { CourseProject } from "@studio/schema";
import { ApiError } from "../api/client.js";
import { api } from "../api/endpoints.js";
import { clearDraft, readDraft, writeDraft, type LocalDraft } from "./draft.js";

export type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

const AUTOSAVE_MS = 1200;

/**
 * Estado del proyecto abierto: carga, cambios, autosave con debounce,
 * guardado explícito, detección de conflictos (409) y copia local.
 */
export function useProjectEditor(projectId: string) {
  const [project, setProject] = useState<CourseProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [recoverable, setRecoverable] = useState<LocalDraft | null>(null);

  const projectRef = useRef<CourseProject | null>(null);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<number | null>(null);
  const conflictRef = useRef(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await api.getProject(projectId);
      projectRef.current = r.project;
      revisionRef.current = r.revision;
      dirtyRef.current = false;
      conflictRef.current = false;
      setProject(r.project);
      setSaveState("saved");
      setSaveMessage(null);
      const draft = readDraft(projectId);
      if (draft && draft.baseRevision === r.revision && JSON.stringify(draft.project.modules) !== JSON.stringify(r.project.modules)) {
        setRecoverable(draft);
      } else if (draft) {
        clearDraft(projectId);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const doSave = useCallback((): Promise<void> => {
    const run = async () => {
      const snapshot = projectRef.current;
      if (!snapshot || conflictRef.current) return;
      setSaveState("saving");
      try {
        const r = await api.saveProject(snapshot, revisionRef.current);
        revisionRef.current = r.revision;
        setSavedAt(new Date(r.updatedAt));
        setSaveMessage(null);
        if (projectRef.current === snapshot) {
          dirtyRef.current = false;
          clearDraft(snapshot.id);
          setSaveState("saved");
        } else {
          // Hubo cambios durante el guardado: se guardan en la siguiente vuelta.
          setSaveState("dirty");
          schedule();
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          conflictRef.current = true;
          setSaveState("conflict");
          setSaveMessage(e.message);
        } else {
          setSaveState("error");
          setSaveMessage(e instanceof Error ? e.message : String(e));
        }
      }
    };
    const p = (savingRef.current ?? Promise.resolve()).then(run);
    savingRef.current = p.finally(() => {
      if (savingRef.current === p) savingRef.current = null;
    });
    return p;
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void doSave();
    }, AUTOSAVE_MS);
  }, [doSave]);

  /** Aplica un cambio inmutable y programa el autosave. */
  const update = useCallback(
    (fn: (p: CourseProject) => CourseProject) => {
      const cur = projectRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      projectRef.current = next;
      dirtyRef.current = true;
      setProject(next);
      if (!conflictRef.current) setSaveState("dirty");
      writeDraft(next, revisionRef.current);
      schedule();
    },
    [schedule],
  );

  /** Guarda de inmediato (Guardar, Ctrl+S, antes de preview/publicar). */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (savingRef.current) await savingRef.current;
    if (dirtyRef.current) await doSave();
    return !dirtyRef.current && !conflictRef.current;
  }, [doSave]);

  /** Reemplaza el proyecto (restauración de versión o recarga tras conflicto). */
  const replace = useCallback((p: CourseProject, revision: number) => {
    projectRef.current = p;
    revisionRef.current = revision;
    dirtyRef.current = false;
    conflictRef.current = false;
    clearDraft(p.id);
    setProject(p);
    setSaveState("saved");
    setSaveMessage(null);
  }, []);

  const recoverDraft = useCallback(() => {
    if (!recoverable) return;
    setRecoverable(null);
    update(() => recoverable.project);
  }, [recoverable, update]);

  const discardDraft = useCallback(() => {
    clearDraft(projectId);
    setRecoverable(null);
  }, [projectId]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || savingRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  return { project, loadError, saveState, saveMessage, savedAt, update, flush, reload: load, replace, recoverable, recoverDraft, discardDraft, revision: () => revisionRef.current };
}
