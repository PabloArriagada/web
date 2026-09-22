/**
 * Player: navegación, reanudación, progreso y seguimiento LMS.
 * Lo usan el preview del editor y el paquete SCORM publicado.
 */
import type { NavigationAction, RuntimeCourse, Slide } from "@studio/schema";
import type { LMSAdapter } from "./lms/adapter.js";
import { Tracker, type LaunchState } from "./lms/tracker.js";
import { renderSlide } from "./render.js";

export type FlatSlide = { slide: Slide; moduleId: string; moduleTitle: string; index: number };

export type PlayerOptions = {
  container: HTMLElement;
  course: RuntimeCourse;
  adapter: LMSAdapter;
  /** En el paquete las rutas ya son relativas: identidad por defecto. */
  resolveAsset?: (src: string) => string;
  /** Pantalla inicial forzada (preview "desde esta pantalla"). */
  startSlideId?: string;
  onSlideChange?: (slide: FlatSlide) => void;
};

/** Formato de suspend_data: compacto para respetar 4096 caracteres en 1.2. */
export type SuspendState = { v: 1; n: number; seen: string };

export function encodeVisited(visited: boolean[]): string {
  // Bits agrupados de a 4 en hex: 100 pantallas = 25 caracteres.
  let out = "";
  for (let i = 0; i < visited.length; i += 4) {
    let nib = 0;
    for (let b = 0; b < 4; b++) if (visited[i + b]) nib |= 1 << b;
    out += nib.toString(16);
  }
  return out;
}

export function decodeVisited(hex: string, n: number): boolean[] {
  const out = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const nib = parseInt(hex[Math.floor(i / 4)] ?? "0", 16);
    out[i] = Number.isFinite(nib) && (nib & (1 << i % 4)) !== 0;
  }
  return out;
}

export function flattenSlides(course: RuntimeCourse): FlatSlide[] {
  const out: FlatSlide[] = [];
  const mods = [...course.modules].sort((a, b) => a.order - b.order);
  for (const m of mods) for (const s of m.slides) out.push({ slide: s, moduleId: m.id, moduleTitle: m.title, index: out.length });
  return out;
}

export class Player {
  readonly slides: FlatSlide[];
  readonly tracker: Tracker;
  private visited: boolean[];
  private current = -1;
  private launch: LaunchState | null = null;
  private readonly root: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly stageHost: HTMLElement;
  private readonly live: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly counter: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly progressBar: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly menuBtn: HTMLButtonElement;
  private readonly slideTitle: HTMLElement;
  private stage: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onUnload = () => this.destroy();
  private readonly doc: Document;

