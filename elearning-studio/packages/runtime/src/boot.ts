/**
 * Punto de entrada del bundle `runtime/runtime.js` incluido en cada paquete.
 * Lee los datos del curso publicados en `course-data/course.js` y arranca el
 * Player con el adaptador LMS correspondiente.
 */
import type { RuntimeCourse } from "@studio/schema";
import { detectAdapter } from "./lms/adapter.js";
import { Player } from "./player.js";

declare global {
  interface Window {
    __STUDIO_COURSE__?: RuntimeCourse;
    __studioPlayer?: Player;
  }
}

function showFatal(container: HTMLElement, message: string): void {
  const box = document.createElement("div");
  box.className = "rt-fatal";
  box.setAttribute("role", "alert");
  box.textContent = message;
  container.replaceChildren(box);
}

function boot(): void {
  const container = document.getElementById("studio-course");
  if (!container) return;
  const course = window.__STUDIO_COURSE__;
  if (!course || !Array.isArray(course.modules)) {
    showFatal(container, "No se pudieron cargar los datos del curso (course-data/course.js).");
    return;
  }
  const adapter = detectAdapter(window, course.tracking.standard, course.id);
  // "#slide=<id>": el preview del editor puede abrir una pantalla concreta.
  const start = /[#&]slide=([a-z]{2,4}_[a-z0-9]{8,32})/.exec(location.hash)?.[1];
  const player = new Player({ container, course, adapter, ...(start ? { startSlideId: start } : {}) });
  window.__studioPlayer = player;
  player.start().catch((err: unknown) => {
    showFatal(container, `Error al iniciar el curso: ${err instanceof Error ? err.message : String(err)}`);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