  constructor(private readonly opts: PlayerOptions) {
    this.doc = opts.container.ownerDocument;
    this.slides = flattenSlides(opts.course);
    this.visited = new Array<boolean>(this.slides.length).fill(false);
    this.tracker = new Tracker(opts.adapter);

    const d = this.doc;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}) => {
      const n = d.createElement(tag);
      n.className = cls;
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      return n;
    };
    const { course } = opts;
    this.root = el("div", "rt-player", { lang: course.locale });
    this.root.style.setProperty("--rt-primary", course.theme.colors.primary);
    this.root.style.setProperty("--rt-primary-dark", course.theme.colors.primaryDark);
    this.root.style.setProperty("--rt-accent", course.theme.colors.accent);
    this.root.style.setProperty("--rt-danger", course.theme.colors.danger);
    this.root.style.setProperty("--rt-font", `"${course.theme.fonts.body.replace(/"/g, "")}", system-ui, sans-serif`);

    const header = el("header", "rt-header");
    this.menuBtn = el("button", "rt-btn rt-menu-btn", { type: "button", "aria-expanded": "false", "aria-controls": "rt-menu" });
    this.menuBtn.textContent = "☰";
    this.menuBtn.setAttribute("aria-label", "Contenido del curso");
    this.menuBtn.hidden = !course.player.showMenu;
    const titles = el("div", "rt-titles");
    const h1 = el("h1", "rt-course-title");
    h1.textContent = course.title;
    this.slideTitle = el("p", "rt-slide-title");
    titles.append(h1, this.slideTitle);
    this.counter = el("p", "rt-counter", { "aria-hidden": "true" });
    header.append(this.menuBtn, titles, this.counter);

    this.menu = el("nav", "rt-menu", { id: "rt-menu", "aria-label": "Contenido del curso" });
    this.menu.hidden = true;

    this.viewport = el("main", "rt-viewport");
    this.stageHost = el("div", "rt-stage-host", { tabindex: "-1" });
    this.viewport.append(this.stageHost);

    const footer = el("footer", "rt-footer");
    this.prevBtn = el("button", "rt-btn rt-prev", { type: "button" });
    this.prevBtn.textContent = "‹ Anterior";
    this.nextBtn = el("button", "rt-btn rt-next", { type: "button" });
    this.nextBtn.textContent = "Siguiente ›";
    this.progress = el("div", "rt-progress", { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": "Progreso del curso" });
    this.progressBar = el("div", "rt-progress-bar");
    this.progress.append(this.progressBar);
    this.progress.hidden = !course.player.showProgress;
    footer.append(this.prevBtn, this.progress, this.nextBtn);
    footer.hidden = !course.player.showNavigation;

    this.live = el("div", "rt-sr-only", { "aria-live": "polite", role: "status" });

    this.root.append(header, this.menu, this.viewport, footer, this.live);

    this.prevBtn.addEventListener("click", () => this.navigate({ type: "previous" }));
    this.nextBtn.addEventListener("click", () => this.navigate({ type: "next" }));
    this.menuBtn.addEventListener("click", () => this.toggleMenu());
    this.menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.toggleMenu(false);
    });
  }

  /** Inicia la sesión LMS y muestra la primera pantalla (o pregunta si reanudar). */
  async start(): Promise<void> {
    this.opts.container.replaceChildren(this.root);
    this.launch = this.tracker.start();
    const win = this.doc.defaultView;
    win?.addEventListener("pagehide", this.onUnload);
    win?.addEventListener("beforeunload", this.onUnload);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(this.viewport);
    } else win?.addEventListener("resize", () => this.fit());

    const saved = this.readSaved();
    if (this.opts.startSlideId) {
      const idx = this.slides.findIndex((s) => s.slide.id === this.opts.startSlideId);
      this.goTo(Math.max(0, idx));
      return;
    }
    if (saved && saved.index > 0 && this.opts.course.player.resume !== "never") {
      this.visited = saved.visited;
      if (this.opts.course.player.resume === "always") {
        this.goTo(saved.index);
        return;
      }
      const choice = await this.askResume();
      if (choice === "resume") {
        this.goTo(saved.index);
        return;
      }
      this.visited = new Array<boolean>(this.slides.length).fill(false);
    } else if (saved) {
      this.visited = saved.visited;
    }
    this.goTo(0);
  }

  private readSaved(): { index: number; visited: boolean[] } | null {
    const l = this.launch;
    if (!l || (!l.location && !l.suspendData)) return null;
    let visited = new Array<boolean>(this.slides.length).fill(false);
    try {
      const s = JSON.parse(l.suspendData) as SuspendState;
      if (s && s.v === 1 && s.n === this.slides.length && typeof s.seen === "string") visited = decodeVisited(s.seen, s.n);
    } catch {
      /* suspend_data ausente o de otra versión del curso */
    }
    const index = this.slides.findIndex((s) => s.slide.id === l.location);
    return { index: Math.max(0, index), visited };
  }

  private askResume(): Promise<"resume" | "restart"> {
    return new Promise((resolve) => {
      const d = this.doc;
      const overlay = d.createElement("div");
      overlay.className = "rt-dialog-backdrop";
      const dialog = d.createElement("div");
      dialog.className = "rt-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "rt-resume-title");
      const h = d.createElement("h2");
      h.id = "rt-resume-title";
      h.textContent = "Encontramos progreso anterior";
      const p = d.createElement("p");
      p.textContent = "¿Quieres continuar donde quedaste o comenzar nuevamente?";
      const actions = d.createElement("div");
      actions.className = "rt-dialog-actions";
      const cont = d.createElement("button");
      cont.type = "button";
      cont.className = "rt-btn rt-btn-primary";
      cont.textContent = "Continuar donde quedé";
      const restart = d.createElement("button");
      restart.type = "button";
      restart.className = "rt-btn";
      restart.textContent = "Comenzar nuevamente";
      actions.append(cont, restart);
      dialog.append(h, p, actions);
      overlay.append(dialog);
      this.root.append(overlay);
      const done = (v: "resume" | "restart") => {
        overlay.remove();
        resolve(v);
      };
      cont.addEventListener("click", () => done("resume"));
      restart.addEventListener("click", () => done("restart"));
      dialog.addEventListener("keydown", (e) => {
        if (e.key !== "Tab") return;
        // Trampa de foco entre los dos botones.
        const first = cont;
        const last = restart;
        if (e.shiftKey && d.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && d.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      });
      cont.focus();
    });
  }

  get currentIndex() {
    return this.current;
  }

  get visitedCount() {
    return this.visited.filter(Boolean).length;
  }

  canVisit(index: number): boolean {
    if (index < 0 || index >= this.slides.length) return false;
    if (this.opts.course.player.navigation === "free") return true;
    return index <= this.current + 1 || this.visited[index] === true || this.visited[index - 1] === true;
  }

  navigate(action: NavigationAction): void {
    switch (action.type) {
      case "next":
        if (this.current < this.slides.length - 1) this.goTo(this.current + 1);
        break;
      case "previous":
        if (this.current > 0) this.goTo(this.current - 1);
        break;
      case "goto-slide": {
        const idx = this.slides.findIndex((s) => s.slide.id === action.slideId);
        if (idx >= 0 && this.canVisit(idx)) this.goTo(idx);
        break;
      }
      case "none":
        break;
    }
  }

  goTo(index: number): void {
    const target = this.slides[index];
    if (!target) return;
    this.current = index;
    this.visited[index] = true;
    const resolve = this.opts.resolveAsset ?? ((s: string) => s);
    this.stage = renderSlide(target.slide, {
      mode: "player",
      theme: this.opts.course.theme,
      resolveAsset: resolve,
      onNavigate: (a) => this.navigate(a),
      document: this.doc,
    });
    this.stageHost.replaceChildren(this.stage);
    this.stageHost.setAttribute("aria-label", target.slide.title);
    this.fit();
    this.updateChrome();
    this.persist();
    this.live.textContent = `Pantalla ${index + 1} de ${this.slides.length}: ${target.slide.title}`;
    this.stageHost.focus({ preventScroll: true });
    this.opts.onSlideChange?.(target);
  }

  private persist(): void {
    const t = this.tracker;
    const target = this.slides[this.current];
    if (!target) return;
    t.setLocation(target.slide.id);
    const state: SuspendState = { v: 1, n: this.slides.length, seen: encodeVisited(this.visited) };
    t.setSuspendData(JSON.stringify(state));
    const fraction = this.slides.length ? this.visitedCount / this.slides.length : 1;
    t.setProgress(fraction);
    const rule = this.opts.course.tracking.completion;
    const needed = rule.rule === "all-slides" ? 1 : rule.percent / 100;
    if (fraction >= needed - 1e-9) t.setCompleted();
    t.commit();
  }

  private updateChrome(): void {
    const n = this.slides.length;
    const i = this.current;
    const cur = this.slides[i];
    this.prevBtn.disabled = i <= 0;
    this.nextBtn.disabled = i >= n - 1;
    this.counter.textContent = `${i + 1} / ${n}`;
    this.slideTitle.textContent = cur ? `${cur.moduleTitle} · ${cur.slide.title}` : "";
    const pct = n ? Math.round((this.visitedCount / n) * 100) : 0;
    this.progressBar.style.width = `${pct}%`;
    this.progress.setAttribute("aria-valuenow", String(pct));
    this.progress.setAttribute("aria-valuetext", `${pct}% completado`);
    this.renderMenu();
  }

  private renderMenu(): void {
    const d = this.doc;
    const list = d.createElement("ol");
    list.className = "rt-menu-list";
    let lastModule = "";
    let sub: HTMLOListElement | null = null;
    for (const fs of this.slides) {
      if (fs.moduleId !== lastModule) {
        lastModule = fs.moduleId;
        const li = d.createElement("li");
        const t = d.createElement("span");
        t.className = "rt-menu-module";
        t.textContent = fs.moduleTitle;
        sub = d.createElement("ol");
        li.append(t, sub);
        list.append(li);
      }
      const item = d.createElement("li");
      const b = d.createElement("button");
      b.type = "button";
      b.className = "rt-menu-item";
      b.textContent = fs.slide.title;
      if (fs.index === this.current) b.setAttribute("aria-current", "page");
      if (this.visited[fs.index]) b.classList.add("rt-visited");
      b.disabled = !this.canVisit(fs.index);
      b.addEventListener("click", () => {
        this.toggleMenu(false);
        this.goTo(fs.index);
      });
      item.append(b);
      sub?.append(item);
    }
    this.menu.replaceChildren(list);
  }

  private toggleMenu(force?: boolean): void {
    const open = force ?? this.menu.hidden;
    this.menu.hidden = !open;
    this.menuBtn.setAttribute("aria-expanded", String(open));
    if (open) (this.menu.querySelector("[aria-current]") as HTMLElement | null)?.focus();
    else if (force === false) this.menuBtn.focus();
  }

  /** Escala el escenario para que quepa en el viewport sin deformarse. */
  private fit(): void {
    if (!this.stage) return;
    const { width: sw, height: sh } = this.opts.course.stage;
    const vw = this.viewport.clientWidth || sw;
    const vh = this.viewport.clientHeight || sh;
    const scale = Math.min(vw / sw, vh / sh);
    this.stageHost.style.width = `${sw * scale}px`;
    this.stageHost.style.height = `${sh * scale}px`;
    this.stage.style.transform = `scale(${scale})`;
    this.stage.style.transformOrigin = "0 0";
  }

  /** Cierra la sesión LMS (idempotente). */
  destroy(): void {
    this.tracker.finish();
    const win = this.doc.defaultView;
    win?.removeEventListener("pagehide", this.onUnload);
    win?.removeEventListener("beforeunload", this.onUnload);
    this.resizeObserver?.disconnect();
  }
}
